use crate::{
    database::{Message, Source},
    provider::ProviderAdapter,
    sse::Decoder,
};
use anyhow::{anyhow, Result};
use futures_util::StreamExt;
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};

pub type Response = (String, Vec<Source>, i64, i64, i64, Vec<Value>, String);

#[cfg(test)] mod grok_tests {
 use super::*;
 #[tokio::test] async fn grok_stream_preserves_reply_and_reported_usage(){
  let data="data: {\"choices\":[{\"delta\":{\"content\":\"Grok reply\"}}]}\n\ndata: {\"usage\":{\"prompt_tokens\":9,\"completion_tokens\":5,\"completion_tokens_details\":{\"reasoning_tokens\":2}}}\n\ndata: [DONE]\n\n";
  let (base,server)=crate::test_http::serve(vec![(200,"text/event-stream",data.into())]);
  let result=stream("grok".into(),base,"mock".into(),"user-selected-model".into(),"high".into(),Value::Null,vec![],String::new(),false,Arc::new(AtomicBool::new(false)),|_|Ok(())).await.unwrap();
  assert_eq!(result.0,"Grok reply");assert_eq!((result.2,result.3,result.4),(9,5,2));
  let requests=server.join().unwrap();assert_eq!(requests[0]["model"],"user-selected-model");assert_eq!(requests[0]["reasoning_effort"],"high");assert!(requests[0]["thinking"].is_null());
 }
}

