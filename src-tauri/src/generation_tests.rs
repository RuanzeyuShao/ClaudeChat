use super::*;

fn settings(provider: &str, base: &str) -> Settings {
    serde_json::from_value(json!({"apiKey":"","baseUrl":base,"provider":provider,"model":"user-model","thinking":"off","webSearch":false,"theme":"light"})).unwrap()
}
fn sse(value: Value) -> String {
    format!("data: {value}\n\n")
}
fn response(provider: &str, text: &str, reason: &str) -> String {
    if provider == "anthropic-compatible" {
        sse(json!({"type":"message_start","message":{"usage":{"input_tokens":7}}}))
            + &sse(json!({"type":"content_block_delta","delta":{"text":text}}))
            + &sse(
                json!({"type":"message_delta","delta":{"stop_reason":reason},"usage":{"output_tokens":4}}),
            )
            + &sse(json!({"type":"message_stop"}))
    } else {
        sse(json!({"choices":[{"delta":{"content":text},"finish_reason":null}]}))
            + &sse(
                json!({"choices":[{"delta":{},"finish_reason":reason}],"usage":{"prompt_tokens":7,"completion_tokens":4}}),
            )
            + "data: [DONE]\n\n"
    }
}
fn history() -> Vec<Message> {
    vec![Message {
        id: "u".into(),
        role: "user".into(),
        content: "请写一份完整的长报告".into(),
        ..Default::default()
    }]
}

#[tokio::test]
async fn output_limit_continues_one_answer_for_all_seven_providers_and_sums_usage() {
    for provider in [
        "anthropic-compatible",
        "openai",
        "openai-compatible",
        "deepseek",
        "moonshot",
        "zhipu",
        "grok",
    ] {
        let length = if provider == "anthropic-compatible" {
            "max_tokens"
        } else {
            "length"
        };
        let end = if provider == "anthropic-compatible" {
            "end_turn"
        } else {
            "stop"
        };
        let first = "长文本第一部分。".repeat(4000);
        let second = "最后一部分，完整结束。";
        let (base, server) = crate::test_http::serve_observed(vec![
            (200, "text/event-stream", response(provider, &first, length)),
            (200, "text/event-stream", response(provider, second, end)),
        ]);
        let mut visible = String::new();
        let mut progress = vec![];
        let result = stream(
            &settings(provider, &base),
            "mock".into(),
            history(),
            "original system".into(),
            false,
            Arc::new(AtomicBool::new(false)),
            |text| {
                visible.push_str(&text);
                Ok(())
            },
            |phase, data| progress.push((phase.to_string(), data)),
        )
        .await
        .unwrap();
        assert_eq!(result.0, format!("{first}{second}"));
        assert_eq!(visible, result.0);
        assert_eq!((result.2, result.3), (14, 8));
        let completion: Value = serde_json::from_str(
            &progress
                .iter()
                .find(|(phase, _)| phase == "completion")
                .unwrap()
                .1,
        )
        .unwrap();
        assert_eq!(completion["status"], "complete");
        assert_eq!(completion["continuations"], 1);
        assert!(progress.iter().any(|(phase, _)| phase == "continuing"));
        let requests = server.join().unwrap();
        assert_eq!(requests.len(), 2);
        assert_eq!(requests[0].body["model"], "user-model");
        assert_eq!(requests[1].body["model"], "user-model");
        assert!(requests[1].body["messages"]
            .to_string()
            .contains("长文本第一部分"));
        assert!(requests[1].body["messages"]
            .to_string()
            .contains("请写一份完整的长报告"));
        assert!(requests[1].body["messages"]
            .to_string()
            .contains("不要重复"));
        if provider == "anthropic-compatible" {
            assert_eq!(requests[0].body["max_tokens"], 8192);
            assert_eq!(requests[1].body["system"], "original system");
        }
    }
}

