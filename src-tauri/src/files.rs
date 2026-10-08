use crate::database::{Attachment, Conversation, Message};
use anyhow::{anyhow, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use quick_xml::{events::Event, Reader};
use std::{collections::HashMap, io::{Cursor, Read}, path::Path};
use uuid::Uuid;

const MAX_FILE: usize = 20 * 1024 * 1024;
const MAX_TEXT: usize = 200_000;

pub fn parse(name: String, mime: String, data: String) -> Result<Attachment> {
  let bytes=STANDARD.decode(&data)?;
  if bytes.is_empty() || bytes.len()>MAX_FILE { return Err(anyhow!("文件须介于 1 字节和 20 MB 之间")); }
  let extension=Path::new(&name).extension().and_then(|x|x.to_str()).unwrap_or("").to_lowercase();
  let (kind,text,mime)=match extension.as_str() {
    "png"|"jpg"|"jpeg"|"gif"|"webp" => {
      let expected=match extension.as_str(){"png"=>"image/png","jpg"|"jpeg"=>"image/jpeg","gif"=>"image/gif",_=>"image/webp"};
      if !mime.is_empty() && mime!=expected { return Err(anyhow!("图片格式与文件类型不匹配")); }
      ("image",None,expected.to_string())
    },
    "txt"|"md"|"py"|"cpp"|"c"|"h"|"hpp"|"java"|"js"|"ts"|"vue"|"rs"|"go"|"sh"|"json"|"yaml"|"yml" => {
      let content=String::from_utf8(bytes.clone()).map_err(|_|anyhow!("TXT / Markdown 文件需要 UTF-8 编码"))?;
      (if extension=="txt"||extension=="md"{"document"}else{"code"},Some(content.trim_start_matches('\u{feff}').to_string()),if extension=="md"{"text/markdown"}else{"text/plain"}.into())
    },
    "pdf" => ("document",Some(pdf_extract::extract_text_from_mem(&bytes)?),"application/pdf".into()),
    "docx" => ("document",Some(docx_text(&bytes)?),"application/vnd.openxmlformats-officedocument.wordprocessingml.document".into()),
    "doc" => return Err(anyhow!("旧版 .doc 暂不支持，请转换为 .docx")),
    _ => return Err(anyhow!("不支持此文件类型")),
  };
  if text.as_ref().is_some_and(|s|s.chars().count()>MAX_TEXT) { return Err(anyhow!("文档超过 20 万字符，请拆分后上传")); }
  if kind!="image" && text.as_ref().is_none_or(|s|s.trim().is_empty()) { return Err(anyhow!("文件没有可提取的文字；扫描版 PDF 需要先进行 OCR")); }
  let preview_data=match extension.as_str(){"png"|"jpg"|"jpeg"|"gif"|"webp"|"pdf"=>Some(data),"docx"=>Some(docx_preview(&bytes)?),_=>None};
  Ok(Attachment{id:Uuid::new_v4().to_string(),name,mime,kind:kind.into(),size:bytes.len(),text,data:preview_data})
}

pub fn parse_path(path:&Path)->Result<Attachment>{
  let size=std::fs::metadata(path)?.len();if size>MAX_FILE as u64{return Err(anyhow!("文件超过 20 MB"));}
  let name=path.file_name().and_then(|s|s.to_str()).ok_or_else(||anyhow!("文件名无效"))?.to_string();
  let bytes=std::fs::read(path)?;
  let mut attachment=parse(name,String::new(),STANDARD.encode(&bytes))?;
  if attachment.mime=="text/markdown" {if let Some(text)=&attachment.text {attachment.data=Some(serde_json::to_string(&markdown_images(path,text)?)?);}}
  Ok(attachment)
}

fn markdown_images(path:&Path,text:&str)->Result<HashMap<String,String>>{
  let parent=path.parent().ok_or_else(||anyhow!("文件路径无效"))?.canonicalize()?;
  let pattern=regex::Regex::new(r#"(?m)!\[[^\]]*\]\(([^)]+)\)|^\[[^\]]+\]:\s*(\S+)"#)?;
  let mut images=HashMap::new();let mut total=0usize;
  for capture in pattern.captures_iter(text) {
    if images.len()>=20{break;}
    let raw=capture.get(1).or_else(||capture.get(2)).unwrap().as_str().trim();
    let reference=raw.split(" \"").next().unwrap_or(raw).trim_matches(|c|c=='<'||c=='>');
    if reference.contains("://")||reference.starts_with("data:")||reference.starts_with('/')||reference.contains(':'){continue;}
    let decoded=percent_encoding::percent_decode_str(reference).decode_utf8_lossy();
    let relative=decoded.split(['?','#']).next().unwrap_or("").replace('\\',"/");
    let candidate=parent.join(relative);let Ok(target)=candidate.canonicalize() else {continue};
    if !target.starts_with(&parent)||!target.is_file(){continue;}
    let Some(ext)=target.extension().and_then(|s|s.to_str()) else {continue};
    let mime=match ext.to_lowercase().as_str(){"png"=>"image/png","jpg"|"jpeg"=>"image/jpeg","gif"=>"image/gif","webp"=>"image/webp",_=>continue};
    let length=std::fs::metadata(&target)?.len() as usize;if length>5*1024*1024||total+length>20*1024*1024{continue;}
    total+=length;images.insert(reference.to_string(),format!("data:{};base64,{}",mime,STANDARD.encode(std::fs::read(target)?)));
  }
  Ok(images)
}

fn docx_text(bytes:&[u8])->Result<String> {
  let mut archive=zip::ZipArchive::new(Cursor::new(bytes))?;
  let mut xml=String::new(); archive.by_name("word/document.xml")?.read_to_string(&mut xml)?;
  let mut reader=Reader::from_str(&xml); let mut out=String::new(); let mut in_text=false;
  loop { match reader.read_event()? {
    Event::Start(e) if e.name().as_ref()==b"w:t" => in_text=true,
    Event::End(e) if e.name().as_ref()==b"w:t" => in_text=false,
    Event::End(e) if e.name().as_ref()==b"w:p" => out.push('\n'),
    Event::Text(e) if in_text => out.push_str(&e.unescape()?.into_owned()),
    Event::Eof => break, _=>{}
  }} Ok(out)
}

fn docx_preview(bytes:&[u8])->Result<String>{
  let mut archive=zip::ZipArchive::new(Cursor::new(bytes))?;
  let mut relationships=String::new();
  if let Ok(mut file)=archive.by_name("word/_rels/document.xml.rels"){file.read_to_string(&mut relationships)?;}
  let mut image_files=HashMap::new();let mut reader=Reader::from_str(&relationships);
  loop {match reader.read_event()?{Event::Empty(e)|Event::Start(e) if e.name().as_ref()==b"Relationship"=>{
    let mut id=String::new();let mut target=String::new();let mut kind=String::new();
    for attr in e.attributes().flatten(){let value=String::from_utf8_lossy(attr.value.as_ref()).into_owned();match attr.key.as_ref(){b"Id"=>id=value,b"Target"=>target=value,b"Type"=>kind=value,_=>{}}}
    if kind.ends_with("/image")&&target.starts_with("media/"){image_files.insert(id,format!("word/{}",target));}
  },Event::Eof=>break,_=>{}}}
  let mut images=HashMap::new();let mut total=0usize;
  for (id,path) in image_files {if images.len()>=20{break;}let Some(ext)=Path::new(&path).extension().and_then(|s|s.to_str()) else{continue};let mime=match ext.to_lowercase().as_str(){"png"=>"image/png","jpg"|"jpeg"=>"image/jpeg","gif"=>"image/gif","webp"=>"image/webp",_=>continue};let Ok(mut file)=archive.by_name(&path) else{continue};let length=file.size() as usize;if length>5*1024*1024||total+length>20*1024*1024{continue;}let mut data=Vec::new();file.read_to_end(&mut data)?;total+=data.len();images.insert(id,format!("data:{};base64,{}",mime,STANDARD.encode(data)));}
  let mut xml=String::new();archive.by_name("word/document.xml")?.read_to_string(&mut xml)?;
  let mut reader=Reader::from_str(&xml);let mut html=String::new();let mut in_text=false;let mut in_paragraph=false;
  loop {match reader.read_event()?{
    Event::Start(e) if e.name().as_ref()==b"w:p"=>{html.push_str("<p>");in_paragraph=true;},
    Event::End(e) if e.name().as_ref()==b"w:p"=>{html.push_str("</p>");in_paragraph=false;},
    Event::Start(e) if e.name().as_ref()==b"w:t"=>in_text=true,
    Event::End(e) if e.name().as_ref()==b"w:t"=>in_text=false,
    Event::Text(e) if in_text=>html.push_str(&escape_html(&e.unescape()?.into_owned())),
    Event::Empty(e)|Event::Start(e) if e.name().as_ref()==b"a:blip"=>{for attr in e.attributes().flatten(){if attr.key.as_ref()==b"r:embed"{let id=String::from_utf8_lossy(attr.value.as_ref());if let Some(source)=images.get(id.as_ref()){html.push_str("<img alt=\"文档图片\" src=\"");html.push_str(source);html.push_str("\" />");}}}},
    Event::Empty(e) if e.name().as_ref()==b"w:br"=>html.push_str("<br />"),
    Event::Empty(e) if e.name().as_ref()==b"w:tab"=>html.push_str("&emsp;"),
    Event::Eof=>break,_=>{}
  }}
  if in_paragraph{html.push_str("</p>");}Ok(html)
}
fn escape_html(value:&str)->String{value.replace('&',"&amp;").replace('<',"&lt;").replace('>',"&gt;").replace('"',"&quot;")}

pub fn markdown(conversation:&Conversation,messages:&[Message])->String {
  let mut result=format!("# {}\n\n",conversation.title);
  if !conversation.system_prompt.trim().is_empty(){result.push_str(&format!("> System Prompt: {}\n\n",conversation.system_prompt.replace('\n',"\n> ")));}
  for m in messages {result.push_str(&format!("## {} · {}\n\n",if m.role=="user"{"用户"}else{"助手"},m.created_at)); result.push_str(&m.content);result.push_str("\n\n");for a in &m.attachments {result.push_str(&format!("- 附件：{} ({})\n",a.name,a.mime));if let Some(t)=&a.text{result.push_str(&format!("\n<details><summary>提取的文本</summary>\n\n```text\n{}\n```\n</details>\n\n",t));}}if !m.attachments.is_empty(){result.push('\n');}}
  result
}

pub fn export_pdf(conversation:&Conversation,messages:&[Message],path:&Path)->Result<()> {
  use printpdf::*;
  let (doc,page,layer)=PdfDocument::new(&conversation.title,Mm(210.0),Mm(297.0),"Content");
  let font_path=["C:\\Windows\\Fonts\\simhei.ttf","C:\\Windows\\Fonts\\msyh.ttf","C:\\Windows\\Fonts\\msyh.ttc"].into_iter().find(|p|Path::new(p).exists()).ok_or_else(||anyhow!("未找到可用于中文 PDF 的系统字体"))?;
  let font=doc.add_external_font(std::fs::File::open(font_path)?)?;
  let mut page=page;let mut layer=layer;let mut y=280.0;let mut code=false;
  for line in markdown(conversation,messages).lines() {
    if line.starts_with("```"){code=!code;y-=2.0;continue;}
    if line.starts_with("<details>")||line.starts_with("</details>"){continue;}
    if y<18.0 {let next=doc.add_page(Mm(210.0),Mm(297.0),"Content");page=next.0;layer=next.1;y=280.0;}
    let clean=if code {line} else {line.trim_start_matches('#').trim_start_matches('>').trim()};
    let size=if line.starts_with("# "){17.0}else if line.starts_with("## "){12.0}else{9.0};
    for part in wrap(clean,if size>12.0{40}else{72}) {if y<18.0 {let next=doc.add_page(Mm(210.0),Mm(297.0),"Content");page=next.0;layer=next.1;y=280.0;}doc.get_page(page).get_layer(layer).use_text(part,size,Mm(if code{22.0}else{16.0}),Mm(y),&font);y-=if size>12.0{9.0}else{5.8};}
    if clean.is_empty(){y-=3.0;}
  }
  doc.save(&mut std::io::BufWriter::new(std::fs::File::create(path)?))?;Ok(())
}
fn wrap(text:&str,n:usize)->Vec<String>{if text.is_empty(){return vec![];}let mut result=vec![];let chars:Vec<char>=text.chars().collect();for chunk in chars.chunks(n){result.push(chunk.iter().collect());}result}

#[cfg(test)] mod tests {
  use super::*;
  use std::io::Write;
  #[test] fn parses_markdown_as_document_context() {
    let encoded=STANDARD.encode("# 标题\n\n```rust\nlet x = 1;\n```".as_bytes());
    let attachment=parse("notes.MD".into(),"text/markdown".into(),encoded).unwrap();
    assert_eq!(attachment.kind,"document");
    assert_eq!(attachment.mime,"text/markdown");
    assert!(attachment.text.unwrap().contains("```rust"));
  }
  #[test] fn parses_code_as_first_class_attachment() {
    for name in ["main.py","main.cpp","main.c","main.h","main.hpp","Main.java","app.js","app.ts","App.vue","main.rs","main.go","build.sh","data.json","config.yaml"] {
      let attachment=parse(name.into(),String::new(),STANDARD.encode("let x = 1;".as_bytes())).unwrap();
      assert_eq!(attachment.kind,"code", "{name}");
      assert_eq!(attachment.text.as_deref(),Some("let x = 1;"));
    }
  }
  #[test] fn bundles_local_markdown_images() {
    let root=std::env::temp_dir().join(format!("claude-chat-images-{}",Uuid::new_v4()));
    std::fs::create_dir_all(root.join("images")).unwrap();
    std::fs::write(root.join("images/plot.png"),[137,80,78,71]).unwrap();
    let file=root.join("notes.md");std::fs::write(&file,"# Notes\n\n![plot](images/plot.png)").unwrap();
    let attachment=parse_path(&file).unwrap();let images:HashMap<String,String>=serde_json::from_str(attachment.data.as_deref().unwrap()).unwrap();
    assert!(images["images/plot.png"].starts_with("data:image/png;base64,"));
    std::fs::remove_file(file).unwrap();std::fs::remove_file(root.join("images/plot.png")).unwrap();std::fs::remove_dir(root.join("images")).unwrap();std::fs::remove_dir(root).unwrap();
  }
  #[test] fn docx_preview_keeps_embedded_images() {
    let cursor=Cursor::new(Vec::new());let mut writer=zip::ZipWriter::new(cursor);let options=zip::write::SimpleFileOptions::default();
    writer.start_file("word/document.xml",options).unwrap();writer.write_all(br#"<w:document><w:body><w:p><w:t>Hello</w:t><a:blip r:embed="rId1" /></w:p></w:body></w:document>"#).unwrap();
    writer.start_file("word/_rels/document.xml.rels",options).unwrap();writer.write_all(br#"<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png" /></Relationships>"#).unwrap();
    writer.start_file("word/media/image1.png",options).unwrap();writer.write_all(&[137,80,78,71]).unwrap();
    let bytes=writer.finish().unwrap().into_inner();let html=docx_preview(&bytes).unwrap();
    assert!(html.contains("Hello"));assert!(html.contains("data:image/png;base64,"));
  }
  #[test] fn exports_chinese_pdf() {
    let c=Conversation{id:"1".into(),title:"中文会话".into(),model:"x".into(),created_at:"".into(),updated_at:"".into(),messages:vec![],system_prompt:"".into()};
    let m=Message{usage_id:None,reasoning_content:String::new(),parent_id:None,references:vec![],search_trace:None,id:"1".into(),role:"assistant".into(),content:"# 标题\n\n```rust\nlet value = 1;\n```".into(),created_at:"2026-09-29".into(),sources:None,attachments:vec![]};
    let path=std::env::temp_dir().join(format!("claude-chat-{}.pdf",Uuid::new_v4()));
    export_pdf(&c,&[m],&path).unwrap(); assert!(std::fs::metadata(&path).unwrap().len()>1000); std::fs::remove_file(path).unwrap();
  }
}
