use crate::{
    commands::Settings,
    database::{Message, Source},
    openai::Response,
    recovery::{self, Call, Kind},
};
use anyhow::Result;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

pub const MAX_CONTINUATIONS: usize = 2;
pub const MAX_RECOVERIES: usize = 3;
pub const CONTINUE_PROMPT:&str="上一段回答尚未完成。请从断点继续，直接输出尚未完成的内容，不要重复已输出的段落、标题或代码。保持原来的语言、结构和格式；如果位于代码块或公式内部，请继续该块，不要重新打开。完成用户最初的任务后正常结束。";
pub const CHECK_PROMPT:&str="请检查用户最初的任务与上一条回答：若有遗漏，仅补充尚未完成的内容，不要重写、重复标题或章节；如果已经完整，直接说明已完整。不要重新搜索，不要编造来源。";
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Completion {
    pub status: String,
    pub reason: String,
    pub continuations: usize,
    #[serde(default)]
    pub recoveries: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}
impl Completion {
    pub fn new(reason: &str, continuations: usize) -> Self {
        let status = match reason {
            "length" | "max_tokens" => "length",
            "model_context_window_exceeded" | "context_length_exceeded" => "context_limit",
            "pause_turn" | "tool_use" | "tool_calls" => "paused",
            "content_filter" | "refusal" => "blocked",
            "cancelled" => "stopped",
            "stop" | "end_turn" | "stop_sequence" => "complete",
            _ => "interrupted",
        };
        Self {
            status: status.into(),
            reason: reason.into(),
            continuations,
            recoveries: 0,
            error: None,
        }
    }
}
// Only substantial exact suffix/prefix overlap can be removed, never prose or citations heuristics.
fn without_overlap(previous: &str, next: &str) -> String {
    let tail: Vec<char> = previous
        .chars()
        .rev()
        .take(4096)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    let prefix: Vec<char> = next.chars().take(4096).collect();
    for count in (32..=tail.len().min(prefix.len())).rev() {
        if tail[tail.len() - count..] == prefix[..count] {
            return next.chars().skip(count).collect();
        }
    }
    next.into()
}
fn possible_overlap(previous: &str, prefix: &str) -> bool {
    if prefix.is_empty() {
        return true;
    }
    let tail: Vec<char> = previous
        .chars()
        .rev()
        .take(4096)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    let prefix: Vec<char> = prefix.chars().collect();
    (32..=tail.len()).any(|count| tail[tail.len() - count..].starts_with(&prefix))
}
fn combine_origin(previous: &mut Value, next: &Value, first: bool) {
    for key in ["input", "output", "thinking"] {
        let incoming = next[key].as_str().unwrap_or("unavailable");
        let old = previous[key].as_str().unwrap_or("unavailable");
        previous[key] = json!(if first || old == incoming {
            incoming
        } else {
            "partial"
        });
    }
}
pub async fn stream(
    settings: &Settings,
    key: String,
    history: Vec<Message>,
    system: String,
    search: bool,
    cancelled: Arc<AtomicBool>,
    on_delta: impl FnMut(String) -> Result<()>,
    on_progress: impl FnMut(&str, String),
) -> Result<Response> {
    stream_seeded(
        settings,
        key,
        history,
        system,
        search,
        cancelled,
        None,
        on_delta,
        on_progress,
    )
    .await
}
pub async fn stream_seeded(
    settings: &Settings,
    key: String,
    mut history: Vec<Message>,
    system: String,
    search: bool,
    cancelled: Arc<AtomicBool>,
    seed: Option<Message>,
    mut on_delta: impl FnMut(String) -> Result<()>,
    mut on_progress: impl FnMut(&str, String),
) -> Result<Response> {
    let mut total: Response = (
        seed.as_ref().map(|s| s.content.clone()).unwrap_or_default(),
        seed.as_ref()
            .and_then(|s| s.sources.clone())
            .unwrap_or_default(),
        0,
        0,
        0,
        vec![],
        seed.as_ref()
            .map(|s| s.reasoning_content.clone())
            .unwrap_or_default(),
    );
    let initial_thoughts = total.6.len();
    let mut base_history = history.clone();
    if let Some(seed) = &seed {
        if let Some(index) = base_history.iter().position(|m| m.id == seed.id) {
            base_history.truncate(index)
        }
    }
    let mut origin = json!({"input":"unavailable","output":"unavailable","thinking":"unavailable"});
    let (mut continuations, mut recoveries, mut request_count) = (0, 0, 0);
    let mut first_error = String::new();
    let mut effective_settings=settings.clone();
    loop {
        if cancelled.load(Ordering::Relaxed) {
            let mut completion = Completion::new("cancelled", continuations);
            completion.recoveries = recoveries;
            on_progress("completion", serde_json::to_string(&completion)?);
            return Ok(total);
        }
        let previous = total.0.clone();
        let mut raw = String::new();
        let mut thoughts = String::new();
        let mut prefix = String::new();
        let mut prefix_sent = previous.is_empty();
        let mut reason = String::new();
        let mut partial_sources: Vec<Source> = vec![];
        let mut partial_events = vec![];
        let mut calls: Vec<Call> = vec![];
        let round_started = std::time::Instant::now();
        let mut starts = 0;
        let mut accepted_options=Value::Null;
        let mut round_system = system.clone();
        if request_count > 0 || seed.is_some() {
            round_system.push_str(&recovery::source_context(&total.1));
        }
        let result = crate::provider::stream_once_with_progress(
            &effective_settings,
            key.clone(),
            history.clone(),
            round_system,
            search && request_count == 0 && seed.is_none(),
            cancelled.clone(),
            |text| {
                raw.push_str(&text);
                if prefix_sent {
                    return on_delta(text);
                }
                prefix.push_str(&text);
                if prefix.chars().count() >= 4096 || !possible_overlap(&previous, &prefix) {
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
                "call_start" => {starts += 1;on_progress("call_start",data)},
                "protocol_options"=>{if let Ok(value)=serde_json::from_str::<Value>(&data){accepted_options=value}},
                "call_usage" => {
                    if let Ok(call) = serde_json::from_str::<Call>(&data) {
                        calls.push(call)
                    }
                }
                "usage" | "usage_values" => {}
                "source_snapshot" => {
                    if let Ok(value) = serde_json::from_str::<Value>(&data) {
                        if let Ok(sources) = serde_json::from_value(value["sources"].clone()) {
                            partial_sources = sources
                        }
                        if let Some(events) = value["events"].as_array() {
                            partial_events = events.clone()
                        }
                        let mut combined = total.1.clone();
                        recovery::merge_sources(&mut combined, partial_sources.clone());
                        on_progress("source_snapshot", json!({"sources":combined}).to_string());
                    }
                }
                _ => {
                    if phase == "thinking" {
                        thoughts.push_str(&data)
                    }
                    on_progress(phase, data)
                }
            },
        )
        .await;
        if let Some(options)=accepted_options.as_object(){
            if !effective_settings.request_options.is_object(){effective_settings.request_options=json!({})}
            for (key,value) in options{effective_settings.request_options[key]=value.clone();}
        }
        if !prefix_sent && !prefix.is_empty() {
            let text = without_overlap(&previous, &prefix);
            if !text.is_empty() {
                on_delta(text)?
            }
        }
        request_count += 1;
        let error = result.as_ref().err();
        let failure = error.map(recovery::kind);
        // Missing provider counts stay explicitly unavailable; rejected HTTP requests are still separate calls.
        while calls.len() < starts {
            calls.push(Call{duration_ms:round_started.elapsed().as_millis() as i64,reason:failure.map(|k|format!("{k:?}")).unwrap_or(reason.clone()),origin:json!({"input":"unavailable","output":"unavailable","thinking":"unavailable"}),..Default::default()})
        }
        for call in &calls {
            combine_origin(&mut origin, &call.origin, total.2 == 0 && total.3 == 0);
            total.2 += call.input;
            total.3 += call.output;
            total.4 += call.thinking;
            on_progress("call_usage", serde_json::to_string(call)?)
        }
        let segment = match &result {
            Ok(response) => response.clone(),
            Err(_) => (raw, partial_sources, 0, 0, 0, partial_events, thoughts),
        };
        let added = if previous.is_empty() {
            segment.0.clone()
        } else {
            without_overlap(&previous, &segment.0)
        };
        total.0.push_str(&added);
        recovery::merge_sources(&mut total.1, segment.1);
        total.5.extend(segment.5);
        total.6.push_str(&segment.6);
        if let Some(kind) = failure {
            reason = match kind {
                Kind::Context => "model_context_window_exceeded",
                Kind::Safety => "refusal",
                Kind::Cancelled => "cancelled",
                _ => "interrupted",
            }
            .into()
        }
        if cancelled.load(Ordering::Relaxed) {
            reason = "cancelled".into()
        }
        let mut completion = Completion::new(&reason, continuations);
        completion.recoveries = recoveries;
        if let Some(error) = error {
            let detail = error.to_string();
            if first_error.is_empty() {
                first_error = detail.clone()
            }
            completion.error = Some(if first_error == detail {
                detail
            } else {
                format!("首次中断：{first_error}\n最后一次恢复失败：{detail}")
            });
        }
        let recoverable = matches!(
            failure,
            Some(Kind::Network | Kind::Stream | Kind::RateLimit | Kind::Gateway)
        );
        let length = completion.status == "length"
            && continuations < settings.auto_continuations.min(MAX_CONTINUATIONS)
            && !added.trim().is_empty();
        let retry = recoverable && recoveries < settings.auto_recoveries.min(MAX_RECOVERIES) && completion.status != "stopped";
        if result.is_ok()
            && !previous.is_empty()
            && added.trim().is_empty()
            && !segment.0.is_empty()
        {
            completion.status = "interrupted".into();
            completion.reason = "no_progress".into();
            completion.error = Some("续写仅返回已有内容，已停止自动请求，避免重复。".into());
        } else if length || retry {
            if length {
                continuations += 1;
            } else {
                recoveries += 1;
            }
            on_progress(
                "continuing",
                format!(
                    "正在自动续写（第 {} 次）{}",
                    continuations + recoveries,
                    if retry { " · 正在恢复连接" } else { "" }
                ),
            );
            on_progress("checkpoint",json!({"content":total.0,"reasoningContent":total.6,"sources":total.1,"generation":completion}).to_string());
            if retry && !recovery::backoff(recoveries - 1, error.unwrap(), &cancelled).await {
                continue;
            }
            // One accumulated assistant context, rather than a growing chain of synthetic user turns.
            history = base_history.clone();
            if !total.0.is_empty() {
                if seed.is_some() {
                    history.retain(|m| seed.as_ref().map(|s| s.id != m.id).unwrap_or(true));
                }
                history.push(Message {
                    id: "continuation-answer".into(),
                    role: "assistant".into(),
                    content: total.0.clone(),
                    reasoning_content: total.6[initial_thoughts..].into(),
                    ..Default::default()
                });
                history.push(Message {
                    id: "continuation-instruction".into(),
                    role: "user".into(),
                    content: CONTINUE_PROMPT.into(),
                    ..Default::default()
                });
            }
            continue;
        }
        on_progress("usage", origin.to_string());
        on_progress("completion", serde_json::to_string(&completion)?);
        return Ok(total);
    }
}
#[cfg(test)]
#[path = "generation_recovery_tests.rs"]
mod recovery_tests;
#[cfg(test)]
#[path = "generation_tests.rs"]
mod tests;