pub async fn stream(
    provider: String,
    base: String,
    key: String,
    model: String,
    thinking: String,
    options: Value,
    history: Vec<Message>,
    system: String,
    search: bool,
    cancelled: Arc<AtomicBool>,
    mut on_delta: impl FnMut(String) -> Result<()>,
) -> Result<Response> {
    let adapter = ProviderAdapter::new(&provider)?;
    let mut messages = prepare_messages(&history, &provider, &system);
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(20))
        .build()?;
    let (mut answer, mut reasoning) = (String::new(), String::new());
    let mut sources = vec![];
    let mut events = vec![];
    let (mut input, mut output, mut thinking_tokens) = (0, 0, 0);
    // Only the provider's built-in web search is eligible for a tool round trip.
    for round in 0..5 {
        if cancelled.load(Ordering::Relaxed) {
            break;
        }
        let mut body = json!({"model":model,"stream":true,"stream_options":{"include_usage":true},"messages":messages});
        adapter.configure(&mut body, &thinking);
        if search {
            adapter.configure_search(&mut body)?;
        }
        adapter.configure_options(&mut body, &options)?;
        let mut response = crate::provider::send_cancellable(
            adapter.request(&client, &base, &key, &body),
            &cancelled,
        )
        .await?;
        if response.status().as_u16() == 400
            && adapter == ProviderAdapter::Compatible
            && thinking == "off"
            && crate::provider::default_options(&options)
        {
            body.as_object_mut().unwrap().remove("stream_options");
            response = crate::provider::send_cancellable(
                adapter.request(&client, &base, &key, &body),
                &cancelled,
            )
            .await?;
        }
        if !response.status().is_success() {
            return Err(anyhow!(
                "{} API 返回 {}：{}",
                provider,
                response.status(),
                response.text().await.unwrap_or_default()
            ));
        }
        let mut stream = response.bytes_stream();
        let mut decoder = Decoder::default();
        let mut tools = BTreeMap::<usize, Value>::new();
        let (mut round_input, mut round_output, mut round_thinking) = (0, 0, 0);
        let (mut round_answer, mut round_reasoning) = (String::new(), String::new());
        let mut done = false;
        loop {
            let chunk = tokio::select! {chunk=stream.next()=>chunk,_=tokio::time::sleep(std::time::Duration::from_millis(100))=>{if cancelled.load(Ordering::Relaxed){break;}else{continue;}}};
            if cancelled.load(Ordering::Relaxed) {
                break;
            }
            let frames = match chunk {
                Some(chunk) => decoder.feed(&chunk?)?,
                None => {
                    done = true;
                    decoder.finish()?
                }
            };
            for data in frames {
                if data == "[DONE]" {
                    done = true;
                    continue;
                }
                let event: Value = serde_json::from_str(&data)
                    .map_err(|e| anyhow!("无法解析 API 流事件：{}", e))?;
                if !event["error"].is_null() {
                    return Err(anyhow!("API 流错误：{}", event["error"]));
                }
                let delta = &event["choices"][0]["delta"];
                if let Some(text) = delta["content"].as_str() {
                    round_answer.push_str(text);
                    answer.push_str(text);
                    on_delta(text.into())?;
                }
                if let Some(text) = delta["reasoning_content"].as_str() {
                    round_reasoning.push_str(text);
                    reasoning.push_str(text);
                    round_thinking += (text.chars().count() as i64 + 3) / 4;
                }
                crate::claude::collect_sources(&mut sources, &event);
                crate::claude::collect_sources(&mut sources, delta);
                crate::claude::collect_search_events(&mut events, &event);
                if let Some(calls) = delta["tool_calls"].as_array() {
                    for call in calls {
                        let index = call["index"].as_u64().unwrap_or(0) as usize;
                        let entry=tools.entry(index).or_insert_with(||json!({"id":"","type":"function","function":{"name":"","arguments":""}}));
                        for path in ["id", "type"] {
                            if let Some(value) = call[path].as_str() {
                                if path == "id" {
                                    let joined =
                                        format!("{}{}", entry[path].as_str().unwrap_or(""), value);
                                    entry[path] = json!(joined);
                                } else {
                                    entry[path] = json!(value);
                                }
                            }
                        }
                        for key in ["name", "arguments"] {
                            if let Some(value) = call["function"][key].as_str() {
                                let joined = format!(
                                    "{}{}",
                                    entry["function"][key].as_str().unwrap_or(""),
                                    value
                                );
                                entry["function"][key] = json!(joined);
                            }
                        }
                    }
                }
                if let Some(usage) = event.get("usage") {
                    round_input = usage["prompt_tokens"].as_i64().unwrap_or(round_input);
                    round_output = usage["completion_tokens"].as_i64().unwrap_or(round_output);
                    round_thinking = usage["completion_tokens_details"]["reasoning_tokens"]
                        .as_i64()
                        .unwrap_or(round_thinking);
                }
            }
            if done {
                break;
            }
        }
        input += round_input;
        output += round_output;
        thinking_tokens += round_thinking;
        if tools.is_empty() || cancelled.load(Ordering::Relaxed) {
            break;
        }
        if adapter != ProviderAdapter::Moonshot || !search {
            return Err(anyhow!(
                "Provider 返回了未授权执行的工具调用；本客户端只执行内置联网搜索。"
            ));
        }
        if round == 4 {
            return Err(anyhow!("搜索已达到 5 轮上限，请缩小问题范围"));
        }
        let calls = tools.into_values().collect::<Vec<_>>();
        messages.push(json!({"role":"assistant","content":round_answer,"reasoning_content":round_reasoning,"tool_calls":calls}));
        for call in calls {
            if call["function"]["name"] != "$web_search" {
                return Err(anyhow!("仅允许 Kimi $web_search 工具"));
            }
            let arguments = call["function"]["arguments"].as_str().unwrap_or("{}");
            let parsed: Value = serde_json::from_str(arguments)?;
            collect_search_sources(&mut sources, &parsed);
            events.push(json!({"tool":"$web_search","arguments":parsed}));
            messages.push(json!({"role":"tool","tool_call_id":call["id"],"name":"$web_search","content":arguments}));
        }
    }
    Ok((
        answer,
        sources,
        input,
        output,
        thinking_tokens,
        events,
        reasoning,
    ))
}

fn collect_search_sources(sources: &mut Vec<Source>, value: &Value) {
    crate::claude::add_source(sources, value);
    match value {
        Value::Array(items) => {
            for item in items {
                collect_search_sources(sources, item)
            }
        }
        Value::Object(map) => {
            for item in map.values() {
                collect_search_sources(sources, item)
            }
        }
        _ => {}
    }
}

fn prepare_messages(history: &[Message], provider: &str, system: &str) -> Vec<Value> {
    let mut messages = vec![];
    if !system.trim().is_empty() {
        messages.push(json!({"role":"system","content":system}));
    }
    let mut remaining = 24_000;
    // Reserve attachment budget for the most recent turns, consistent with Anthropic.
    let mut turns = vec![];
    for message in history.iter().rev() {
        if !matches!(message.role.as_str(), "user" | "assistant") {
            continue;
        }
        let mut blocks = vec![json!({"type":"text","text":message.content})];
        for attachment in &message.attachments {
            if attachment.kind == "image" {
                if let Some(data) = &attachment.data {
                    blocks.push(json!({"type":"image_url","image_url":{"url":format!("data:{};base64,{}",attachment.mime,data)}}));
                }
            } else if let Some(text) = &attachment.text {
                let excerpt: String = text.chars().take(remaining.min(16_000)).collect();
                remaining = remaining.saturating_sub(excerpt.chars().count());
                blocks.push(json!({"type":"text","text":format!("文件 {}（发送 {} / {} 字符）：\n{}",attachment.name,excerpt.chars().count(),text.chars().count(),excerpt)}));
            }
        }
        let content = if blocks.iter().any(|b| b["type"] == "image_url") {
            Value::Array(blocks)
        } else {
            json!(blocks
                .iter()
                .filter_map(|b| b["text"].as_str())
                .collect::<Vec<_>>()
                .join("\n\n"))
        };
        let mut item = json!({"role":message.role,"content":content});
        if matches!(provider, "deepseek" | "moonshot" | "zhipu" | "grok")
            && message.role == "assistant"
            && !message.reasoning_content.is_empty()
        {
            item["reasoning_content"] = json!(message.reasoning_content);
        }
        turns.push(item);
    }
    turns.reverse();
    messages.extend(turns);
    messages
}

