use anyhow::{anyhow, Result};
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

pub(crate) fn add_source(sources: &mut Vec<Source>, value: &Value) {
    let Some(url) = value["url"].as_str().or_else(|| value["link"].as_str()) else {
        return;
    };
    if !reqwest::Url::parse(url)
        .map(|u| matches!(u.scheme(), "http" | "https"))
        .unwrap_or(false)
    {
        return;
    }
    if sources.iter().any(|source| source.url == url) {
        return;
    }
    sources.push(Source {
        citation: value["refer"].as_str().unwrap_or("").to_string(),
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
    if let Some(annotations) = value["annotations"].as_array() {
        for item in annotations {
            if let Some(citation) = item.get("url_citation") {
                add_source(sources, citation);
            }
        }
    }
    if let Some(citations) = value["citations"].as_array() {
        for citation in citations {
            add_source(sources, citation);
        }
    }
    if value["citation"].is_object() {
        add_source(sources, &value["citation"]);
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
    let mut body = json!({ "model": model, "max_tokens": 4096 + budget.unwrap_or(0), "stream": true, "messages": messages });
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
    let client = Client::builder()
        .connect_timeout(std::time::Duration::from_secs(20))
        .build()?;
    let mut response = request(&client, &base_url, &api_key, &body, &cancelled).await?;
    if response.status().as_u16() == 400
        && budget.is_some()
        && crate::provider::default_options(&options)
    {
        body["thinking"] = json!({"type":"adaptive"});
        body["output_config"] = json!({"effort":thinking});
        response = request(&client, &base_url, &api_key, &body, &cancelled).await?;
    }
    if response.status().as_u16() == 400
        && budget.is_some()
        && crate::provider::default_options(&options)
    {
        body.as_object_mut().map(|object| object.remove("thinking"));
        body.as_object_mut()
            .map(|object| object.remove("output_config"));
        body["max_tokens"] = json!(4096);
        response = request(&client, &base_url, &api_key, &body, &cancelled).await?;
    }
    if matches!(response.status().as_u16(), 502 | 503) && !cancelled.load(Ordering::Relaxed) {
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        response = request(&client, &base_url, &api_key, &body, &cancelled).await?;
    }
    if !response.status().is_success() {
        if response.status().as_u16() == 524 {
            return Err(anyhow!("API 网关等待上游响应超时（524）。可尝试缩短文档、关闭联网搜索或降低思考强度；若短消息也超时，请检查当前 Base URL 服务。"));
        }
        if response.status().as_u16() == 502 {
            let trace = response
                .headers()
                .get("request-id")
                .or_else(|| response.headers().get("cf-ray"))
                .and_then(|v| v.to_str().ok())
                .unwrap_or("");
            return Err(anyhow!("API 网关返回 502（已重试一次）。当前模型：{}；联网搜索：{}；思考强度：{}。请先在设置中测试连接，并用纯文本、关闭联网搜索及思考强度 Off 逐项排查。{}",model,if web_search{"开"}else{"关"},thinking,if trace.is_empty(){String::new()}else{format!(" 请求 ID：{}",trace)}));
        }
        return Err(anyhow!(
            "Anthropic API 返回 {}：{}",
            response.status(),
            response.text().await.unwrap_or_default()
        ));
    }

    let mut stream = response.bytes_stream();
    let mut decoder = crate::sse::Decoder::default();
    let mut answer = String::new();
    let mut sources = Vec::new();
    let mut search_events = vec![];
    let mut reasoning_content = String::new();
    let (mut input_tokens, mut output_tokens, mut thinking_tokens) = (0, 0, 0);
    loop {
        let chunk = tokio::select! {chunk=stream.next()=>chunk,_=tokio::time::sleep(std::time::Duration::from_millis(100))=>{if cancelled.load(Ordering::Relaxed){break;}else{continue;}}};
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
                continue;
            }
            let Ok(event) = serde_json::from_str::<Value>(&data) else {
                continue;
            };
            if event["type"] == "error" {
                return Err(anyhow!("API 流错误：{}", event["error"]));
            }
            collect_search_events(&mut search_events, &event); if event["content_block"]["type"] == "server_tool_use" { on_progress("searching", String::new()); }
            if event["type"] == "message_start" { on_progress("usage", json!({"input":if event["message"]["usage"]["input_tokens"].is_i64(){"provider"}else{"unavailable"}}).to_string());
                input_tokens = event["message"]["usage"]["input_tokens"]
                    .as_i64()
                    .unwrap_or(0);
            }
            if event["type"] == "message_delta" { on_progress("usage", json!({"output":if event["usage"]["output_tokens"].is_i64(){"provider"}else{"unavailable"}}).to_string());
                output_tokens = event["usage"]["output_tokens"]
                    .as_i64()
                    .unwrap_or(output_tokens);
            }
            if event["type"] == "content_block_delta" {
                if let Some(text) = event["delta"]["text"].as_str() {
                    answer.push_str(text);
                    on_delta(text.to_string())?;
                }
                collect_sources(&mut sources, &event["delta"]);
                if event["delta"]["type"] == "citations_delta" {
                    if let Some(url) = event["delta"]["citation"]["url"].as_str() {
                        if let Some(position) = sources.iter().position(|s| s.url == url) {
                            let marker = format!("[{}]", position + 1);
                            answer.push_str(&marker);
                            on_delta(marker)?;
                        }
                    }
                }
                if let Some(thought) = event["delta"]["thinking"].as_str() {
                    reasoning_content.push_str(thought); on_progress("thinking", thought.to_string());
                    thinking_tokens += (thought.chars().count() as i64 + 3) / 4;
                }
            } else if event["type"] == "content_block_start" {
                collect_sources(&mut sources, &event["content_block"]);
            }
        }
        if done {
            break;
        }
    }
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
