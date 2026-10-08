use anyhow::{anyhow, Result};
use futures_util::StreamExt;
use serde_json::{json, Value};

/// Protocol policy is independent of the user's endpoint and model identifier.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum ProviderAdapter {
    Anthropic,
    Compatible,
    OpenAI,
    DeepSeek,
    Moonshot,
    Zhipu,
    Grok,
}
impl ProviderAdapter {
    pub fn new(kind: &str) -> Result<Self> {
        Ok(match kind {
            "anthropic-compatible" => Self::Anthropic,
            "openai-compatible" => Self::Compatible,
            "openai" => Self::OpenAI,
            "deepseek" => Self::DeepSeek,
            "moonshot" => Self::Moonshot,
            "zhipu" => Self::Zhipu,
            "grok" => Self::Grok,
            _ => return Err(anyhow!("未知 Provider")),
        })
    }
    pub fn endpoint(self, base: &str) -> String {
        let base = base.trim().trim_end_matches('/');
        if self == Self::Anthropic {
            if base.ends_with("/messages") {
                base.into()
            } else if base.ends_with("/v1") {
                format!("{base}/messages")
            } else {
                format!("{base}/v1/messages")
            }
        } else if base.ends_with("/chat/completions") {
            base.into()
        } else if base.ends_with("/v1")
            || reqwest::Url::parse(base)
                .map(|u| u.path().trim_matches('/').len() > 0)
                .unwrap_or(false)
        {
            format!("{base}/chat/completions")
        } else {
            format!("{base}/v1/chat/completions")
        }
    }
    pub fn configure(self, body: &mut Value, thinking: &str) {
        match self {
            Self::DeepSeek | Self::Zhipu => {
                body["thinking"] = json!({"type":if thinking=="off"{"disabled"}else{"enabled"}});
            }
            Self::Moonshot => {
                if thinking == "off" {
                    body["thinking"] = json!({"type":"disabled"});
                }
            }
            Self::OpenAI | Self::Compatible | Self::Grok => {
                if thinking != "off" {
                    body["reasoning_effort"] = json!(thinking);
                }
            }
            Self::Anthropic => {
                if thinking != "off" {
                    body["thinking"] = json!({"type":"enabled","budget_tokens":1024});
                    body["max_tokens"] = json!(2048);
                }
            }
        }
    }
    pub fn configure_options(self, body: &mut Value, options: &Value) -> Result<()> {
        if self == Self::OpenAI {
            if let Some(max) = body.as_object_mut().and_then(|b| b.remove("max_tokens")) {
                body["max_completion_tokens"] = max;
            }
        }
        if self == Self::Zhipu {
            body.as_object_mut().map(|b| b.remove("stream_options"));
        }
        if !options.is_null() {
            let options = options
                .as_object()
                .ok_or_else(|| anyhow!("附加请求参数必须是 JSON 对象"))?;
            for (key, value) in options {
                if matches!(
                    key.as_str(),
                    "model" | "messages" | "system" | "tools" | "stream"
                ) {
                    return Err(anyhow!("附加参数不能覆盖 {}", key));
                }
                if value.is_null() {
                    body.as_object_mut().unwrap().remove(key);
                } else {
                    body[key] = value.clone();
                }
            }
        }
        Ok(())
    }
    pub fn configure_search(self, body: &mut Value) -> Result<()> {
        match self {
            Self::Moonshot => {
                body["tools"] =
                    json!([{"type":"builtin_function","function":{"name":"$web_search"}}]);
                Ok(())
            }
            Self::OpenAI => {
                body["web_search_options"] = json!({});
                Ok(())
            }
            Self::Zhipu => {
                body["tools"] = json!([{"type":"web_search","web_search":{"enable":true,"search_result":true}}]);
                Ok(())
            }
            Self::Anthropic => {
                body["tools"] =
                    json!([{"type":"web_search_20250305","name":"web_search","max_uses":5}]);
                Ok(())
            }
            _ => Err(anyhow!(
                "当前 Provider 的内置搜索接口不可用，请配置 SearXNG"
            )),
        }
    }
    pub fn request(
        self,
        client: &reqwest::Client,
        base: &str,
        key: &str,
        body: &Value,
    ) -> reqwest::RequestBuilder {
        let call = client.post(self.endpoint(base)).json(body);
        if self == Self::Anthropic {
            call.header("x-api-key", key)
                .header("anthropic-version", "2023-06-01")
        } else {
            call.bearer_auth(key)
        }
    }
}

pub async fn send_cancellable(
    request: reqwest::RequestBuilder,
    cancelled: &std::sync::atomic::AtomicBool,
) -> Result<reqwest::Response> {
    if cancelled.load(std::sync::atomic::Ordering::Relaxed) {
        return Err(anyhow!("已停止生成"));
    }
    let pending = request.send();
    tokio::pin!(pending);
    loop {
        tokio::select! {response=&mut pending=>return Ok(response?),_=tokio::time::sleep(std::time::Duration::from_millis(100))=>{if cancelled.load(std::sync::atomic::Ordering::Relaxed){return Err(anyhow!("已停止生成"));}}}
    }
}