#[tokio::test]
async fn explicit_output_limits_survive_continuation() {
    for provider in ["anthropic-compatible", "openai"] {
        let (base, server) = crate::test_http::serve_observed(vec![
            (
                200,
                "text/event-stream",
                response(
                    provider,
                    "first",
                    if provider == "openai" {
                        "length"
                    } else {
                        "max_tokens"
                    },
                ),
            ),
            (
                200,
                "text/event-stream",
                response(
                    provider,
                    "last",
                    if provider == "openai" {
                        "stop"
                    } else {
                        "end_turn"
                    },
                ),
            ),
        ]);
        let mut selection = settings(provider, &base);
        selection.request_options = json!({"max_tokens":123});
        stream(
            &selection,
            "mock".into(),
            history(),
            String::new(),
            false,
            Arc::new(AtomicBool::new(false)),
            |_| Ok(()),
            |_, _| {},
        )
        .await
        .unwrap();
        for request in server.join().unwrap() {
            assert_eq!(
                request.body[if provider == "openai" {
                    "max_completion_tokens"
                } else {
                    "max_tokens"
                }],
                123
            );
        }
    }
}

#[tokio::test]
async fn legacy_output_limit_fallback_preserves_other_profile_options() {
    let (base, server) = crate::test_http::serve_observed(vec![
        (
            400,
            "application/json",
            json!({"error":{"message":"max_tokens exceeds maximum 4096"}}).to_string(),
        ),
        (
            200,
            "text/event-stream",
            response("anthropic-compatible", "legacy answer", "end_turn"),
        ),
    ]);
    let mut selection = settings("anthropic-compatible", &base);
    selection.request_options = json!({"temperature":0.5});
    let result = stream(
        &selection,
        "mock".into(),
        history(),
        String::new(),
        false,
        Arc::new(AtomicBool::new(false)),
        |_| Ok(()),
        |_, _| {},
    )
    .await
    .unwrap();
    assert_eq!(result.0, "legacy answer");
    let requests = server.join().unwrap();
    assert_eq!(requests[0].body["max_tokens"], 8192);
    assert_eq!(requests[1].body["max_tokens"], 4096);
    assert_eq!(requests[1].body["temperature"], 0.5);
}

#[tokio::test]
async fn interrupted_stream_keeps_partial_text_reasoning_sources_and_reported_tokens() {
    for provider in ["anthropic-compatible", "deepseek"] {
        let partial = if provider == "anthropic-compatible" {
            sse(json!({"type":"message_start","message":{"usage":{"input_tokens":7}}}))
                + &sse(json!({"type":"content_block_delta","delta":{"thinking":"已有思考"}}))
                + &sse(
                    json!({"type":"content_block_start","content_block":{"type":"web_search_result","url":"https://example.com","title":"source"}}),
                )
                + &sse(json!({"type":"content_block_delta","delta":{"text":"已经生成的重要段落"}}))
        } else {
            sse(
                json!({"choices":[{"delta":{"reasoning_content":"已有思考","content":"已经生成的重要段落","annotations":[{"url_citation":{"url":"https://example.com","title":"source"}}]}}],"usage":{"prompt_tokens":7}}),
            )
        };
        let (base, server) = crate::test_http::serve(vec![(200, "text/event-stream", partial)]);
        let mut visible = String::new();
        let mut completion = Value::Null;
        let result = stream(
            &settings(provider, &base),
            "mock".into(),
            history(),
            String::new(),
            false,
            Arc::new(AtomicBool::new(false)),
            |text| {
                visible.push_str(&text);
                Ok(())
            },
            |phase, data| {
                if phase == "completion" {
                    completion = serde_json::from_str(&data).unwrap()
                }
            },
        )
        .await
        .unwrap();
        assert_eq!(result.0, "已经生成的重要段落");
        assert_eq!(visible, result.0);
        assert_eq!(result.6, "已有思考");
        assert_eq!(result.2, 7);
        assert_eq!(result.3, 0);
        assert_eq!(result.1.len(), 1);
        assert_eq!(completion["status"], "interrupted");
        assert!(completion["error"].as_str().unwrap().contains("完成标记"));
        assert_eq!(server.join().unwrap().len(), 1);
    }
}

