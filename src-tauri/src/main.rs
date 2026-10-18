#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod generation;
mod recovery;
mod links;
mod media;
mod connection;
mod database;
mod claude;
mod files;
mod search;
mod provider;
mod profile_service;
mod sse;
mod openai;
#[cfg(test)] mod test_http;

use std::sync::{atomic::AtomicBool, Arc, Mutex};
use database::Database;
use tauri::Manager;

pub struct AppState { pub db: Mutex<Database>, pub cancelled: Arc<AtomicBool>, pub generating: Arc<AtomicBool> }

fn data_directory_override(args:impl IntoIterator<Item=std::ffi::OsString>)->anyhow::Result<Option<std::path::PathBuf>> {
  let mut args=args.into_iter();let mut selected=None;
  while let Some(arg)=args.next(){if arg=="--data-dir"{
    anyhow::ensure!(selected.is_none(),"--data-dir 只能指定一次");
    let path=std::path::PathBuf::from(args.next().ok_or_else(||anyhow::anyhow!("--data-dir 需要绝对目录路径"))?);
    anyhow::ensure!(path.is_absolute(),"--data-dir 必须是绝对目录路径");selected=Some(path);
  }}
  Ok(selected)
}

fn main() {
  tauri::Builder::default()
    .setup(|app| {
      let (path,legacy)=if let Some(path)=data_directory_override(std::env::args_os().skip(1))?{
        let legacy=path.join("legacy");(path,legacy)
      }else{(app.path().app_data_dir()?,app.path().data_dir()?.join("ClaudeChat"))};
      let db=Database::open(&path,&legacy)?;
      app.manage(AppState { db: Mutex::new(db), cancelled: Arc::new(AtomicBool::new(false)), generating: Arc::new(AtomicBool::new(false)) });
      Ok(())
    })
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri::plugin::Builder::<tauri::Wry,()>::new("chat-navigation").on_navigation(|view,url|view.label()!="main" || links::trusted_app_view(view.label(),url)).build())
    .invoke_handler({let dispatch:Box<dyn Fn(tauri::ipc::Invoke<tauri::Wry>)->bool+Send+Sync>=Box::new(tauri::generate_handler![links::open_link_preview, media::get_remote_image,commands::attachment_limits,commands::get_drafts,commands::save_draft,commands::cleanup_data,commands::delete_turn,commands::clear_all_data,commands::get_provider_models, commands::get_tree, commands::select_branch, commands::get_extension, commands::save_extension, commands::detect_capabilities, commands::get_conversations, commands::search_conversations, commands::set_conversation_prompt, commands::parse_attachment, commands::parse_attachment_path, commands::get_attachment_data, commands::export_conversation, commands::create_conversation, commands::rename_conversation, commands::delete_conversation, commands::get_settings, commands::select_conversation, commands::save_settings, commands::save_appearance, commands::apply_preset_settings, commands::test_connection, commands::import_legacy_profile, commands::get_profiles, commands::save_profile, commands::delete_profile, commands::get_usage, commands::get_model_prices, commands::save_model_price, commands::save_code_file, commands::save_code_copy, commands::send_message, commands::stop_generation]);move |invoke:tauri::ipc::Invoke<tauri::Wry>| {if invoke.message.webview_ref().label()!="main"{invoke.resolver.reject("此页面不能访问客户端数据");return true;}dispatch(invoke)}})
    .run(tauri::generate_context!())
    .expect("error while running ClaudeChat");
}

#[cfg(test)]
mod storage_tests {
  use super::*;
  #[test] fn explicit_storage_override_requires_an_absolute_path_and_has_no_implicit_fallback(){
    assert!(data_directory_override(vec![]).unwrap().is_none());
    assert!(data_directory_override(vec!["--data-dir".into()]).is_err());
    assert!(data_directory_override(vec!["--data-dir".into(),"relative".into()]).is_err());
    let path=std::env::temp_dir().join("claudechat-test-data");
    assert_eq!(data_directory_override(vec!["--data-dir".into(),path.clone().into_os_string()]).unwrap(),Some(path));
  }
}
