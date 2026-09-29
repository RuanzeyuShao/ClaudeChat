#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod database;
mod claude;
mod files;

use std::sync::{atomic::AtomicBool, Arc, Mutex};
use database::Database;

pub struct AppState { pub db: Mutex<Database>, pub cancelled: Arc<AtomicBool> }

fn main() {
  let db = Database::open().expect("failed to initialize local database");
  tauri::Builder::default()
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_dialog::init())
    .manage(AppState { db: Mutex::new(db), cancelled: Arc::new(AtomicBool::new(false)) })
    .invoke_handler(tauri::generate_handler![commands::get_conversations, commands::search_conversations, commands::set_conversation_prompt, commands::parse_attachment, commands::parse_attachment_path, commands::get_attachment_data, commands::export_conversation, commands::create_conversation, commands::get_messages, commands::rename_conversation, commands::set_conversation_model, commands::delete_conversation, commands::delete_last_assistant, commands::get_settings, commands::save_settings, commands::test_connection, commands::send_message, commands::stop_generation])
    .run(tauri::generate_context!())
    .expect("error while running ClaudeChat");
}