#[cfg(test)]
mod tests {
    use super::*;
    fn event(value: Value) -> String {
        format!("data: {}\r\n\r\n", value)
    }
    #[tokio::test]
    async fn streaming_preserves_unicode_reasoning_and_usage() {
        let data = event(
            json!({"choices":[{"delta":{"content":"中文回答","reasoning_content":"思考"}}]}),
        ) + &event(
            json!({"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":8,"completion_tokens_details":{"reasoning_tokens":3}}}),
        ) + "data: [DONE]\r\n\r\n";
        let (base, server) = crate::test_http::serve(vec![(200, "text/event-stream", data)]);
        let mut visible = String::new();
        let result = stream(
            "deepseek".into(),
            base,
            "mock".into(),
            "custom-model".into(),
            "high".into(),
            Value::Null,
            vec![],
            String::new(),
            false,
            Arc::new(AtomicBool::new(false)),
            |text| {
                visible.push_str(&text);
                Ok(())
            },
        )
        .await
        .unwrap();
        assert_eq!(result.0, "中文回答");
        assert_eq!(visible, result.0);
        assert_eq!((result.2, result.3, result.4), (12, 8, 3));
        assert_eq!(result.6, "思考");
        let requests = server.join().unwrap();
        assert_eq!(requests[0]["thinking"]["type"], "enabled");
        assert_eq!(requests[0]["model"], "custom-model");
    }
    #[tokio::test]
    async fn kimi_search_roundtrip_echoes_arguments_and_sums_usage() {
        let first = event(
            json!({"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","type":"function","function":{"name":"$web_search","arguments":"{\"query\":\"测试\",\"results\":[{\"url\":\"https://example.com\",\"title\":\"来源\"}]}"}}]}}]}),
        ) + &event(json!({"usage":{"prompt_tokens":10,"completion_tokens":2}}))
            + "data: [DONE]\n\n";
        let second = event(json!({"choices":[{"delta":{"content":"搜索回答 [1]"}}]}))
            + &event(json!({"usage":{"prompt_tokens":20,"completion_tokens":5}}))
            + "data: [DONE]\n\n";
        let (base, server) = crate::test_http::serve(vec![
            (200, "text/event-stream", first),
            (200, "text/event-stream", second),
        ]);
        let result = stream(
            "moonshot".into(),
            base,
            "mock".into(),
            "user-model".into(),
            "off".into(),
            Value::Null,
            vec![],
            String::new(),
            true,
            Arc::new(AtomicBool::new(false)),
            |_| Ok(()),
        )
        .await
        .unwrap();
        assert_eq!(result.0, "搜索回答 [1]");
        assert_eq!((result.2, result.3), (30, 7));
        assert_eq!(result.1[0].url, "https://example.com");
        let requests = server.join().unwrap();
        assert_eq!(requests[0]["tools"][0]["type"], "builtin_function");
        assert_eq!(requests[1]["messages"][1]["role"], "tool");
        assert_eq!(requests[1]["messages"][1]["tool_call_id"], "call-1");
    }
    #[tokio::test]
    async fn api_stream_errors_are_not_saved_as_success() {
        let data = event(json!({"error":{"message":"mock error"}}));
        let (base, server) = crate::test_http::serve(vec![(200, "text/event-stream", data)]);
        assert!(stream(
            "openai".into(),
            base,
            "mock".into(),
            "m".into(),
            "off".into(),
            Value::Null,
            vec![],
            String::new(),
            false,
            Arc::new(AtomicBool::new(false)),
            |_| Ok(())
        )
        .await
        .is_err());
        server.join().unwrap();
    }
}
