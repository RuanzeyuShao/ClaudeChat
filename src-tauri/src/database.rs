use anyhow::Result;
use chrono::Utc;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Clone, Serialize, Deserialize)] #[serde(rename_all = "camelCase")]
pub struct Conversation { pub id: String, pub title: String, pub model: String, pub created_at: String, pub updated_at: String, #[serde(default)] pub messages: Vec<Message> }
#[derive(Clone, Serialize, Deserialize)] #[serde(rename_all = "camelCase")]
pub struct Message { pub id: String, pub role: String, pub content: String, pub created_at: String, #[serde(skip_serializing_if = "Option::is_none")] pub sources: Option<Vec<Source>> }
#[derive(Clone, Serialize, Deserialize)] pub struct Source { pub title: String, pub url: String }

pub struct Database { conn: Connection }
impl Database {
  pub fn open() -> Result<Self> {
    let dir = std::env::var("APPDATA").unwrap_or_else(|_| ".".into());
    let path = std::path::Path::new(&dir).join("ClaudeChat"); std::fs::create_dir_all(&path)?;
    let conn = Connection::open(path.join("claudechat.db"))?;
    conn.execute_batch("CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, title TEXT NOT NULL, model TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL, metadata TEXT); CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);")?;
    Ok(Self { conn })
  }
  pub fn conversations(&self) -> Result<Vec<Conversation>> {
    let mut statement = self.conn.prepare("SELECT id,title,model,created_at,updated_at FROM conversations ORDER BY updated_at DESC")?;
    let rows = statement.query_map([], |row| Ok(Conversation {
      id: row.get(0)?, title: row.get(1)?, model: row.get(2)?,
      created_at: row.get(3)?, updated_at: row.get(4)?, messages: vec![],
    }))?;
    let conversations = rows.collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(conversations)
  }
  pub fn create(&self, model: &str) -> Result<Conversation> { let now=Utc::now().to_rfc3339(); let c=Conversation{id:Uuid::new_v4().to_string(),title:"新对话".into(),model:model.into(),created_at:now.clone(),updated_at:now,messages:vec![]}; self.conn.execute("INSERT INTO conversations VALUES (?1,?2,?3,?4,?5)",params![c.id,c.title,c.model,c.created_at,c.updated_at])?; Ok(c) }
  pub fn messages(&self, id: &str) -> Result<Vec<Message>> {
    let mut statement = self.conn.prepare("SELECT id,role,content,created_at,metadata FROM messages WHERE conversation_id=? ORDER BY created_at")?;
    let rows = statement.query_map([id], |row| {
      let metadata: Option<String> = row.get(4)?;
      Ok(Message {
        id: row.get(0)?, role: row.get(1)?, content: row.get(2)?, created_at: row.get(3)?,
        sources: metadata.and_then(|value| serde_json::from_str(&value).ok()),
      })
    })?;
    let messages = rows.collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(messages)
  }
  pub fn add_message(&self, conversation_id:&str, role:&str, content:&str, sources:Option<&Vec<Source>>)->Result<()> { let now=Utc::now().to_rfc3339(); let metadata=sources.map(serde_json::to_string).transpose()?; self.conn.execute("INSERT INTO messages VALUES (?1,?2,?3,?4,?5,?6)",params![Uuid::new_v4().to_string(),conversation_id,role,content,now,metadata])?; self.conn.execute("UPDATE conversations SET updated_at=? WHERE id=?",params![Utc::now().to_rfc3339(),conversation_id])?; Ok(()) }
  pub fn rename(&self,id:&str,title:&str)->Result<()> {self.conn.execute("UPDATE conversations SET title=?,updated_at=? WHERE id=?",params![title,Utc::now().to_rfc3339(),id])?;Ok(())}
  pub fn set_model(&self,id:&str,model:&str)->Result<()> {self.conn.execute("UPDATE conversations SET model=?,updated_at=? WHERE id=?",params![model,Utc::now().to_rfc3339(),id])?;Ok(())}
  pub fn delete(&self,id:&str)->Result<()> {self.conn.execute("DELETE FROM messages WHERE conversation_id=?",[id])?;self.conn.execute("DELETE FROM conversations WHERE id=?",[id])?;Ok(())}
  pub fn delete_last_assistant(&self,id:&str)->Result<()> { self.conn.execute("DELETE FROM messages WHERE id=(SELECT id FROM messages WHERE conversation_id=?1 AND role='assistant' ORDER BY created_at DESC LIMIT 1)",[id])?; Ok(()) }
  pub fn setting(&self,key:&str)->Result<Option<String>> {Ok(self.conn.query_row("SELECT value FROM settings WHERE key=?",[key],|r|r.get(0)).ok())}
  pub fn set_setting(&self,key:&str,value:&str)->Result<()> {self.conn.execute("INSERT INTO settings(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",params![key,value])?;Ok(())}
}
