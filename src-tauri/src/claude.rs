use anyhow::Result;
use futures_util::StreamExt;
use reqwest::Client;
use serde_json::{json, Value};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

use crate::database::{Message, Source};

const MAX_DOCUMENT_CHARS: usize = 16_000;
const MAX_REQUEST_DOCUMENT_CHARS: usize = 24_000;
const DEFAULT_OUTPUT_TOKENS:u32=8_192;

pub(crate) fn add_source(sources: &mut Vec<Source>, value: &Value) {
    add_source_with_text(sources,value,None)
}
fn add_source_with_text(sources:&mut Vec<Source>,value:&Value,text:Option<&str>) {
    let Some(url) = value["url"].as_str().or_else(|| value["link"].as_str()) else {
        return;
    };
    if !reqwest::Url::parse(url)
        .map(|u| matches!(u.scheme(), "http" | "https"))
        .unwrap_or(false)
    {
        return;
    }
    let anchor=text.and_then(|text|{
        let start=value["start_index"].as_u64()? as usize;let end=value["end_index"].as_u64()? as usize;
        if start>=end || end>text.chars().count(){return None}
        Some(text.chars().skip(start).take(end-start).collect::<String>())
    });
    let citation=value["refer"].as_str().or_else(||value["ref_id"].as_str()).or_else(||value["citation_id"].as_str()).map(String::from)
        .or_else(||anchor.as_deref().and_then(|span|span.strip_prefix('[')?.strip_suffix(']')).filter(|id|!id.is_empty() && id.chars().all(|c|c.is_ascii_digit())).map(String::from)).unwrap_or_default();
    // Keep the provider's original entries and order, including repeated URLs.
    // Vue groups cards without renumbering the underlying references.
    sources.push(Source {
        anchor,
        citation,
        title: value["title"].as_str().unwrap_or(url).to_string(),
        url: url.to_string(),
        snippet: value["snippet"]
            .as_str()
            .or_else(|| value["content"].as_str())
            .or_else(|| value["page_content"].as_str())
            .unwrap_or("")
            .chars()
            .take(240)
            .collect(),
    });
}

pub(crate) fn collect_sources(sources: &mut Vec<Source>, value: &Value) {
    collect_sources_with_text(sources,value,None)
}
pub(crate) fn collect_sources_with_text(sources:&mut Vec<Source>,value:&Value,text:Option<&str>) {
    if let Some(annotations) = value["annotations"].as_array() {
        for item in annotations {
            if let Some(citation) = item.get("url_citation") {
                add_source_with_text(sources, citation,text);
            } else if item["type"]=="url_citation" {
                add_source_with_text(sources,item,text);
            }
        }
    }
    if let Some(citations) = value["citations"].as_array() {
        for citation in citations {
            add_source_with_text(sources, citation,text);
        }
    }
    if value["citation"].is_object() {
        add_source_with_text(sources, &value["citation"],text);
    }
    if value["type"] == "web_search_result" {
        add_source(sources, value);
    }
    if let Some(results) = value["web_search"].as_array() {
        for item in results {
            add_source(sources, item);
        }
    }
    if let Some(content) = value["content"].as_array() {
        for item in content {
            collect_sources(sources, item);
        }
    }
}

pub(crate) fn collect_search_events(events: &mut Vec<Value>, event: &Value) {
    let block = &event["content_block"];
    if block["name"] == "web_search" || block["type"] == "web_search_tool_result" {
        events.push(block.clone());
    }
    if event["delta"]["type"] == "input_json_delta" {
        let mut delta = event["delta"].clone();
        delta["index"] = event["index"].clone();
        events.push(delta);
    }
    if event["web_search"].is_array() {
        events.push(json!({"results":event["web_search"]}));
    }
    if !event["choices"][0]["delta"]["tool_calls"].is_null() {
        events.push(json!({"toolCalls":event["choices"][0]["delta"]["tool_calls"]}));
    }
}

