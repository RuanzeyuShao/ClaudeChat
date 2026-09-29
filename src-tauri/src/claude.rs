use anyhow::{anyhow, Result};
use futures_util::StreamExt;
use reqwest::Client;
use serde_json::{json, Value};
use std::sync::{atomic::{AtomicBool, Ordering}, Arc};

use crate::database::{Message, Source};

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
  Ok(client.post(endpoint(base_url))
    .header("x-api-key", api_key)
    .header("anthropic-version", "2023-06-01")
    .header("anthropic-beta", "web-search-2025-03-05")
    .json(body)
    .send().await?)
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
  web_search: bool,
  cancelled: Arc<AtomicBool>,
  mut on_delta: impl FnMut(String) -> Result<()>,
) -> Result<(String, Vec<Source>)> {
  let messages: Vec<Value> = history.iter()
    .filter(|message| message.role == "user" || message.role == "assistant")
    .map(|message| json!({ "role": message.role, "content": message.content }))
    .collect();
  let modern = model.starts_with("claude-fable-5") || model.starts_with("claude-opus-5") || model.starts_with("claude-sonnet-5") || model.starts_with("claude-opus-4-7") || model.starts_with("claude-opus-4-8") || model.starts_with("claude-sonnet-4-6") || model.starts_with("claude-opus-4-6");
  let budget = if modern { None } else { thinking_budget(&thinking) };
  let mut body = json!({ "model": model, "max_tokens": 4096 + budget.unwrap_or(0), "stream": true, "messages": messages });
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
  if !response.status().is_success() {
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
