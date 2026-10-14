use crate::{
    commands::Settings,
    database::{Message, Source},
    openai::Response,
};
use anyhow::Result;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

pub const MAX_CONTINUATIONS: usize = 8;
const CONTINUE_PROMPT:&str="上一段回答因输出长度上限被截断。请从断点继续，直接输出尚未完成的内容，不要重复已输出的段落、标题或代码。保持原来的语言、结构和格式；如果位于代码块或公式内部，请继续该块，不要重新打开。完成用户最初的任务后正常结束。";

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Completion {
    pub status: String,
    pub reason: String,
    pub continuations: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}
impl Completion {
    fn new(reason: &str, continuations: usize) -> Self {
        let status = match reason {
            "length" | "max_tokens" => "length",
            "model_context_window_exceeded" => "context_limit",
            "pause_turn" | "tool_use" => "paused",
            "content_filter" | "refusal" => "blocked",
            "cancelled" => "stopped",
            "interrupted" => "interrupted",
            _ => "complete",
        };
        Self {
            status: status.into(),
            reason: reason.into(),
            continuations,
            error: None,
        }
    }
}

// Strip only substantial exact overlap, never short words or common punctuation.
fn without_overlap(previous: &str, next: &str) -> String {
    let tail: Vec<char> = previous
        .chars()
        .rev()
        .take(256)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    let prefix: Vec<char> = next.chars().take(256).collect();
    for count in (32..=tail.len().min(prefix.len())).rev() {
        if tail[tail.len() - count..] == prefix[..count] {
            return next.chars().skip(count).collect();
        }
    }
    next.to_string()
}
fn combine_origin(previous: &mut Value, next: &Value, first: bool) {
    for key in ["input", "output", "thinking"] {
        let incoming = next[key].as_str().unwrap_or("unavailable");
        let old = previous[key].as_str().unwrap_or("unavailable");
        previous[key] = json!(if first || old == incoming {
            incoming
        } else if key == "thinking" && (old == "estimated" || incoming == "estimated") {
            "estimated"
        } else {
            "partial"
        });
    }
}

pub async fn stream(
    settings: &Settings,
    key: String,
    mut history: Vec<Message>,
    system: String,
    search: bool,
    cancelled: Arc<AtomicBool>,
    mut on_delta: impl FnMut(String) -> Result<()>,
    mut on_progress: impl FnMut(&str, String),
) -> Result<Response> {
    let mut total: Response = (String::new(), vec![], 0, 0, 0, vec![], String::new());
    let mut origin = json!({"input":"unavailable","output":"unavailable","thinking":"unavailable"});
    for round in 0..=MAX_CONTINUATIONS {
        if round > 0 && cancelled.load(Ordering::Relaxed) {
            on_progress("usage", origin.to_string());
            on_progress(
                "completion",
                serde_json::to_string(&Completion::new("cancelled", round - 1))?,
            );
            return Ok(total);
        }
        let previous = total.0.clone();
        let mut raw = String::new();
        let mut thoughts = String::new();
        let mut prefix = String::new();
        let mut prefix_sent = round == 0;
        let mut reason = String::new();
        let mut values = [0_i64; 3];
        let mut partial_sources: Vec<Source> = vec![];
        let mut partial_events = vec![];
        let mut round_origin =
            json!({"input":"unavailable","output":"unavailable","thinking":"unavailable"});
        let result = crate::provider::stream_once_with_progress(
            settings,
            key.clone(),
            history.clone(),
            system.clone(),
            search && round == 0,
            cancelled.clone(),
            |text| {
                raw.push_str(&text);
                if prefix_sent {
                    return on_delta(text);
                }
                prefix.push_str(&text);
                if prefix.chars().count() >= 256 {
                    let text = without_overlap(&previous, &prefix);
                    prefix.clear();
                    prefix_sent = true;
                    if !text.is_empty() {
                        on_delta(text)?
                    }
                }
                Ok(())
            },
            |phase, data| match phase {
                "finish" => reason = data,
                "usage_values" => {
                    if let Ok(value) = serde_json::from_str::<Value>(&data) {
                        for (index, key) in ["input", "output", "thinking"].iter().enumerate() {
                            if let Some(count) = value[*key].as_i64() {
                                values[index] = count
                            }
                        }
                    }
                }
                "usage" => {
                    if let Ok(value) = serde_json::from_str::<Value>(&data) {
                        for key in ["input", "output", "thinking"] {
                            if value[key].is_string() {
                                round_origin[key] = value[key].clone()
                            }
                        }
                    }
                }
                "source_snapshot" => {
                    if let Ok(value) = serde_json::from_str::<Value>(&data) {
                        if let Ok(sources) = serde_json::from_value(value["sources"].clone()) {
                            partial_sources = sources
                        }
                        if let Some(events) = value["events"].as_array() {
                            partial_events = events.clone()
                        }
                    }
                }
                _ => {
                    if phase == "thinking" {
                        thoughts.push_str(&data);
                        if round_origin["thinking"] != "provider" {
                            round_origin["thinking"] = json!("estimated")
                        }
                    }
                    on_progress(phase, data)
                }
            },
        )
        .await;
        if !prefix_sent && !prefix.is_empty() {
            let text = without_overlap(&previous, &prefix);
            if !text.is_empty() {
                on_delta(text)?
            }
        }
        combine_origin(&mut origin, &round_origin, round == 0);
        let (segment, error) = match result {
            Ok(response) => (response, None),
            Err(error) => {
                if total.0.is_empty() && raw.is_empty() && total.6.is_empty() && thoughts.is_empty()
                {
                    return Err(error);
                }
                let message = error.to_string();
                reason = if message.contains("context_length_exceeded")
                    || message.contains("model_context_window_exceeded")
                {
                    "model_context_window_exceeded"
                } else {
                    "interrupted"
                }
                .into();
                (
                    (
                        raw.clone(),
                        partial_sources,
                        values[0],
                        values[1],
                        values[2],
                        partial_events,
                        thoughts,
                    ),
                    Some(message),
                )
            }
        };
        let added = if round == 0 {
            segment.0.clone()
        } else {
            without_overlap(&previous, &segment.0)
        };
        total.0.push_str(&added);
        total.1.extend(segment.1);
        total.2 += segment.2;
        total.3 += segment.3;
        total.4 += segment.4;
        total.5.extend(segment.5);
        total.6.push_str(&segment.6);
        let mut completion = Completion::new(
            if cancelled.load(Ordering::Relaxed) {
                "cancelled"
            } else {
                &reason
            },
            round,
        );
        completion.error = error;
        if completion.status == "length" && round < MAX_CONTINUATIONS && !added.trim().is_empty() {
            history.push(Message {
                id: format!("continuation-answer-{round}"),
                role: "assistant".into(),
                content: added,
                reasoning_content: segment.6,
                ..Default::default()
            });
            history.push(Message {
                id: format!("continuation-prompt-{round}"),
                role: "user".into(),
                content: CONTINUE_PROMPT.into(),
                ..Default::default()
            });
            on_progress(
                "continuing",
                format!("已达到单次输出上限，正在自动续写（{}）", round + 1),
            );
            continue;
        }
        on_progress("usage", origin.to_string());
        on_progress("completion", serde_json::to_string(&completion)?);
        return Ok(total);
    }
    unreachable!("the final round always returns")
}

#[cfg(test)]
#[path = "generation_tests.rs"]
mod tests;