pub fn default_options(options: &Value) -> bool {
    options.is_null()
        || options
            .as_object()
            .map(|value| value.is_empty())
            .unwrap_or(false)
}

pub async fn stream(
    settings: &crate::commands::Settings,
    key: String,
    history: Vec<crate::database::Message>,
    system: String,
    search: bool,
    cancelled: std::sync::Arc<std::sync::atomic::AtomicBool>,
    on_delta: impl FnMut(String) -> Result<()>,
) -> Result<crate::openai::Response> {
    match ProviderAdapter::new(&settings.provider)? {
        ProviderAdapter::Anthropic => {
            crate::claude::stream(
                settings.base_url.clone(),
                key,
                settings.model.clone(),
                settings.thinking.clone(),
                settings.request_options.clone(),
                history,
                system,
                search,
                cancelled,
                on_delta,
            )
            .await
        }
        _ => {
            crate::openai::stream(
                settings.provider.clone(),
                settings.base_url.clone(),
                key,
                settings.model.clone(),
                settings.thinking.clone(),
                settings.request_options.clone(),
                history,
                system,
                search,
                cancelled,
                on_delta,
            )
            .await
        }
    }
}

/// Evidence-based probes. An HTTP success alone is never proof of a feature.
pub async fn detect(
    kind: &str,
    base: &str,
    key: &str,
    model: &str,
    options: &Value,
) -> Result<Value> {
    let adapter = ProviderAdapter::new(kind)?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(25))
        .build()?;
    let mut seed = json!({"model":model,"max_tokens":64,"messages":[{"role":"user","content":"Reply with OK."}]});
    adapter.configure_options(&mut seed, options)?;
    let mut result = json!({"checkedAt":chrono::Utc::now().to_rfc3339(),"model":model,"baseUrl":base,"provider":kind,"connection":"unknown","streaming":"unknown","thinking":"unknown","vision":"unknown","tool":"unknown","search":"unknown","contextLength":null});
    let response = adapter.request(&client, base, key, &seed).send().await?;
    if !response.status().is_success() {
        result["connection"] = json!("failed");
        result["detail"] = json!(format!("HTTP {}", response.status()));
        return Ok(result);
    }
    let value: Value = response.json().await?;
    result["connection"] = json!(if !value["choices"][0]["message"].is_null()
        || value["content"].is_array()
    {
        "supported"
    } else {
        "unknown"
    });
    for feature in ["streaming", "thinking", "tool", "vision", "search"] {
        let mut body = seed.clone();
        match feature {
            "search" => {
                if adapter.configure_search(&mut body).is_err() {
                    continue;
                }
                body["messages"][0]["content"] = json!("Search the web for the current date.");
            }
            "streaming" => body["stream"] = json!(true),
            "thinking" => adapter.configure(&mut body, "low"),
            "tool" => {
                body["messages"][0]["content"] = json!("Call capability_probe with no arguments.");
                body["tools"] = if adapter == ProviderAdapter::Anthropic {
                    json!([{"name":"capability_probe","description":"Connection probe only","input_schema":{"type":"object","properties":{}}}])
                } else {
                    json!([{"type":"function","function":{"name":"capability_probe","description":"Connection probe only","parameters":{"type":"object","properties":{}}}}])
                };
            }
            "vision" => {
                let image="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=";
                body["messages"][0]["content"] = if adapter == ProviderAdapter::Anthropic {
                    json!([{"type":"text","text":"Describe the image."},{"type":"image","source":{"type":"base64","media_type":"image/png","data":image}}])
                } else {
                    json!([{"type":"text","text":"Describe the image."},{"type":"image_url","image_url":{"url":format!("data:image/png;base64,{image}")}}])
                };
            }
            _ => {}
        }
        adapter.configure_options(&mut body, options)?;
        let mut response = match adapter.request(&client, base, key, &body).send().await {
            Ok(r) => r,
            Err(_) => continue,
        };
        if response.status().as_u16() == 400
            && feature == "thinking"
            && adapter == ProviderAdapter::Anthropic
            && default_options(options)
        {
            body["thinking"] = json!({"type":"adaptive"});
            if let Ok(retry) = adapter.request(&client, base, key, &body).send().await {
                response = retry;
            }
        }
        if !response.status().is_success() {
            let status = response.status().as_u16();
            if matches!(status, 400 | 422) {
                result[feature] = json!("rejected");
            }
            continue;
        }
        if feature == "streaming" {
            let mut stream = response.bytes_stream();
            let mut bytes = Vec::new();
            while let Some(chunk) = stream.next().await {
                match chunk {
                    Ok(c) => bytes.extend(c),
                    Err(_) => break,
                }
                if bytes.len() > 8192 {
                    break;
                }
            }
            let text = String::from_utf8_lossy(&bytes);
            if text.contains("data:") && (text.contains("delta") || text.contains("message_start"))
            {
                result[feature] = json!("supported");
            }
            continue;
        }
        let Ok(value) = response.json::<Value>().await else {
            continue;
        };
        let serialized = value.to_string();
        let proven = match feature {
            "search" => {
                value["web_search"]
                    .as_array()
                    .map(|v| !v.is_empty())
                    .unwrap_or(false)
                    || serialized.contains("web_search_tool_result")
                    || serialized.contains("$web_search")
                    || serialized.contains("url_citation")
            }
            "thinking" => {
                value["choices"][0]["message"]["reasoning_content"]
                    .as_str()
                    .map(|s| !s.is_empty())
                    .unwrap_or(false)
                    || value["content"]
                        .as_array()
                        .map(|items| {
                            items.iter().any(|item| {
                                item["type"] == "thinking"
                                    && item["thinking"]
                                        .as_str()
                                        .map(|s| !s.is_empty())
                                        .unwrap_or(false)
                            })
                        })
                        .unwrap_or(false)
                    || value["usage"]["completion_tokens_details"]["reasoning_tokens"]
                        .as_i64()
                        .unwrap_or(0)
                        > 0
            }
            "tool" => {
                value["choices"][0]["message"]["tool_calls"]
                    .as_array()
                    .map(|items| !items.is_empty())
                    .unwrap_or(false)
                    || value["content"]
                        .as_array()
                        .map(|items| items.iter().any(|item| item["type"] == "tool_use"))
                        .unwrap_or(false)
            }
            "vision" => {
                !value["choices"][0]["message"]["content"].is_null() || value["content"].is_array()
            }
            _ => false,
        };
        result[feature] = json!(if proven {
            if feature == "vision" {
                "accepted"
            } else {
                "supported"
            }
        } else {
            "unknown"
        });
    }
    // No destructive oversized context probes. Read only explicit model metadata.
    let endpoint = adapter.endpoint(base);
    let models = endpoint
        .rsplit_once(if adapter == ProviderAdapter::Anthropic {
            "/messages"
        } else {
            "/chat/completions"
        })
        .map(|(prefix, _)| format!("{prefix}/models"));
    if let Some(url) = models {
        let request = client.get(url);
        let request = if adapter == ProviderAdapter::Anthropic {
            request
                .header("x-api-key", key)
                .header("anthropic-version", "2023-06-01")
        } else {
            request.bearer_auth(key)
        };
        if let Ok(response) = request.send().await {
            if let Ok(value) = response.json::<Value>().await {
                if let Some(item) = value["data"]
                    .as_array()
                    .and_then(|items| items.iter().find(|item| item["id"] == model))
                {
                    for field in ["context_length", "context_window", "max_context_tokens"] {
                        if item[field].is_u64() {
                            result["contextLength"] = item[field].clone();
                            break;
                        }
                    }
                }
            }
        }
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn custom_routes_remain_custom() {
        assert_eq!(
            ProviderAdapter::Zhipu.endpoint("https://example.com/api/paas/v4"),
            "https://example.com/api/paas/v4/chat/completions"
        );
        assert_eq!(
            ProviderAdapter::Moonshot.endpoint("https://example.com/v1"),
            "https://example.com/v1/chat/completions"
        );
    }
    #[test]
    fn policies_are_explicit() {
        let mut b = json!({});
        ProviderAdapter::DeepSeek.configure(&mut b, "off");
        assert_eq!(b["thinking"]["type"], "disabled");
        let mut b = json!({});
        ProviderAdapter::OpenAI.configure(&mut b, "high");
        assert_eq!(b["reasoning_effort"], "high");
    }
}

