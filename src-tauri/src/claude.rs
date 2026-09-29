use anyhow::{anyhow, Result};
use futures_util::StreamExt;
use reqwest::Client;
use serde_json::{json, Value};
use std::sync::{atomic::{AtomicBool, Ordering}, Arc};

use crate::database::{Message, Source};

const MAX_DOCUMENT_CHARS: usize = 16_000;
const MAX_REQUEST_DOCUMENT_CHARS: usize = 24_000;

fn add_source(sources: &mut Vec<Source>, value: &Value) {
  let Some(url) = value["url"].as_str() else { return };
  if sources.iter().any(|source| source.url == url) { return; }
  sources.push(Source { title: value["title"].as_str().unwrap_or(url).to_string(), url: url.to_string() });
}

fn collect_sources(sources: &mut Vec<Source>, value: &Value) {
  if let Some(citations) = value["citations"].as_array() { for citation in citations { add_source(sources, citation); } }
  if value["type"] == "web_search_result" { add_source(sources, value); }
  if let Some(content) = value["content"].as_array() { for item in content { collect_sources(sources, item); } }
}

fn endpoint(base_url: &str) -> String {
  let base = base_url.trim().trim_end_matches('/');
  if base.ends_with("/v1/messages") { base.to_string() } else { format!("{base}/v1/messages") }
}

fn thinking_budget(level: &str) -> Option<u32> {
  match level { "low" => Some(1_024), "medium" => Some(4_096), "high" => Some(8_192), _ => None }
}

async fn request(client: &Client, base_url: &str, api_key: &str, body: &Value) -> Result<reqwest::Response> {
  let mut call=client.post(endpoint(base_url))
    .header("x-api-key", api_key)
    .header("anthropic-version", "2023-06-01")
    .json(body);
  if body.get("tools").is_some(){call=call.header("anthropic-beta", "web-search-2025-03-05");}
  Ok(call.send().await?)
}

pub async fn test_connection(base_url: String, api_key: String, model: String) -> Result<String> {
  let client = Client::new();
  let body = json!({ "model": model, "max_tokens": 1, "messages": [{ "role": "user", "content": "ping" }] });
  let response = request(&client, &base_url, &api_key, &body).await?;
  if response.status().is_success() { Ok("连接成功：API 可用".into()) }
  else { Err(anyhow!("连接失败（{}）：{}", response.status(), response.text().await.unwrap_or_default())) }
}