fn endpoint(base_url: &str) -> String {
    crate::provider::ProviderAdapter::Anthropic.endpoint(base_url)
}
fn thinking_budget(level: &str) -> Option<u32> {
    match level {
        "low" => Some(1_024),
        "medium" => Some(4_096),
        "high" => Some(8_192),
        _ => None,
    }
}

async fn request(
    client: &Client,
    base_url: &str,
    api_key: &str,
    body: &Value,
    cancelled: &Arc<AtomicBool>,
) -> Result<reqwest::Response> {
    let mut call = client
        .post(endpoint(base_url))
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .json(body);
    if body.get("tools").is_some() {
        call = call.header("anthropic-beta", "web-search-2025-03-05");
    }
    crate::provider::send_cancellable(call, cancelled).await
}

pub async fn stream(
    base_url: String,
    api_key: String,
    model: String,
    thinking: String,
    options: Value,
    history: Vec<Message>,
    system_prompt: String,
    web_search: bool,
    cancelled: Arc<AtomicBool>,
    on_delta: impl FnMut(String) -> Result<()>,
) -> Result<(String, Vec<Source>, i64, i64, i64, Vec<Value>, String)> {
    stream_with_progress(base_url,api_key,model,thinking,options,history,system_prompt,web_search,cancelled,on_delta, |_, _| {}).await
}

