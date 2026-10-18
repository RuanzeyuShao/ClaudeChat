use super::*;
fn settings(provider: &str, base: &str) -> Settings {
    serde_json::from_value(json!({"autoContinuations":2,"autoRecoveries":3,"apiKey":"","baseUrl":base,"provider":provider,"model":"custom","thinking":"off","webSearch":false,"theme":"system"})).unwrap()
}
fn event(v: Value) -> String {
    format!("data: {v}\n\n")
}
fn done(text: &str) -> String {
    event(
        json!({"choices":[{"delta":{"content":text},"finish_reason":"stop"}],"usage":{"prompt_tokens":11,"completion_tokens":5}}),
    ) + "data: [DONE]\n\n"
}
fn history() -> Vec<Message> {
    vec![Message {
        role: "user".into(),
        content: "完成原始任务".into(),
        ..Default::default()
    }]
}
#[tokio::test]
async fn default_configuration_stops_after_one_continuation_and_disables_automatic_recovery(){
    let segment=|text:&str|event(json!({"choices":[{"delta":{"content":text},"finish_reason":"length"}]}));
    let(base,server)=crate::test_http::serve(vec![(200,"text/event-stream",segment("first")),(200,"text/event-stream",segment("second"))]);
    let config:Settings=serde_json::from_value(json!({"apiKey":"","baseUrl":base,"provider":"openai","model":"custom","thinking":"off","webSearch":false,"theme":"system"})).unwrap();
    assert_eq!(config.auto_continuations,1);assert_eq!(config.auto_recoveries,0);
    let mut completion=Value::Null;
    stream(&config,"mock".into(),history(),String::new(),false,Arc::new(AtomicBool::new(false)),|_|Ok(()),|phase,data|if phase=="completion"{completion=serde_json::from_str(&data).unwrap()}).await.unwrap();
    assert_eq!(completion["continuations"],1);assert_eq!(completion["status"],"length");assert_eq!(server.join().unwrap().len(),2);
    let(base,server)=crate::test_http::serve(vec![(503,"application/json","gateway unavailable".into())]);let mut config=config;config.base_url=base;
    stream(&config,"mock".into(),history(),String::new(),false,Arc::new(AtomicBool::new(false)),|_|Ok(()),|phase,data|if phase=="completion"{completion=serde_json::from_str(&data).unwrap()}).await.unwrap();
    assert_eq!(completion["recoveries"],0);assert_eq!(server.join().unwrap().len(),1);
}
async fn run(provider: &str, base: &str, search: bool) -> (Response, Value, Vec<Call>) {
    let mut completion = Value::Null;
    let mut calls = vec![];
    let result = stream(
        &settings(provider, base),
        "mock".into(),
        history(),
        String::new(),
        search,
        Arc::new(AtomicBool::new(false)),
        |_| Ok(()),
        |phase, data| {
            if phase == "completion" {
                completion = serde_json::from_str(&data).unwrap()
            }
            if phase == "call_usage" {
                calls.push(serde_json::from_str(&data).unwrap())
            }
        },
    )
    .await
    .unwrap();
    (result, completion, calls)
}
#[tokio::test]
async fn unexpected_eof_and_real_transport_drop_resume_with_sources_and_exact_overlap() {
    for kind in ["text/event-stream", "text/event-stream; truncated"] {
        let prefix = "已生成并保存的原始段落，内容不会丢失，引用与思考过程必须保留。".repeat(3);
        let partial = event(
            json!({"choices":[{"delta":{"content":prefix,"reasoning_content":"已有思考","annotations":[{"url_citation":{"url":"https://source.test/original","title":"实际来源","refer":"7"}}]}}],"usage":{"prompt_tokens":7,"completion_tokens":9,"completion_tokens_details":{"reasoning_tokens":2}}}),
        );
        let (base, server) = crate::test_http::serve_observed(vec![
            (200, kind, partial),
            (
                200,
                "text/event-stream",
                done(&(prefix.clone() + "新的结尾。")),
            ),
        ]);
        let mut visible = String::new();
        let mut completion = Value::Null;
        let mut calls: Vec<Call> = vec![];
        let result = stream(
            &settings("openai", &base),
            "mock".into(),
            history(),
            String::new(),
            true,
            Arc::new(AtomicBool::new(false)),
            |s| {
                visible.push_str(&s);
                Ok(())
            },
            |phase, data| {
                if phase == "completion" {
                    completion = serde_json::from_str(&data).unwrap()
                }
                if phase == "call_usage" {
                    calls.push(serde_json::from_str(&data).unwrap())
                }
            },
        )
        .await
        .unwrap();
        assert_eq!(result.0, prefix + "新的结尾。", "{kind}: {completion}");
        assert_eq!(result.0, visible);
        assert_eq!(result.6, "已有思考");
        assert_eq!(result.1[0].citation, "7");
        assert_eq!((result.2, result.3), (18, 14));
        assert_eq!(calls.len(), 2);
        assert_eq!(completion["recoveries"], 1);
        assert_eq!(completion["status"], "complete");
        let requests = server.join().unwrap();
        assert!(requests[0].body.get("web_search_options").is_some());
        assert!(requests[1].body.get("web_search_options").is_none());
        assert!(requests[1].body["messages"]
            .to_string()
            .contains("原始段落"));
        assert!(requests[1].body["messages"]
            .to_string()
            .contains("https://source.test/original"));
    }
}
#[tokio::test]
async fn transient_http_errors_retry_at_most_three_times_and_record_every_call() {
    for status in [429, 502, 503, 504, 524] {
        let mut responses = vec![
            (
                status,
                "application/json",
                json!({"error":{"message":"upstream temporarily unavailable"}}).to_string()
            );
            3
        ];
        responses.push((200, "text/event-stream", done("恢复后的完整回答")));
        let (base, server) = crate::test_http::serve(responses);
        let (result, completion, calls) = run("openai", &base, false).await;
        assert_eq!(result.0, "恢复后的完整回答");
        assert_eq!(completion["recoveries"], 3);
        assert_eq!(completion["status"], "complete");
        assert_eq!(calls.len(), 4);
        assert_eq!((result.2, result.3), (11, 5));
        assert_eq!(server.join().unwrap().len(), 4);
    }
    let (base, server) =
        crate::test_http::serve(vec![(503, "application/json", "unavailable".into()); 4]);
    let (_, completion, calls) = run("openai", &base, false).await;
    assert_eq!(completion["status"], "interrupted");
    assert_eq!(completion["recoveries"], 3);
    assert_eq!(calls.len(), 4);
    assert_eq!(server.join().unwrap().len(), 4);
}
#[tokio::test]
async fn context_safety_quota_and_credentials_are_never_automatically_retried() {
    for (status, error, expected) in [
        (400, "context_length_exceeded", "context_limit"),
        (400, "prompt is too long", "context_limit"),
        (403, "content_policy_violation", "blocked"),
        (429, "insufficient_quota", "interrupted"),
        (401, "invalid_api_key", "interrupted"),
    ] {
        for provider in ["anthropic-compatible", "openai"] {
            let (base, server) = crate::test_http::serve(vec![(
                status,
                "application/json",
                json!({"error":{"message":error}}).to_string(),
            )]);
            let (_, completion, calls) = run(provider, &base, false).await;
            assert_eq!(completion["status"], expected);
            assert_eq!(completion["recoveries"], 0);
            assert_eq!(calls.len(), 1);
            assert_eq!(server.join().unwrap().len(), 1);
        }
    }
}
#[tokio::test]
async fn stop_during_backoff_cancels_without_a_second_request() {
    let (base, server) =
        crate::test_http::serve(vec![(503, "application/json", "upstream error".into())]);
    let cancelled = Arc::new(AtomicBool::new(false));
    let stop = cancelled.clone();
    let mut completion = Value::Null;
    let started = std::time::Instant::now();
    stream(
        &settings("openai", &base),
        "mock".into(),
        history(),
        String::new(),
        false,
        cancelled,
        |_| Ok(()),
        |phase, data| {
            if phase == "continuing" {
                stop.store(true, Ordering::Relaxed)
            }
            if phase == "completion" {
                completion = serde_json::from_str(&data).unwrap()
            }
        },
    )
    .await
    .unwrap();
    assert_eq!(completion["status"], "stopped");
    assert!(started.elapsed().as_millis() < 500);
    assert_eq!(server.join().unwrap().len(), 1);
}
#[tokio::test]
async fn a_normal_finish_is_not_retried_even_without_done_or_final_punctuation() {
    for provider in [
        "openai",
        "deepseek",
        "moonshot",
        "zhipu",
        "grok",
        "openai-compatible",
    ] {
        let body = event(
            json!({"choices":[{"delta":{"content":"正常结束没有标点"},"finish_reason":"stop"}]}),
        );
        let (base, server) = crate::test_http::serve(vec![(200, "text/event-stream", body)]);
        let (_, completion, calls) = run(provider, &base, false).await;
        assert_eq!(completion["status"], "complete");
        assert_eq!(completion["recoveries"], 0);
        assert_eq!(calls.len(), 1);
        server.join().unwrap();
    }
}
#[tokio::test]
async fn a_replayed_segment_stops_as_no_progress_and_never_leaks_duplicate_deltas() {
    let text = "较长的已有章节，确认完全相同后才去重，不能因为标点猜测内容是否完整。".repeat(5);
    let body = |text: &str| {
        event(json!({"choices":[{"delta":{"content":text},"finish_reason":"length"}]}))
            + "data: [DONE]\n\n"
    };
    let (base, server) = crate::test_http::serve(vec![
        (200, "text/event-stream", body(&text)),
        (200, "text/event-stream", body(&text)),
    ]);
    let mut visible = String::new();
    let mut completion = Value::Null;
    let result = stream(
        &settings("deepseek", &base),
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
    assert_eq!(result.0, text);
    assert_eq!(visible, text);
    assert_eq!(completion["reason"], "no_progress");
    assert_eq!(server.join().unwrap().len(), 2);
}
#[tokio::test]
async fn stream_safety_refusal_is_never_recovered_and_an_overload_is() {
    for (error, expected, extra) in [
        ("content_filter", "blocked", false),
        ("overloaded_error", "complete", true),
    ] {
        let mut responses = vec![(
            200,
            "text/event-stream",
            event(json!({"error":{"type":error}})),
        )];
        if extra {
            responses.push((200, "text/event-stream", done("恢复")))
        }
        let (base, server) = crate::test_http::serve(responses);
        let (_, completion, _) = run("openai", &base, false).await;
        assert_eq!(completion["status"], expected);
        assert_eq!(server.join().unwrap().len(), if extra { 2 } else { 1 });
    }
}
#[test]
fn model_budget_caps_are_explicit_and_thinking_always_fits() {
    for provider in [
        crate::provider::ProviderAdapter::OpenAI,
        crate::provider::ProviderAdapter::Anthropic,
        crate::provider::ProviderAdapter::Compatible,
    ] {
        let mut body =
            json!({"max_tokens":16384,"thinking":{"type":"enabled","budget_tokens":8192}});
        provider
            .configure_options(
                &mut body,
                &json!({"max_tokens":16000,"client_max_output_tokens":4096}),
            )
            .unwrap();
        assert_eq!(
            body[if provider == crate::provider::ProviderAdapter::OpenAI {
                "max_completion_tokens"
            } else {
                "max_tokens"
            }],
            4096
        );
        assert!(body.get("client_max_output_tokens").is_none());
        if provider == crate::provider::ProviderAdapter::Anthropic {
            assert!(body["thinking"]["budget_tokens"].as_u64().unwrap() < 4096)
        }
    }
    let mut body = json!({});
    assert!(crate::provider::ProviderAdapter::OpenAI
        .configure_options(&mut body, &json!({"max_tokens":-1}))
        .is_err());
}
#[test]
fn source_context_is_bounded_and_aliases_are_not_renumbered() {
    let source = Source {
        citation: "77".into(),
        url: "https://source.test/a".into(),
        title: "真实来源".into(),
        snippet: "s".repeat(10000),
        anchor: None,
    };
    let mut sources = vec![source.clone()];
    let mut alias = source.clone();
    alias.citation = "88".into();
    recovery::merge_sources(&mut sources, vec![source, alias]);
    assert_eq!(sources.len(), 2);
    let context = recovery::source_context(&sources);
    assert!(context.contains("[77]"));
    assert!(context.contains("[88]"));
    assert!(context.len() < 17000);
    let selected = crate::search::select_sources(sources);
    assert_eq!(selected.len(), 1);
    assert_eq!(selected[0].citation, "77");
}

#[tokio::test]
async fn kimi_tool_results_and_each_api_call_survive_a_gateway_failure_without_searching_again(){
    let tools=event(json!({"choices":[{"delta":{"tool_calls":[{"index":0,"id":"search-call","function":{"name":"$web_search","arguments":"{\"results\":[{\"url\":\"https://real.test/source\",\"title\":\"Actual source\"}]}"}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":3,"completion_tokens":2}}))+"data: [DONE]\n\n";
    let (base,server)=crate::test_http::serve_observed(vec![(200,"text/event-stream",tools),(503,"application/json","upstream unavailable".into()),(200,"text/event-stream",done("根据来源完成回答。[1]"))]);
    let (result,completion,calls)=run("moonshot",&base,true).await;assert_eq!(completion["status"],"complete");assert_eq!(calls.len(),3);assert_eq!((result.2,result.3),(14,7));assert_eq!(result.1[0].citation,"1");
    let requests=server.join().unwrap();assert!(requests[0].body.get("tools").is_some());assert!(requests[1].body.get("tools").is_some());assert!(requests[2].body.get("tools").is_none());assert!(requests[2].body["messages"].to_string().contains("https://real.test/source"));
}

#[tokio::test]
async fn an_explicit_finish_without_done_does_not_wait_for_a_hanging_gateway(){
    use std::{io::{Read,Write},net::TcpListener,time::Duration};
    for provider in ["openai","anthropic-compatible"] {
        let listener=TcpListener::bind("127.0.0.1:0").unwrap();let base=format!("http://{}",listener.local_addr().unwrap());
        let body=if provider=="openai"{event(json!({"choices":[{"delta":{"content":"finished"},"finish_reason":"stop"}]}))}else{event(json!({"type":"content_block_delta","delta":{"text":"finished"}}))+&event(json!({"type":"message_delta","delta":{"stop_reason":"end_turn"}}))};
        let server=std::thread::spawn(move||{let (mut socket,_)=listener.accept().unwrap();let mut buffer=[0;8192];socket.read(&mut buffer).unwrap();write!(socket,"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n{:x}\r\n{}\r\n",body.len(),body).unwrap();socket.flush().unwrap();std::thread::sleep(Duration::from_millis(1800));});
        let (result,completion,_)=tokio::time::timeout(Duration::from_millis(1500),run(provider,&base,false)).await.unwrap();assert_eq!(result.0,"finished");assert_eq!(completion["status"],"complete");assert_eq!(completion["recoveries"],0);server.join().unwrap();
    }
}

#[tokio::test]
async fn a_negotiated_legacy_budget_is_reused_for_later_segments(){
    let anthro=|text:&str,reason:&str|event(json!({"type":"content_block_delta","delta":{"text":text}}))+&event(json!({"type":"message_delta","delta":{"stop_reason":reason}}))+&event(json!({"type":"message_stop"}));
    let (base,server)=crate::test_http::serve_observed(vec![(400,"application/json","max_tokens exceeds maximum 4096".into()),(200,"text/event-stream",anthro("第一段","max_tokens")),(200,"text/event-stream",anthro("第二段","end_turn"))]);
    let (result,completion,calls)=run("anthropic-compatible",&base,false).await;assert_eq!(result.0,"第一段第二段");assert_eq!(completion["status"],"complete");assert_eq!(calls.len(),3);let requests=server.join().unwrap();assert_eq!(requests[0].body["max_tokens"],8192);assert_eq!(requests[1].body["max_tokens"],4096);assert_eq!(requests[2].body["max_tokens"],4096);
}
