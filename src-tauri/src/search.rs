use crate::database::Source;
use anyhow::{anyhow,Result};
use serde_json::Value;

pub async fn searxng(base_url:&str,query:&str)->Result<Vec<Source>> {
  let mut url=reqwest::Url::parse(base_url.trim())?;
  if !matches!(url.scheme(),"https"|"http") {return Err(anyhow!("搜索地址仅支持 HTTP(S)"));}
  if !url.path().ends_with("/search") {url.set_path(&format!("{}/search",url.path().trim_end_matches('/')));}
  url.query_pairs_mut().append_pair("q",query).append_pair("format","json");
  let response=reqwest::Client::new().get(url).timeout(std::time::Duration::from_secs(15)).send().await?.error_for_status()?;
  let json:Value=response.json().await?;
  Ok(json["results"].as_array().ok_or_else(||anyhow!("SearXNG 未返回 JSON 搜索结果，请确认实例已启用 JSON 格式"))?.iter().filter_map(|r|{
    let url=r["url"].as_str()?;
    if !url.starts_with("https://")&&!url.starts_with("http://"){return None;}
    Some(Source{citation:String::new(),title:r["title"].as_str().unwrap_or(url).to_string(),url:url.to_string(),snippet:r["content"].as_str().unwrap_or("").chars().take(300).collect()})
  }).take(5).collect())
}