pub async fn stream_with_progress(
    base_url: String,
    api_key: String,
    model: String,
    thinking: String,
    options: Value,
    history: Vec<Message>,
    system_prompt: String,
    web_search: bool,
    cancelled: Arc<AtomicBool>,
    mut on_delta: impl FnMut(String) -> Result<()>,
    mut on_progress: impl FnMut(&str, String),
) -> Result<(String, Vec<Source>, i64, i64, i64, Vec<Value>, String)> {
    let messages = prepare_messages(&history);
    let budget = thinking_budget(&thinking);
    let mut body = json!({ "model": model, "max_tokens": DEFAULT_OUTPUT_TOKENS + budget.unwrap_or(0), "stream": true, "messages": messages });
    if !system_prompt.trim().is_empty() {
        body["system"] = json!(system_prompt);
    }
    if web_search {
        body["tools"] =
            json!([{ "type": "web_search_20250305", "name": "web_search", "max_uses": 5 }]);
    }
    if let Some(budget) = budget {
        body["thinking"] = json!({ "type": "enabled", "budget_tokens": budget });
    }

    crate::provider::ProviderAdapter::Anthropic.configure_options(&mut body, &options)?;
    let initial_body=body.clone();
    let client = Client::builder()
        .connect_timeout(std::time::Duration::from_secs(20))
        .read_timeout(std::time::Duration::from_secs(90))
        .build()?;
    let call_started=std::time::Instant::now();
    on_progress("call_start",String::new());
    let mut response = request(&client, &base_url, &api_key, &body, &cancelled).await?;
    if response.status().as_u16()==400 && budget.is_some() && crate::provider::default_options(&options){
        let error=crate::recovery::http_error(response,&cancelled).await;
        if crate::recovery::kind(&error)==crate::recovery::Kind::Fatal && error.to_string().contains("thinking"){
            on_progress("call_usage",json!({"input":0,"output":0,"thinking":0,"durationMs":0,"origin":{},"reason":"unsupported_thinking"}).to_string());
            body["thinking"]=json!({"type":"adaptive"});body["output_config"]=json!({"effort":thinking});
            on_progress("call_start",String::new());
            response=request(&client,&base_url,&api_key,&body,&cancelled).await?;
            if response.status().as_u16()==400 {
                let error=crate::recovery::http_error(response,&cancelled).await;
                if crate::recovery::kind(&error)!=crate::recovery::Kind::Fatal || !(error.to_string().contains("thinking") || error.to_string().contains("output_config")){return Err(error)}
                on_progress("call_usage",json!({"input":0,"output":0,"thinking":0,"durationMs":0,"origin":{},"reason":"unsupported_thinking"}).to_string());
                body.as_object_mut().unwrap().remove("thinking");body.as_object_mut().unwrap().remove("output_config");body["max_tokens"]=json!(DEFAULT_OUTPUT_TOKENS);
                on_progress("call_start",String::new());
            response=request(&client,&base_url,&api_key,&body,&cancelled).await?;
            }
        }else{return Err(error)}
    }
    // Older gateways may reject the larger default. Preserve explicit user limits.
    if response.status().as_u16()==400 && options.get("max_tokens").is_none() && options.get("client_max_output_tokens").is_none() && body.get("thinking").is_none(){
        let error=crate::recovery::http_error(response,&cancelled).await;
        if crate::recovery::kind(&error)==crate::recovery::Kind::Fatal && error.to_string().contains("max_tokens") {
            on_progress("call_usage",json!({"input":0,"output":0,"thinking":0,"durationMs":0,"origin":{},"reason":"output_budget_rejected"}).to_string());
            body.as_object_mut().unwrap().remove("thinking");body.as_object_mut().unwrap().remove("output_config");body["max_tokens"]=json!(4096);
            on_progress("call_start",String::new());
            response=request(&client,&base_url,&api_key,&body,&cancelled).await?;
        }else{return Err(error)}
    }
    if !response.status().is_success(){return Err(crate::recovery::http_error(response,&cancelled).await)}
    if body!=initial_body{on_progress("protocol_options",json!({"max_tokens":body["max_tokens"],"thinking":body.get("thinking").cloned().unwrap_or(Value::Null),"output_config":body.get("output_config").cloned().unwrap_or(Value::Null)}).to_string());}
    let mut stream = response.bytes_stream();
    let mut decoder = crate::sse::Decoder::default();
    let mut answer = String::new();
    let mut sources = Vec::new();
    let mut search_events = vec![];
    let mut reasoning_content = String::new();
    let (mut input_tokens, mut output_tokens, mut thinking_tokens) = (0, 0, 0);
    let mut call_origin=json!({"input":"unavailable","output":"unavailable","thinking":"unavailable"});
    let mut terminal=false;
    let mut finish_at:Option<std::time::Instant>=None;
    let mut finish_reason=String::new();
    let mut snapshot_counts=(0,0);
    let parsed:Result<()>=async {loop {
        let chunk = tokio::select! {chunk=stream.next()=>chunk,_=tokio::time::sleep(std::time::Duration::from_millis(100))=>{if cancelled.load(Ordering::Relaxed) || finish_at.map(|at|at.elapsed().as_millis()>=1000).unwrap_or(false){break;}else{continue;}}};
        if cancelled.load(Ordering::Relaxed) {
            break;
        }
        let done = chunk.is_none();
        let frames = match chunk {
            Some(chunk) => decoder.feed(&chunk?)?,
            None => decoder.finish()?,
        };
        for data in frames {
            if data == "[DONE]" {
                terminal=true;
                continue;
            }
            let event=serde_json::from_str::<Value>(&data).map_err(|e|crate::recovery::fail(crate::recovery::Kind::Stream,format!("无法解析 API 流事件：{}",e)))?;
            if event["type"]=="message_stop"{terminal=true;}
            if event["type"] == "error" {
                return Err(crate::recovery::stream_error(&event["error"]));
            }
            collect_search_events(&mut search_events, &event); if event["content_block"]["type"] == "server_tool_use" { on_progress("searching", String::new()); }
            if event["type"] == "message_start" { on_progress("usage", json!({"input":if event["message"]["usage"]["input_tokens"].is_i64(){"provider"}else{"unavailable"}}).to_string());
                if event["message"]["usage"]["input_tokens"].is_i64(){call_origin["input"]=json!("provider");}
                input_tokens = event["message"]["usage"]["input_tokens"]
                    .as_i64()
                    .unwrap_or(0);
                on_progress("usage_values",json!({"input":input_tokens}).to_string());
            }
            if event["type"] == "message_delta" { on_progress("usage", json!({"output":if event["usage"]["output_tokens"].is_i64(){"provider"}else{"unavailable"}}).to_string());
                if let Some(reason)=event["delta"]["stop_reason"].as_str(){finish_reason=reason.into();}
                if !finish_reason.is_empty() && finish_at.is_none(){finish_at=Some(std::time::Instant::now());}
                if event["usage"]["output_tokens"].is_i64(){call_origin["output"]=json!("provider");}
                output_tokens = event["usage"]["output_tokens"]
                    .as_i64()
                    .unwrap_or(output_tokens);
                on_progress("usage_values",json!({"input":input_tokens,"output":output_tokens,"thinking":thinking_tokens}).to_string());
            }
            if event["type"] == "content_block_delta" {
                if let Some(text) = event["delta"]["text"].as_str() {
                    answer.push_str(text);
                    on_delta(text.to_string())?;
                }
                collect_sources(&mut sources, &event["delta"]);
                if event["delta"]["type"] == "citations_delta" {
                    if let Some(url) = event["delta"]["citation"]["url"].as_str() {
                        let citation=event["delta"]["citation"]["refer"].as_str().unwrap_or("");
                        if let Some(position) = sources.iter().rposition(|s| s.url == url && s.citation==citation) {
                            // IDs must remain unique when automatic continuations combine source arrays.
                            let id=format!("cc-{}",uuid::Uuid::new_v4());
                            sources[position].citation=id.clone();
                            let marker = format!("[{id}]");
                            answer.push_str(&marker);
                            on_delta(marker)?;
                        }
                    }
                }
                if let Some(thought) = event["delta"]["thinking"].as_str() {
                    call_origin["thinking"]=json!("estimated");
                    reasoning_content.push_str(thought); on_progress("thinking", thought.to_string());
                    thinking_tokens += (thought.chars().count() as i64 + 3) / 4;
                    on_progress("usage_values",json!({"thinking":thinking_tokens}).to_string());
                }
            } else if event["type"] == "content_block_start" {
                collect_sources(&mut sources, &event["content_block"]);
            }
            if snapshot_counts!=(sources.len(),search_events.len()){
                snapshot_counts=(sources.len(),search_events.len());on_progress("source_snapshot",json!({"sources":sources,"events":search_events}).to_string());
            }
        }
        if done || terminal {
            break;
        }
    }
    if !cancelled.load(Ordering::Relaxed) && !terminal && finish_reason.is_empty(){return Err(crate::recovery::fail(crate::recovery::Kind::Stream,"流式连接提前关闭，未收到回答完成标记"))}
    Ok(())}.await;
    if call_origin["thinking"]=="estimated"{thinking_tokens=(reasoning_content.chars().count() as i64+3)/4;}
    if call_origin["output"]!="provider" && (!answer.is_empty() || thinking_tokens>0){call_origin["output"]=json!("estimated");output_tokens=(answer.chars().count() as i64+3)/4+thinking_tokens;}
    crate::recovery::report_call(&mut on_progress,call_started,[input_tokens,output_tokens,thinking_tokens],call_origin,&parsed,&finish_reason);
    if let Err(error)=parsed {if finish_reason.is_empty() || matches!(crate::recovery::kind(&error),crate::recovery::Kind::Safety|crate::recovery::Kind::Context){return Err(error)}}

    on_progress("finish",if cancelled.load(Ordering::Relaxed){"cancelled".into()}else if finish_reason.is_empty(){"end_turn".into()}else{finish_reason});
    Ok((
        answer,
        sources,
        input_tokens,
        output_tokens,
        thinking_tokens,
        search_events,
        reasoning_content,
    ))
}