#[tokio::test]
async fn a_failed_continuation_preserves_the_previous_complete_segment() {
    let (base, server) = crate::test_http::serve(vec![
        (
            200,
            "text/event-stream",
            response("openai", "previous content", "length"),
        ),
        (
            503,
            "application/json",
            json!({"error":"upstream unavailable"}).to_string(),
        ),
    ]);
    let mut completion = Value::Null;
    let result = stream(
        &settings("openai", &base),
        "mock".into(),
        history(),
        String::new(),
        false,
        Arc::new(AtomicBool::new(false)),
        |_| Ok(()),
        |phase, data| {
            if phase == "completion" {
                completion = serde_json::from_str(&data).unwrap()
            }
        },
    )
    .await
    .unwrap();
    assert_eq!(result.0, "previous content");
    assert_eq!((result.2, result.3), (7, 4));
    assert_eq!(completion["status"], "interrupted");
    assert_eq!(completion["continuations"], 1);
    assert_eq!(server.join().unwrap().len(), 2);
}

#[tokio::test]
async fn continuation_is_bounded_and_zero_output_does_not_loop() {
    for empty in [false, true] {
        let count = if empty { 1 } else { MAX_CONTINUATIONS + 1 };
        let responses = (0..count)
            .map(|i| {
                (
                    200,
                    "text/event-stream",
                    response(
                        "openai",
                        if empty {
                            ""
                        } else {
                            if i % 2 == 0 {
                                "A"
                            } else {
                                "B"
                            }
                        },
                        "length",
                    ),
                )
            })
            .collect();
        let (base, server) = crate::test_http::serve(responses);
        let mut completion = Value::Null;
        let result = stream(
            &settings("openai", &base),
            "mock".into(),
            history(),
            String::new(),
            false,
            Arc::new(AtomicBool::new(false)),
            |_| Ok(()),
            |phase, data| {
                if phase == "completion" {
                    completion = serde_json::from_str(&data).unwrap()
                }
            },
        )
        .await
        .unwrap();
        assert_eq!(result.0.len(), if empty { 0 } else { count });
        assert_eq!(completion["status"], "length");
        assert_eq!(server.join().unwrap().len(), count);
    }
}

#[tokio::test]
async fn cancellation_between_segments_prevents_another_request() {
    let (base, server) = crate::test_http::serve(vec![(
        200,
        "text/event-stream",
        response("openai", "keep partial", "length"),
    )]);
    let cancelled = Arc::new(AtomicBool::new(false));
    let signal = cancelled.clone();
    let mut completion = Value::Null;
    let result = stream(
        &settings("openai", &base),
        "mock".into(),
        history(),
        String::new(),
        false,
        cancelled,
        |_| Ok(()),
        |phase, data| {
            if phase == "continuing" {
                signal.store(true, Ordering::Relaxed)
            }
            if phase == "completion" {
                completion = serde_json::from_str(&data).unwrap()
            }
        },
    )
    .await
    .unwrap();
    assert_eq!(result.0, "keep partial");
    assert_eq!(completion["status"], "stopped");
    assert_eq!(server.join().unwrap().len(), 1);
}

#[tokio::test]
async fn unicode_overlap_is_not_duplicated_in_stored_or_streamed_content() {
    let overlap = "这是需要避免重复的中文段落。".repeat(4);
    let first = format!("开头。{overlap}");
    let second = format!("{overlap}真正的新内容。");
    let (base, server) = crate::test_http::serve(vec![
        (
            200,
            "text/event-stream",
            response("openai", &first, "length"),
        ),
        (
            200,
            "text/event-stream",
            response("openai", &second, "stop"),
        ),
    ]);
    let mut visible = String::new();
    let result = stream(
        &settings("openai", &base),
        "mock".into(),
        history(),
        String::new(),
        false,
        Arc::new(AtomicBool::new(false)),
        |text| {
            visible.push_str(&text);
            Ok(())
        },
        |_, _| {},
    )
    .await
    .unwrap();
    assert_eq!(result.0, format!("{first}真正的新内容。"));
    assert_eq!(visible, result.0);
    server.join().unwrap();
}

