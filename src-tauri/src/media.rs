use base64::{engine::general_purpose::STANDARD,Engine};
use futures_util::StreamExt;
use std::{net::{IpAddr,SocketAddr},time::Duration};
use serde::Serialize;

const LIMIT:usize=12*1024*1024;
#[derive(Debug,Serialize)]
#[serde(rename_all="camelCase")]
pub struct RemoteImage{pub data_url:String,pub resolved_url:String}
fn public_ip(ip:IpAddr)->bool{
    match ip {
        IpAddr::V4(v)=>!v.is_private()&&!v.is_loopback()&&!v.is_link_local()&&!v.is_unspecified()&&!v.is_multicast()&&!v.is_broadcast() && v.octets()[0]!=0 && !(v.octets()[0]==100 && (64..=127).contains(&v.octets()[1])),
        IpAddr::V6(v)=>if let Some(v4)=v.to_ipv4_mapped(){public_ip(IpAddr::V4(v4))}else{let first=v.segments()[0];!v.is_loopback()&&!v.is_unspecified()&&!v.is_multicast() && first&0xfe00!=0xfc00 && first&0xffc0!=0xfe80},
    }
}
fn image_mime(bytes:&[u8])->Option<&'static str>{
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n"){Some("image/png")}
    else if bytes.starts_with(&[0xff,0xd8,0xff]){Some("image/jpeg")}
    else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a"){Some("image/gif")}
    else if bytes.starts_with(b"RIFF") && bytes.get(8..12)==Some(b"WEBP"){Some("image/webp")}
    else if bytes.get(4..8)==Some(b"ftyp") && matches!(bytes.get(8..12),Some(b"avif"|b"avis")){Some("image/avif")}
    else{None}
}
async fn fetch(value:&str,allow_private:bool)->Result<RemoteImage,String>{
    let mut url=crate::links::http_url(value)?;
    if url.host_str()==Some("commons.wikimedia.org") && url.path().starts_with("/wiki/File:"){
        url=crate::links::http_url(&format!("https://commons.wikimedia.org/wiki/Special:FilePath/{}",&url.path()[11..]))?;
    }
    for _ in 0..6 {
        let host=url.host_str().unwrap().trim_matches(['[',']']);
        let addresses:Vec<SocketAddr>=tokio::time::timeout(Duration::from_secs(5),tokio::net::lookup_host((host,url.port_or_known_default().unwrap())))
            .await.map_err(|_|"图片地址解析超时")?.map_err(|_|"无法解析图片地址")?.collect();
        if addresses.is_empty() || (!allow_private && addresses.iter().any(|a|!public_ip(a.ip()))){return Err("图片地址不可访问，请使用公开图片直链".into());}
        let client=reqwest::Client::builder().redirect(reqwest::redirect::Policy::none()).timeout(Duration::from_secs(15))
            .user_agent(concat!("ClaudeChat/",env!("CARGO_PKG_VERSION")," (https://github.com/RuanzeyuShao/ClaudeChat)")).resolve_to_addrs(host,&addresses).build().map_err(|_|"图片加载器初始化失败")?;
        let response=client.get(url.clone()).header(reqwest::header::ACCEPT,"image/avif,image/webp,image/*;q=0.9,*/*;q=0.1").send().await.map_err(|_|"图片下载失败，请检查网络或重试")?;
        if response.status().is_redirection(){let location=response.headers().get(reqwest::header::LOCATION).and_then(|h|h.to_str().ok()).ok_or("图片跳转地址缺失")?;url=crate::links::http_url(url.join(location).map_err(|_|"图片跳转地址无效")?.as_str())?;continue}
        if response.status()==reqwest::StatusCode::NOT_FOUND{return Err("图片不存在（404），请打开来源或更换链接".into());}
        if !response.status().is_success(){return Err(format!("图片服务器拒绝加载（{}），请打开来源或重试",response.status().as_u16()));}
        if response.content_length().is_some_and(|size|size>LIMIT as u64){return Err("图片超过 12 MB，请打开原图查看".into());}
        let mut bytes=Vec::new();let mut stream=response.bytes_stream();while let Some(chunk)=stream.next().await{let chunk=chunk.map_err(|_|"图片下载中断，请重试")?;if bytes.len()+chunk.len()>LIMIT{return Err("图片超过 12 MB，请打开原图查看".into());}bytes.extend_from_slice(&chunk);}
        let mime=image_mime(&bytes).ok_or("链接未返回支持的图片，可能是网页地址；请打开来源查看")?;
        return Ok(RemoteImage{data_url:format!("data:{mime};base64,{}",STANDARD.encode(bytes)),resolved_url:url.to_string()});
    }
    Err("图片跳转次数过多，请打开原图查看".into())
}
#[tauri::command]
pub async fn get_remote_image(url:String)->Result<RemoteImage,String>{fetch(&url,false).await}
#[cfg(test)] mod tests {
    use super::*;
    #[test] fn validates_raster_signatures(){assert_eq!(image_mime(b"\x89PNG\r\n\x1a\nrest"),Some("image/png"));assert_eq!(image_mime(b"<html>error</html>"),None);assert_eq!(image_mime(b"<svg onload='x'>"),None);}
    #[test] fn excludes_private_networks(){for ip in ["127.0.0.1","10.1.1.1","192.168.1.1","169.254.169.254","100.64.0.1","::1","fc00::1","::ffff:127.0.0.1"]{assert!(!public_ip(ip.parse().unwrap()));}assert!(public_ip("8.8.8.8".parse().unwrap()));}
    #[tokio::test] async fn refuses_private_sources_before_request(){assert!(fetch("http://127.0.0.1:1/image.png",false).await.unwrap_err().contains("公开图片"));}
    #[tokio::test] async fn follows_redirects_and_reports_missing_or_html_images(){
        use std::io::{Read,Write};
        let listener=std::net::TcpListener::bind("127.0.0.1:0").unwrap();let base=format!("http://{}",listener.local_addr().unwrap());
        let server=std::thread::spawn(move||{for (status,extra,body) in [(302,"Location: /image.png\r\n",vec![]),(200,"Content-Type: image/png\r\n",b"\x89PNG\r\n\x1a\nrest".to_vec()),(404,"",vec![]),(200,"Content-Type: text/html\r\n",b"<html>not an image</html>".to_vec())]{let(mut socket,_)=listener.accept().unwrap();socket.set_read_timeout(Some(Duration::from_secs(5))).unwrap();let mut buffer=[0;2048];let _=socket.read(&mut buffer).unwrap();write!(socket,"HTTP/1.1 {status} OK\r\n{extra}Content-Length: {}\r\nConnection: close\r\n\r\n",body.len()).unwrap();socket.write_all(&body).unwrap();}});
        let image=fetch(&format!("{base}/redirect"),true).await.unwrap();assert!(image.data_url.starts_with("data:image/png;base64,"));assert!(image.resolved_url.ends_with("/image.png"));assert!(fetch(&format!("{base}/missing"),true).await.unwrap_err().contains("404"));assert!(fetch(&format!("{base}/page"),true).await.unwrap_err().contains("网页地址"));server.join().unwrap();
    }
}
