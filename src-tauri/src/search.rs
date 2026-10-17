use crate::database::Source;
use anyhow::{anyhow,Result};
use serde_json::Value;
use std::sync::{Arc,atomic::{AtomicBool,Ordering}};

pub async fn searxng(base_url:&str,query:&str,cancelled:Arc<AtomicBool>)->Result<Vec<Source>> {
  if cancelled.load(Ordering::Relaxed){return Err(anyhow!("搜索已停止"));}
  let mut url=reqwest::Url::parse(base_url.trim())?;
  if !matches!(url.scheme(),"https"|"http") {return Err(anyhow!("搜索地址仅支持 HTTP(S)"));}
  if !url.path().ends_with("/search") {url.set_path(&format!("{}/search",url.path().trim_end_matches('/')));}
  url.query_pairs_mut().append_pair("q",query).append_pair("format","json");
  let fetch=async {
    let response=reqwest::Client::new().get(url).timeout(std::time::Duration::from_secs(15)).send().await?.error_for_status()?;
    response.json::<Value>().await
  };
  tokio::pin!(fetch);
  let json=loop{tokio::select!{
    result=&mut fetch=>break result?,
    _=tokio::time::sleep(std::time::Duration::from_millis(50))=>{
      if cancelled.load(Ordering::Relaxed){return Err(anyhow!("搜索已停止"));}
    }
  }};
  Ok(json["results"].as_array().ok_or_else(||anyhow!("SearXNG 未返回 JSON 搜索结果，请确认实例已启用 JSON 格式"))?.iter().filter_map(|r|{
    let url=r["url"].as_str()?;
    if !url.starts_with("https://")&&!url.starts_with("http://"){return None;}
    Some(Source{anchor:None,citation:String::new(),title:r["title"].as_str().unwrap_or(url).to_string(),url:url.to_string(),snippet:r["content"].as_str().unwrap_or("").chars().take(300).collect()})
  }).take(5).collect())
}

pub fn select_sources(sources:Vec<Source>)->Vec<Source> {
  let mut seen=std::collections::HashSet::new();
  sources.into_iter().filter(|s|{
    let Ok(mut url)=reqwest::Url::parse(&s.url) else{return false};
    if !matches!(url.scheme(),"http"|"https"){return false}url.set_fragment(None);
    seen.insert(url.to_string())
  }).take(24).collect()
}
pub fn completion_status(enabled:bool,external_completed:bool,sources:&[Source],events:&[Value])->&'static str {
  if !enabled{return "off"}
  if events.iter().any(search_failed){return "failed"}
  let executed=external_completed || !sources.is_empty() || events.iter().any(search_executed);
  if !executed{"not_used"}else if sources.is_empty(){"empty"}else{"completed"}
}
fn search_executed(value:&Value)->bool {
  if value["name"]=="web_search" || value["name"]=="$web_search" || value["tool"]=="$web_search"
    || value["type"]=="web_search_tool_result" || value["type"]=="web_search_result"
    || value["results"].is_array() || value["web_search"].is_array(){return true}
  match value{Value::Object(items)=>items.values().any(search_executed),Value::Array(items)=>items.iter().any(search_executed),_=>false}
}
fn search_failed(value:&Value)->bool {
  if value["type"]=="web_search_tool_result_error"{return true}
  match value{Value::Object(items)=>items.values().any(search_failed),Value::Array(items)=>items.iter().any(search_failed),_=>false}
}

#[cfg(test)] mod tests {
  use super::*;
  use serde_json::json;
  #[test] fn search_status_requires_execution_and_distinguishes_empty_and_failed(){
    assert_eq!(completion_status(false,false,&[],&[]),"off");
    assert_eq!(completion_status(true,false,&[],&[]),"not_used");
    assert_eq!(completion_status(true,false,&[],&[json!({"type":"input_json_delta","partial_json":"{}"})]),"not_used");
    assert_eq!(completion_status(true,false,&[],&[json!({"toolCalls":[{"function":{"name":"calculator"}}]})]),"not_used");
    assert_eq!(completion_status(true,true,&[],&[]),"empty");
    assert_eq!(completion_status(true,false,&[],&[json!({"name":"web_search"})]),"empty");
    assert_eq!(completion_status(true,false,&[],&[json!({"tool":"$web_search"})]),"empty");
    assert_eq!(completion_status(true,false,&[],&[json!({"content":[{"type":"web_search_tool_result_error","error_code":"max_uses_exceeded"}]})]),"failed");
    let sources=vec![Source{anchor:None,url:"https://example.com".into(),title:"source".into(),citation:String::new(),snippet:String::new()}];
    assert_eq!(completion_status(true,false,&sources,&[]),"completed");
  }
  #[tokio::test] async fn cancellation_interrupts_waiting_for_headers_and_body(){
    use std::{net::TcpListener,io::{Read,Write},time::{Duration,Instant}};
    for headers in [false,true]{
      let listener=TcpListener::bind("127.0.0.1:0").unwrap();let address=listener.local_addr().unwrap();
      let cancelled=Arc::new(AtomicBool::new(false));let signal=cancelled.clone();
      let server=std::thread::spawn(move||{
        let (mut socket,_)=listener.accept().unwrap();socket.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
        let mut buffer=[0;4096];let _=socket.read(&mut buffer).unwrap();
        if headers{socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 1000\r\n\r\n{").unwrap();socket.flush().unwrap();}
        signal.store(true,Ordering::Relaxed);
        // Keep the response unfinished until the client cancels and closes it.
        let _=socket.read(&mut buffer);
      });
      let started=Instant::now();
      let result=tokio::time::timeout(Duration::from_secs(2),searxng(&format!("http://{address}"),"question",cancelled)).await.unwrap();
      assert!(result.err().unwrap().to_string().contains("搜索已停止"));
      assert!(started.elapsed()<Duration::from_secs(2));server.join().unwrap();
    }
  }
  #[tokio::test] async fn searxng_success_and_empty_results_are_not_errors(){
    let (base,server)=crate::test_http::serve_observed(vec![(200,"application/json",r#"{"results":[{"url":"https://example.com","title":"result"},{"url":"javascript:alert(1)"}]}"#.into()),(200,"application/json",r#"{"results":[]}"#.into())]);
    let cancelled=Arc::new(AtomicBool::new(false));
    assert_eq!(searxng(&base,"a & b",cancelled.clone()).await.unwrap().len(),1);
    assert!(searxng(&base,"empty",cancelled).await.unwrap().is_empty());
    let requests=server.join().unwrap();assert!(requests[0].path.starts_with("/v1/search?"));assert!(requests[0].path.contains("format=json"));
  }
}
