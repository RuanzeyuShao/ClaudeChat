#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
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

pub struct AppState { pub db: Mutex<Database>, pub cancelled: Arc<AtomicBool>, pub generating: Arc<AtomicBool> }

fn main() {
  let db = Database::open().expect("failed to initialize local database");
  tauri::Builder::default()
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_dialog::init())
    .manage(AppState { db: Mutex::new(db), cancelled: Arc::new(AtomicBool::new(false)), generating: Arc::new(AtomicBool::new(false)) })
    .invoke_handler(tauri::generate_handler![commands::get_provider_models, commands::get_tree, commands::select_branch, commands::get_extension, commands::save_extension, commands::detect_capabilities, commands::get_conversations, commands::search_conversations, commands::set_conversation_prompt, commands::parse_attachment, commands::parse_attachment_path, commands::get_attachment_data, commands::export_conversation, commands::create_conversation, commands::get_messages, commands::rename_conversation, commands::set_conversation_model, commands::delete_conversation, commands::delete_last_assistant, commands::get_settings, commands::select_conversation, commands::save_settings, commands::test_connection, commands::import_legacy_profile, commands::get_profiles, commands::save_profile, commands::delete_profile, commands::get_usage, commands::get_model_prices, commands::save_model_price, commands::save_code_file, commands::save_code_copy, commands::send_message, commands::stop_generation])
    .run(tauri::generate_context!())
    .expect("error while running ClaudeChat");
}