pub async fn stream(
  base_url: String,
  api_key: String,
  model: String,
  thinking: String,
  history: Vec<Message>,
  system_prompt: String,
  web_search: bool,
  cancelled: Arc<AtomicBool>,
  mut on_delta: impl FnMut(String) -> Result<()>,
) -> Result<(String, Vec<Source>)> {
  let messages = prepare_messages(&history);
  let modern = model.starts_with("claude-fable-5") || model.starts_with("claude-opus-5") || model.starts_with("claude-sonnet-5") || model.starts_with("claude-opus-4-7") || model.starts_with("claude-opus-4-8") || model.starts_with("claude-sonnet-4-6") || model.starts_with("claude-opus-4-6");
  let budget = if modern { None } else { thinking_budget(&thinking) };
  let mut body = json!({ "model": model, "max_tokens": 4096 + budget.unwrap_or(0), "stream": true, "messages": messages });
  if !system_prompt.trim().is_empty(){body["system"]=json!(system_prompt);}
  if web_search { body["tools"] = json!([{ "type": "web_search_20250305", "name": "web_search", "max_uses": 5 }]); }
  if modern && thinking != "off" { body["thinking"] = json!({ "type": "adaptive" }); body["output_config"] = json!({ "effort": thinking }); }
  else if let Some(budget) = budget { body["thinking"] = json!({ "type": "enabled", "budget_tokens": budget }); }

  let client = Client::new();
  let mut response = request(&client, &base_url, &api_key, &body).await?;
  if response.status().as_u16() == 400 && (budget.is_some() || (modern && thinking != "off")) {
    body.as_object_mut().map(|object| object.remove("thinking"));
    body.as_object_mut().map(|object| object.remove("output_config"));
    body["max_tokens"] = json!(4096);
    response = request(&client, &base_url, &api_key, &body).await?;
  }
  if matches!(response.status().as_u16(),502|503) && !cancelled.load(Ordering::Relaxed) {
    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
    response = request(&client, &base_url, &api_key, &body).await?;
  }
  if !response.status().is_success() {
    if response.status().as_u16()==524 {return Err(anyhow!("API 网关等待上游响应超时（524）。可尝试缩短文档、关闭联网搜索或降低思考强度；若短消息也超时，请检查当前 Base URL 服务。"));}
    if response.status().as_u16()==502 {
      let trace=response.headers().get("request-id").or_else(||response.headers().get("cf-ray")).and_then(|v|v.to_str().ok()).unwrap_or("");
      return Err(anyhow!("API 网关返回 502（已重试一次）。当前模型：{}；联网搜索：{}；思考强度：{}。请先在设置中测试连接，并用纯文本、关闭联网搜索及思考强度 Off 逐项排查。{}",model,if web_search{"开"}else{"关"},thinking,if trace.is_empty(){String::new()}else{format!(" 请求 ID：{}",trace)}));
    }
    return Err(anyhow!("Anthropic API 返回 {}：{}", response.status(), response.text().await.unwrap_or_default()));
  }

  let mut stream = response.bytes_stream();
  let mut buffer = String::new();
  let mut answer = String::new();
  let mut sources = Vec::new();
  while let Some(chunk) = stream.next().await {
    if cancelled.load(Ordering::Relaxed) { break; }
    buffer.push_str(&String::from_utf8_lossy(&chunk?));
    while let Some(end) = buffer.find("\n\n") {
      let block = buffer[..end].to_string();
      buffer.drain(..end + 2);
      let data = block.lines().find_map(|line| line.strip_prefix("data: ")).unwrap_or("");
      if data == "[DONE]" { continue; }
      let Ok(event) = serde_json::from_str::<Value>(data) else { continue; };
      if event["type"] == "content_block_delta" {
        if let Some(text) = event["delta"]["text"].as_str() {
          answer.push_str(text);
          on_delta(text.to_string())?;
        }
        collect_sources(&mut sources, &event["delta"]);
      } else if event["type"] == "content_block_start" {
        collect_sources(&mut sources, &event["content_block"]);
      }
    }
  }
  Ok((answer, sources))
}

fn prepare_messages(history: &[Message]) -> Vec<Value> {
  let mut remaining=MAX_REQUEST_DOCUMENT_CHARS;
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
  messages.reverse();messages
}

#[cfg(test)] mod tests {
  use super::*;
  use crate::database::Attachment;
  #[test] fn limits_document_context_without_losing_user_question() {
    let document=Attachment{id:"a".into(),name:"large.md".into(),mime:"text/markdown".into(),kind:"document".into(),size:30_000,text:Some("中".repeat(30_000)),data:None};
    let message=Message{id:"m".into(),role:"user".into(),content:"请总结".into(),created_at:"".into(),sources:None,attachments:vec![document]};
    let prepared=prepare_messages(&[message]);let sent=prepared[0]["content"].as_str().unwrap();
    assert!(sent.starts_with("请总结\n\n"));
    assert!(sent.contains("前 16000 / 30000 字符"));
    assert_eq!(sent.matches('中').count(),MAX_DOCUMENT_CHARS);
  }
  #[test] fn image_messages_keep_multimodal_blocks() {
    let image=Attachment{id:"a".into(),name:"image.png".into(),mime:"image/png".into(),kind:"image".into(),size:3,text:None,data:Some("YWJj".into())};
    let message=Message{id:"m".into(),role:"user".into(),content:"描述图片".into(),created_at:"".into(),sources:None,attachments:vec![image]};
    let prepared=prepare_messages(&[message]);
    assert_eq!(prepared[0]["content"][1]["type"],"image");
  }
}
