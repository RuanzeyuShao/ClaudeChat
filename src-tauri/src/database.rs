use anyhow::Result;
use chrono::Utc;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Clone, Serialize, Deserialize)] #[serde(rename_all = "camelCase")]
pub struct Conversation { pub id: String, pub title: String, pub model: String, pub created_at: String, pub updated_at: String, #[serde(default)] pub messages: Vec<Message>, #[serde(default)] pub system_prompt: String }
#[derive(Clone, Serialize, Deserialize)] #[serde(rename_all = "camelCase")]
pub struct Message { pub id: String, pub role: String, pub content: String, pub created_at: String, #[serde(skip_serializing_if = "Option::is_none")] pub sources: Option<Vec<Source>>, #[serde(default)] pub attachments: Vec<Attachment> }
#[derive(Clone, Serialize, Deserialize)] #[serde(rename_all = "camelCase")]
pub struct Attachment { pub id: String, pub name: String, pub mime: String, pub kind: String, pub size: usize, pub text: Option<String>, pub data: Option<String> }
#[derive(Clone, Serialize, Deserialize)] pub struct Source { pub title: String, pub url: String }

pub struct Database { conn: Connection }
impl Database {
  pub fn open() -> Result<Self> {
    let dir = std::env::var("APPDATA").unwrap_or_else(|_| ".".into());
    let path = std::path::Path::new(&dir).join("ClaudeChat"); std::fs::create_dir_all(&path)?;
    let conn = Connection::open(path.join("claudechat.db"))?;
    conn.execute_batch("CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, title TEXT NOT NULL, model TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL, metadata TEXT); CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS attachments (id TEXT PRIMARY KEY, message_id TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL, kind TEXT NOT NULL, size INTEGER NOT NULL, text TEXT, data TEXT);")?;
    if !conn.prepare("SELECT system_prompt FROM conversations LIMIT 1").is_ok() { conn.execute("ALTER TABLE conversations ADD COLUMN system_prompt TEXT NOT NULL DEFAULT ''", [])?; }
    conn.execute_batch("CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id,created_at); CREATE INDEX IF NOT EXISTS idx_attachments_message ON attachments(message_id);")?;
    Ok(Self { conn })
  }
  pub fn conversations(&self) -> Result<Vec<Conversation>> {
    let mut statement = self.conn.prepare("SELECT id,title,model,created_at,updated_at,system_prompt FROM conversations ORDER BY updated_at DESC")?;
    let rows = statement.query_map([], |row| Ok(Conversation {
      id: row.get(0)?, title: row.get(1)?, model: row.get(2)?,
      created_at: row.get(3)?, updated_at: row.get(4)?, messages: vec![], system_prompt: row.get(5)?,
    }))?;
    let conversations = rows.collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(conversations)
  }
  pub fn create(&self, model: &str) -> Result<Conversation> { let now=Utc::now().to_rfc3339(); let c=Conversation{id:Uuid::new_v4().to_string(),title:"准备开始".into(),model:model.into(),created_at:now.clone(),updated_at:now,messages:vec![],system_prompt:String::new()}; self.conn.execute("INSERT INTO conversations(id,title,model,created_at,updated_at) VALUES (?1,?2,?3,?4,?5)",params![c.id,c.title,c.model,c.created_at,c.updated_at])?; Ok(c) }
  pub fn messages(&self, id: &str) -> Result<Vec<Message>> {
    let mut statement = self.conn.prepare("SELECT id,role,content,created_at,metadata FROM messages WHERE conversation_id=? ORDER BY created_at")?;
    let rows = statement.query_map([id], |row| {
      let metadata: Option<String> = row.get(4)?;
      Ok(Message {
        id: row.get(0)?, role: row.get(1)?, content: row.get(2)?, created_at: row.get(3)?,
        sources: metadata.and_then(|value| serde_json::from_str(&value).ok()), attachments: vec![],
      })
    })?;
    let mut messages = rows.collect::<std::result::Result<Vec<_>, _>>()?;
    for message in &mut messages { let mut query=self.conn.prepare("SELECT id,name,mime,kind,size,text,CASE WHEN kind='image' THEN data ELSE NULL END FROM attachments WHERE message_id=?")?; message.attachments=query.query_map([&message.id],|r|Ok(Attachment{id:r.get(0)?,name:r.get(1)?,mime:r.get(2)?,kind:r.get(3)?,size:r.get(4)?,text:r.get(5)?,data:r.get(6)?}))?.collect::<std::result::Result<Vec<_>,_>>()?; }
    Ok(messages)
  }
  pub fn add_message(&self, conversation_id:&str, role:&str, content:&str, sources:Option<&Vec<Source>>)->Result<()> { let now=Utc::now().to_rfc3339(); let metadata=sources.map(serde_json::to_string).transpose()?; self.conn.execute("INSERT INTO messages VALUES (?1,?2,?3,?4,?5,?6)",params![Uuid::new_v4().to_string(),conversation_id,role,content,now,metadata])?; self.conn.execute("UPDATE conversations SET updated_at=? WHERE id=?",params![Utc::now().to_rfc3339(),conversation_id])?; Ok(()) }
  pub fn add_user_with_attachments(&self, conversation_id:&str, content:&str, attachments:&[Attachment])->Result<Option<String>> { let title:Option<String>=self.conn.query_row("SELECT title FROM conversations WHERE id=?",[conversation_id],|r|r.get(0)).ok(); let first=self.conn.query_row("SELECT NOT EXISTS(SELECT 1 FROM messages WHERE conversation_id=?)",[conversation_id],|r|r.get::<_,bool>(0))?;let id=Uuid::new_v4().to_string(); let now=Utc::now().to_rfc3339(); self.conn.execute("INSERT INTO messages VALUES (?1,?2,'user',?3,?4,NULL)",params![id,conversation_id,content,now])?; for a in attachments { self.conn.execute("INSERT INTO attachments VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",params![a.id,id,a.name,a.mime,a.kind,a.size,a.text,a.data])?; } let generated=if first && matches!(title.as_deref(),Some("准备开始")|Some("新对话")){let value=generate_title(content,attachments);self.conn.execute("UPDATE conversations SET title=?,updated_at=? WHERE id=?",params![value,now,conversation_id])?;Some(value)}else{self.conn.execute("UPDATE conversations SET updated_at=? WHERE id=?",params![now,conversation_id])?;None}; Ok(generated) }
  pub fn set_system_prompt(&self,id:&str,prompt:&str)->Result<()> { self.conn.execute("UPDATE conversations SET system_prompt=? WHERE id=?",params![prompt,id])?; Ok(()) }
  pub fn attachment_data(&self,id:&str)->Result<Option<String>>{Ok(self.conn.query_row("SELECT data FROM attachments WHERE id=?",[id],|r|r.get(0))?)}
  pub fn system_prompt(&self,id:&str)->Result<String> { Ok(self.conn.query_row("SELECT system_prompt FROM conversations WHERE id=?",[id],|r|r.get(0))?) }
  pub fn search(&self,query:&str)->Result<Vec<Conversation>> { let needle=format!("%{}%",query.replace('%',"\\%").replace('_',"\\_")); Ok(self.conversations()?.into_iter().filter(|c| self.conn.query_row("SELECT EXISTS(SELECT 1 FROM conversations c LEFT JOIN messages m ON m.conversation_id=c.id LEFT JOIN attachments a ON a.message_id=m.id WHERE c.id=?1 AND (c.title LIKE ?2 ESCAPE '\\' OR m.content LIKE ?2 ESCAPE '\\' OR a.text LIKE ?2 ESCAPE '\\'))",params![c.id,needle],|r|r.get::<_,i64>(0)).unwrap_or(0)!=0).collect()) }
  pub fn rename(&self,id:&str,title:&str)->Result<()> {self.conn.execute("UPDATE conversations SET title=?,updated_at=? WHERE id=?",params![title,Utc::now().to_rfc3339(),id])?;Ok(())}
  pub fn set_model(&self,id:&str,model:&str)->Result<()> {self.conn.execute("UPDATE conversations SET model=?,updated_at=? WHERE id=?",params![model,Utc::now().to_rfc3339(),id])?;Ok(())}
  pub fn delete(&self,id:&str)->Result<()> {self.conn.execute("DELETE FROM attachments WHERE message_id IN (SELECT id FROM messages WHERE conversation_id=?)",[id])?;self.conn.execute("DELETE FROM messages WHERE conversation_id=?",[id])?;self.conn.execute("DELETE FROM conversations WHERE id=?",[id])?;Ok(())}
  pub fn delete_last_assistant(&self,id:&str)->Result<()> { self.conn.execute("DELETE FROM messages WHERE id=(SELECT id FROM messages WHERE conversation_id=?1 AND role='assistant' ORDER BY created_at DESC LIMIT 1)",[id])?; Ok(()) }
  pub fn setting(&self,key:&str)->Result<Option<String>> {Ok(self.conn.query_row("SELECT value FROM settings WHERE key=?",[key],|r|r.get(0)).ok())}
  pub fn set_setting(&self,key:&str,value:&str)->Result<()> {self.conn.execute("INSERT INTO settings(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",params![key,value])?;Ok(())}
}

fn generate_title(content:&str,attachments:&[Attachment])->String {
  let first_line=content.lines().find(|line|!line.trim().is_empty()).unwrap_or("").trim();
  let cleaned=first_line.trim_start_matches(|c:char|c.is_whitespace()||"#>*-•".contains(c));
  let cleaned=["请帮我","帮我","请你","请","帮忙","能否","可以帮我"].iter().find_map(|prefix|cleaned.strip_prefix(prefix)).unwrap_or(cleaned).trim();
  let clause=cleaned.split(['。','！','？','!','?','\n']).next().unwrap_or("").trim_matches(|c:char|c.is_whitespace()||"，,：:；;。.".contains(c));
  let title=if clause.is_empty()||matches!(clause,"总结这个文件"|"分析这个文件"|"阅读这个文件"|"总结文档"|"分析文档") {attachments.first().map(|a|format!("阅读 {}",std::path::Path::new(&a.name).file_stem().and_then(|s|s.to_str()).unwrap_or(&a.name))).unwrap_or_else(||"对话".into())}else{clause.into()};
  let short:String=title.chars().take(22).collect();if title.chars().count()>22{format!("{}…",short)}else{short}
}

#[cfg(test)] mod tests {use super::*;#[test] fn title_uses_first_request(){assert_eq!(generate_title("请帮我总结这篇论文。后续问题",&[]),"总结这篇论文");assert_eq!(generate_title("",&[Attachment{id:"1".into(),name:"report.md".into(),mime:"text/markdown".into(),kind:"document".into(),size:1,text:None,data:None}]),"阅读 report");}}