fn prepare_messages(history: &[Message]) -> Vec<Value> {
    let mut remaining = MAX_REQUEST_DOCUMENT_CHARS;
    let mut messages: Vec<Value> = history.iter().rev()
    .filter(|message| message.role == "user" || message.role == "assistant")
    .map(|message| {
      if message.attachments.is_empty() { return json!({ "role": message.role, "content": message.content }); }
      let mut blocks=Vec::new();if !message.content.trim().is_empty(){blocks.push(json!({"type":"text","text":message.content}));}
      for a in &message.attachments { if a.kind=="image" {if let Some(data)=&a.data{blocks.push(json!({"type":"image","source":{"type":"base64","media_type":a.mime,"data":data}}));}} else if let Some(text)=&a.text {
        let allowed=remaining.min(MAX_DOCUMENT_CHARS);
        let excerpt:String=text.chars().take(allowed).collect();
        remaining=remaining.saturating_sub(excerpt.chars().count());
        let total=text.chars().count();
        let note=if excerpt.is_empty(){format!("文件 {} 的内容已超出本次附件上下文预算，请在新会话单独上传。",a.name)}else if total>excerpt.chars().count(){format!("文件 {}（本次发送前 {} / {} 字符，其余未发送）：\n{}",a.name,excerpt.chars().count(),total,excerpt)}else{format!("文件 {} 的提取文本：\n{}",a.name,excerpt)};
        blocks.push(json!({"type":"text","text":note}));
      } }
      let content=if message.attachments.iter().any(|a|a.kind=="image") {Value::Array(blocks)} else {
        Value::String(blocks.iter().filter_map(|block|block["text"].as_str()).collect::<Vec<_>>().join("\n\n"))
      };
      json!({"role":message.role,"content":content})
    })
    .collect();
    messages.reverse();
    messages
}