#[cfg(test)]
mod probe_tests {
    use super::*;
    #[tokio::test]
    async fn capabilities_use_response_evidence_and_model_metadata() {
        let ordinary = json!({"choices":[{"message":{"content":"OK"}}]}).to_string();
        let reasoning =
            json!({"choices":[{"message":{"content":"OK","reasoning_content":"thought"}}]})
                .to_string();
        let tool=json!({"choices":[{"message":{"tool_calls":[{"id":"probe","function":{"name":"capability_probe"}}]}}]}).to_string();
        let models = json!({"data":[{"id":"custom","context_length":12345}]}).to_string();
        let (base, server) = crate::test_http::serve(vec![
            (200, "application/json", ordinary.clone()),
            (
                200,
                "text/event-stream",
                "data: {\"choices\":[{\"delta\":{\"content\":\"OK\"}}]}\n\n".into(),
            ),
            (200, "application/json", reasoning),
            (200, "application/json", tool),
            (200, "application/json", ordinary.clone()),
            (200, "application/json", ordinary),
            (200, "application/json", models),
        ]);
        let result = detect("openai", &base, "mock", "custom", &Value::Null)
            .await
            .unwrap();
        assert_eq!(result["streaming"], "supported");
        assert_eq!(result["thinking"], "supported");
        assert_eq!(result["tool"], "supported");
        assert_eq!(result["vision"], "accepted");
        assert_eq!(result["search"], "unknown");
        assert_eq!(result["contextLength"], 12345);
        assert_eq!(server.join().unwrap().len(), 7);
    }
}
