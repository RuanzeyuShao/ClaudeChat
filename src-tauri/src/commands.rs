use crate::{claude, files, database::{Attachment, Conversation, Message}, AppState};
use keyring::Entry;
use serde::{Deserialize, Serialize};
use std::sync::atomic::Ordering;
use tauri::{Emitter, State};

const KEY_SERVICE: &str = "ClaudeChat";
const KEY_ACCOUNT: &str = "api-key";

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings { pub api_key: String, pub base_url: String, pub provider: String, pub model: String, pub thinking: String, pub web_search: bool, pub theme: String, #[serde(default)] pub system_prompt: String }
#[derive(Serialize)] pub struct ConnectionResult { pub ok: bool, pub message: String }

fn secure_key() -> Result<Option<String>, String> { Entry::new(KEY_SERVICE, KEY_ACCOUNT).map_err(|e| e.to_string())?.get_password().map(Some).or_else(|e| if e.to_string().contains("NoEntry") { Ok(None) } else { Err(e.to_string()) }) }
fn api_key_for(settings: &Settings) -> Result<String, String> { if !settings.api_key.trim().is_empty() { Ok(settings.api_key.trim().into()) } else { secure_key()?.filter(|key| !key.is_empty()).ok_or("请先在设置中保存 API Key。".into()) } }
fn validate_provider(settings: &Settings) -> Result<(), String> { if settings.provider == "anthropic-compatible" { Ok(()) } else { Err("OpenAI Compatible Provider 适配器已预留；当前版本请使用 Anthropic Compatible。".into()) } }
fn saved(state: &State<AppState>, key: &str, default: &str) -> Result<String, String> { Ok(state.db.lock().map_err(|e|e.to_string())?.setting(key).map_err(|e|e.to_string())?.unwrap_or_else(|| default.into())) }

#[tauri::command] pub fn get_conversations(state: State<AppState>) -> Result<Vec<Conversation>, String> { state.db.lock().map_err(|e|e.to_string())?.conversations().map_err(|e|e.to_string()) }
#[tauri::command] pub fn search_conversations(query:String,state:State<AppState>)->Result<Vec<Conversation>,String>{state.db.lock().map_err(|e|e.to_string())?.search(&query).map_err(|e|e.to_string())}
#[tauri::command] pub fn set_conversation_prompt(conversation_id:String,prompt:String,state:State<AppState>)->Result<(),String>{state.db.lock().map_err(|e|e.to_string())?.set_system_prompt(&conversation_id,&prompt).map_err(|e|e.to_string())}
#[tauri::command] pub fn parse_attachment(name:String,mime:String,data:String)->Result<Attachment,String>{files::parse(name,mime,data).map_err(|e|e.to_string())}
#[tauri::command] pub fn parse_attachment_path(path:String)->Result<Attachment,String>{files::parse_path(std::path::Path::new(&path)).map_err(|e|e.to_string())}
#[tauri::command] pub fn get_attachment_data(attachment_id:String,state:State<AppState>)->Result<Option<String>,String>{state.db.lock().map_err(|e|e.to_string())?.attachment_data(&attachment_id).map_err(|e|e.to_string())}
#[tauri::command] pub fn export_conversation(conversation_id:String,format:String,path:String,state:State<AppState>)->Result<(),String>{
  let db=state.db.lock().map_err(|e|e.to_string())?;let conversation=db.conversations().map_err(|e|e.to_string())?.into_iter().find(|c|c.id==conversation_id).ok_or("会话不存在")?;let messages=db.messages(&conversation_id).map_err(|e|e.to_string())?;let target=std::path::Path::new(&path);
  match format.as_str(){"md"=>std::fs::write(target,files::markdown(&conversation,&messages)).map_err(|e|e.to_string()),"pdf"=>files::export_pdf(&conversation,&messages,target).map_err(|e|e.to_string()),_=>Err("仅支持 Markdown 或 PDF".into())}
}
#[tauri::command] pub fn create_conversation(model: String, state: State<AppState>) -> Result<Conversation, String> { state.db.lock().map_err(|e|e.to_string())?.create(&model).map_err(|e|e.to_string()) }
#[tauri::command] pub fn get_messages(conversation_id: String, state: State<AppState>) -> Result<Vec<Message>, String> { state.db.lock().map_err(|e|e.to_string())?.messages(&conversation_id).map_err(|e|e.to_string()) }
#[tauri::command] pub fn rename_conversation(conversation_id: String, title: String, state: State<AppState>) -> Result<(), String> { state.db.lock().map_err(|e|e.to_string())?.rename(&conversation_id,&title).map_err(|e|e.to_string()) }
#[tauri::command] pub fn set_conversation_model(conversation_id: String, model: String, state: State<AppState>) -> Result<(), String> { state.db.lock().map_err(|e|e.to_string())?.set_model(&conversation_id,&model).map_err(|e|e.to_string()) }
#[tauri::command] pub fn delete_conversation(conversation_id: String, state: State<AppState>) -> Result<(), String> { state.db.lock().map_err(|e|e.to_string())?.delete(&conversation_id).map_err(|e|e.to_string()) }
#[tauri::command] pub fn delete_last_assistant(conversation_id: String, state: State<AppState>) -> Result<(), String> { state.db.lock().map_err(|e|e.to_string())?.delete_last_assistant(&conversation_id).map_err(|e|e.to_string()) }
#[tauri::command] pub fn get_settings(state: State<AppState>) -> Result<Settings, String> { Ok(Settings { api_key:String::new(), base_url:saved(&state,"base_url","https://api.anthropic.com")?, provider:saved(&state,"provider","anthropic-compatible")?, model:saved(&state,"model","claude-opus-5-5")?, thinking:saved(&state,"thinking","medium")?, web_search:saved(&state,"web_search","true")?=="true", theme:saved(&state,"theme","system")?,system_prompt:saved(&state,"system_prompt","")? }) }
#[tauri::command] pub fn save_settings(settings: Settings, state: State<AppState>) -> Result<(), String> {
  if !settings.api_key.trim().is_empty() { Entry::new(KEY_SERVICE,KEY_ACCOUNT).map_err(|e|e.to_string())?.set_password(settings.api_key.trim()).map_err(|e|e.to_string())?; }
  let db=state.db.lock().map_err(|e|e.to_string())?;
  for (key,value) in [("base_url",settings.base_url.as_str()),("provider",settings.provider.as_str()),("model",settings.model.as_str()),("thinking",settings.thinking.as_str()),("web_search",if settings.web_search {"true"} else {"false"}), ("theme",settings.theme.as_str()),("system_prompt",settings.system_prompt.as_str())] { db.set_setting(key,value).map_err(|e|e.to_string())?; }
  Ok(())
}
#[tauri::command] pub async fn test_connection(settings: Settings) -> Result<ConnectionResult, String> { validate_provider(&settings)?; let key=api_key_for(&settings)?; match claude::test_connection(settings.base_url,key,settings.model).await { Ok(message)=>Ok(ConnectionResult{ok:true,message}), Err(error)=>Ok(ConnectionResult{ok:false,message:error.to_string()}) } }
#[tauri::command] pub async fn send_message(window: tauri::Window, conversation_id: String, content: String, settings: Settings, persist_user: bool, attachments:Vec<Attachment>, state: State<'_,AppState>) -> Result<(), String> {
  if attachments.len()>8 || attachments.iter().map(|a|a.size).sum::<usize>()>30*1024*1024 {return Err("每条消息最多 8 个附件、总大小 30 MB".into());}
  validate_provider(&settings)?; let key=api_key_for(&settings)?; state.cancelled.store(false,Ordering::Relaxed);
  let (history,prompt,title)={let db=state.db.lock().map_err(|e|e.to_string())?; let title=if persist_user { db.add_user_with_attachments(&conversation_id,&content,&attachments).map_err(|e|e.to_string())? }else{None}; let prompt=db.system_prompt(&conversation_id).map_err(|e|e.to_string())?; (db.messages(&conversation_id).map_err(|e|e.to_string())?,prompt,title)};
  if let Some(title)=title {let _=window.emit("conversation-title",serde_json::json!({"conversationId":conversation_id,"title":title}));}
  let cancelled=state.cancelled.clone(); let id=conversation_id.clone(); let window_delta=window.clone();
  let response=claude::stream(settings.base_url,key,settings.model,settings.thinking,history,if prompt.trim().is_empty(){settings.system_prompt}else{prompt},settings.web_search,cancelled,move |delta|window_delta.emit("chat-delta",serde_json::json!({"conversationId":id,"delta":delta})).map_err(Into::into)).await;
  match response { Ok((answer,sources))=>{let _=window.emit("chat-sources",serde_json::json!({"conversationId":conversation_id,"sources":sources}));state.db.lock().map_err(|e|e.to_string())?.add_message(&conversation_id,"assistant",&answer,Some(&sources)).map_err(|e|e.to_string())?;let _=window.emit("chat-finished",conversation_id);Ok(())},Err(error)=>{let _=window.emit("chat-error",serde_json::json!({"conversationId":conversation_id,"message":error.to_string()}));Err(error.to_string())} }
}
#[tauri::command] pub fn stop_generation(state: State<AppState>) { state.cancelled.store(true,Ordering::Relaxed) }