#[cfg(test)]
mod tests {
    #[test]
    fn duplicate_urls_keep_distinct_citations_and_stable_order(){
        let mut sources=vec![];
        for source in [serde_json::json!({"url":"https://example.com/a","title":"A","refer":"ref-1"}),serde_json::json!({"url":"https://example.com/b","title":"B","refer":"ref-2"}),serde_json::json!({"url":"https://example.com/a","title":"A again","refer":"ref-3"}),serde_json::json!({"url":"https://example.com/a","title":"A repeat event","refer":"ref-3"})]{super::add_source(&mut sources,&source);}
        assert_eq!(sources.len(),4);assert_eq!(sources[0].citation,"ref-1");assert_eq!(sources[2].citation,"ref-3");assert_eq!(sources[0].url,sources[2].url);assert_eq!(sources[3].citation,"ref-3");
    }
    use super::*;
    use crate::database::Attachment;
    #[test]
    fn limits_document_context_without_losing_user_question() {
        let document = Attachment {
            id: "a".into(),
            name: "large.md".into(),
            mime: "text/markdown".into(),
            kind: "document".into(),
            size: 30_000,
            text: Some("中".repeat(30_000)),
            data: None,
        };
        let message = Message {
            usage_id: None,
            reasoning_content: String::new(),
            parent_id: None,
            references: vec![],
            search_trace: None,
            id: "m".into(),
            role: "user".into(),
            content: "请总结".into(),
            created_at: "".into(),
            sources: None,
            attachments: vec![document],
        };
        let prepared = prepare_messages(&[message]);
        let sent = prepared[0]["content"].as_str().unwrap();
        assert!(sent.starts_with("请总结\n\n"));
        assert!(sent.contains("前 16000 / 30000 字符"));
        assert_eq!(sent.matches('中').count(), MAX_DOCUMENT_CHARS);
    }
    #[test]
    fn image_messages_keep_multimodal_blocks() {
        let image = Attachment {
            id: "a".into(),
            name: "image.png".into(),
            mime: "image/png".into(),
            kind: "image".into(),
            size: 3,
            text: None,
            data: Some("YWJj".into()),
        };
        let message = Message {
            usage_id: None,
            reasoning_content: String::new(),
            parent_id: None,
            references: vec![],
            search_trace: None,
            id: "m".into(),
            role: "user".into(),
            content: "描述图片".into(),
            created_at: "".into(),
            sources: None,
            attachments: vec![image],
        };
        let prepared = prepare_messages(&[message]);
        assert_eq!(prepared[0]["content"][1]["type"], "image");
    }
}