#[tokio::test]
async fn context_limit_and_filter_endings_are_not_automatically_retried() {
    for reason in ["model_context_window_exceeded", "content_filter", "stop"] {
        let (base, server) = crate::test_http::serve(vec![(
            200,
            "text/event-stream",
            response("openai", "retained content", reason),
        )]);
        let mut completion = Value::Null;
        let result = stream(
            &settings("openai", &base),
            "mock".into(),
            history(),
            String::new(),
            false,
            Arc::new(AtomicBool::new(false)),
            |_| Ok(()),
            |phase, data| {
                if phase == "completion" {
                    completion = serde_json::from_str(&data).unwrap()
                }
            },
        )
        .await
        .unwrap();
        assert_eq!(result.0, "retained content");
        assert_eq!(
            completion["status"],
            match reason {
                "content_filter" => "blocked",
                "stop" => "complete",
                _ => "context_limit",
            }
        );
        assert_eq!(server.join().unwrap().len(), 1);
    }
}

#[tokio::test]
async fn transport_failure_after_text_keeps_content_instead_of_dropping_it() {
    use std::{
        io::{Read, Write},
        net::TcpListener,
    };
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let body = sse(json!({"choices":[{"delta":{"content":"网络断开前已经生成的内容"}}]}));
    let server = std::thread::spawn(move || {
        let (mut socket, _) = listener.accept().unwrap();
        let mut buffer = [0; 8192];
        let _ = socket.read(&mut buffer).unwrap();
        write!(socket,"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",body.len()+1000,body).unwrap();
    });
    let mut completion = Value::Null;
    let result = stream(
        &settings("openai", &format!("http://{address}")),
        "mock".into(),
        history(),
        String::new(),
        false,
        Arc::new(AtomicBool::new(false)),
        |_| Ok(()),
        |phase, data| {
            if phase == "completion" {
                completion = serde_json::from_str(&data).unwrap()
            }
        },
    )
    .await
    .unwrap();
    assert_eq!(result.0, "网络断开前已经生成的内容");
    assert_eq!(completion["status"], "interrupted");
    assert!(completion["error"].is_string());
    server.join().unwrap();
}

#[tokio::test]
async fn terminal_events_finish_without_waiting_for_the_http_connection_to_close() {
    use std::{
        io::{Read, Write},
        net::TcpListener,
        time::Duration,
    };
    for provider in ["anthropic-compatible", "openai"] {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let body = response(
            provider,
            "finished",
            if provider == "openai" {
                "stop"
            } else {
                "end_turn"
            },
        );
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            let mut buffer = [0; 8192];
            let _ = socket.read(&mut buffer).unwrap();
            write!(socket,"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n{:x}\r\n{}\r\n",body.len(),body).unwrap();
            socket.flush().unwrap();
            std::thread::sleep(Duration::from_millis(800));
        });
        let result = tokio::time::timeout(
            Duration::from_millis(600),
            stream(
                &settings(provider, &format!("http://{address}")),
                "mock".into(),
                history(),
                String::new(),
                false,
                Arc::new(AtomicBool::new(false)),
                |_| Ok(()),
                |_, _| {},
            ),
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(result.0, "finished");
        server.join().unwrap();
    }
}

#[tokio::test]
async fn malformed_final_event_does_not_erase_previous_valid_output() {
    let body = sse(json!({"choices":[{"delta":{"content":"valid prefix"}}]}))
        + "data: {incomplete-json}\n\n";
    let (base, server) = crate::test_http::serve(vec![(200, "text/event-stream", body)]);
    let mut completion = Value::Null;
    let result = stream(
        &settings("openai", &base),
        "mock".into(),
        history(),
        String::new(),
        false,
        Arc::new(AtomicBool::new(false)),
        |_| Ok(()),
        |phase, data| {
            if phase == "completion" {
                completion = serde_json::from_str(&data).unwrap()
            }
        },
    )
    .await
    .unwrap();
    assert_eq!(result.0, "valid prefix");
    assert_eq!(completion["status"], "interrupted");
    server.join().unwrap();
}
