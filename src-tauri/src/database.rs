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
#[derive(Clone, Serialize, Deserialize)] pub struct Source { pub title: String, pub url: String, #[serde(default)] pub snippet: String }
#[derive(Clone, Serialize, Deserialize)] #[serde(rename_all="camelCase")]
pub struct Usage { pub id:String, pub conversation_id:String, pub profile_id:String, pub profile_name:String, pub model:String, pub input_tokens:i64, pub output_tokens:i64, pub thinking_tokens:i64, pub duration_ms:i64, pub estimated_cost:f64, pub created_at:String }
#[derive(Clone, Serialize, Deserialize)] #[serde(rename_all="camelCase")]
pub struct ApiProfile {pub id:String,pub name:String,pub base_url:String,pub provider:String,pub model:String,pub thinking:String,pub input_price:f64,pub output_price:f64,pub has_key:bool}
#[derive(Clone, Serialize, Deserialize)] #[serde(rename_all="camelCase")]
pub struct ModelPrice {pub profile_id:String,pub model:String,pub input_price:f64,pub output_price:f64}

pub struct Database { conn: Connection }
impl Database {
  pub fn open() -> Result<Self> {
    let dir = std::env::var("APPDATA").unwrap_or_else(|_| ".".into());
    let path = std::path::Path::new(&dir).join("ClaudeChat"); std::fs::create_dir_all(&path)?;
    let conn = Connection::open(path.join("claudechat.db"))?;
    conn.execute_batch("CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, title TEXT NOT NULL, model TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL, metadata TEXT); CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS attachments (id TEXT PRIMARY KEY, message_id TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL, kind TEXT NOT NULL, size INTEGER NOT NULL, text TEXT, data TEXT);")?;
    if !conn.prepare("SELECT system_prompt FROM conversations LIMIT 1").is_ok() { conn.execute("ALTER TABLE conversations ADD COLUMN system_prompt TEXT NOT NULL DEFAULT ''", [])?; }
    conn.execute_batch("CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id,created_at); CREATE INDEX IF NOT EXISTS idx_attachments_message ON attachments(message_id); CREATE TABLE IF NOT EXISTS api_profiles(id TEXT PRIMARY KEY,name TEXT NOT NULL,base_url TEXT NOT NULL,provider TEXT NOT NULL,model TEXT NOT NULL,thinking TEXT NOT NULL,input_price REAL NOT NULL DEFAULT 0,output_price REAL NOT NULL DEFAULT 0); CREATE TABLE IF NOT EXISTS model_prices(profile_id TEXT NOT NULL,model TEXT NOT NULL,input_price REAL NOT NULL,output_price REAL NOT NULL,PRIMARY KEY(profile_id,model)); CREATE TABLE IF NOT EXISTS usage_records(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL,profile_id TEXT NOT NULL,model TEXT NOT NULL,input_tokens INTEGER NOT NULL,output_tokens INTEGER NOT NULL,thinking_tokens INTEGER NOT NULL,duration_ms INTEGER NOT NULL,estimated_cost REAL NOT NULL,created_at TEXT NOT NULL);")?;
    migrate_usage(&conn)?;
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
  pub fn add_usage(&self,u:&Usage)->Result<()> {self.conn.execute("INSERT INTO usage_records(id,conversation_id,profile_id,model,input_tokens,output_tokens,thinking_tokens,duration_ms,estimated_cost,created_at,profile_name) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",params![u.id,u.conversation_id,u.profile_id,u.model,u.input_tokens,u.output_tokens,u.thinking_tokens,u.duration_ms,u.estimated_cost,u.created_at,u.profile_name])?;Ok(())}
  pub fn usage(&self)->Result<Vec<Usage>> {let mut q=self.conn.prepare("SELECT id,conversation_id,profile_id,profile_name,model,input_tokens,output_tokens,thinking_tokens,duration_ms,estimated_cost,created_at FROM usage_records ORDER BY created_at DESC")?;let rows=q.query_map([],|r|Ok(Usage{id:r.get(0)?,conversation_id:r.get(1)?,profile_id:r.get(2)?,profile_name:r.get(3)?,model:r.get(4)?,input_tokens:r.get(5)?,output_tokens:r.get(6)?,thinking_tokens:r.get(7)?,duration_ms:r.get(8)?,estimated_cost:r.get(9)?,created_at:r.get(10)?}))?.collect::<std::result::Result<Vec<_>,_>>()?;Ok(rows)}
  pub fn profiles(&self)->Result<Vec<ApiProfile>> {let mut q=self.conn.prepare("SELECT id,name,base_url,provider,model,thinking,input_price,output_price FROM api_profiles ORDER BY rowid")?;let rows=q.query_map([],|r|Ok(ApiProfile{id:r.get(0)?,name:r.get(1)?,base_url:r.get(2)?,provider:r.get(3)?,model:r.get(4)?,thinking:r.get(5)?,input_price:r.get(6)?,output_price:r.get(7)?,has_key:false}))?.collect::<std::result::Result<Vec<_>,_>>()?;Ok(rows)}
  pub fn save_profile(&self,p:&ApiProfile)->Result<()> {self.conn.execute("INSERT INTO api_profiles(id,name,base_url,provider,model,thinking,input_price,output_price) VALUES(?1,?2,?3,?4,?5,?6,?7,?8) ON CONFLICT(id) DO UPDATE SET name=excluded.name,base_url=excluded.base_url,provider=excluded.provider,model=excluded.model,thinking=excluded.thinking,input_price=excluded.input_price,output_price=excluded.output_price",params![p.id,p.name,p.base_url,p.provider,p.model,p.thinking,p.input_price,p.output_price])?;Ok(())}
  pub fn delete_profile(&self,id:&str)->Result<()> {self.conn.execute("DELETE FROM model_prices WHERE profile_id=?",[id])?;self.conn.execute("DELETE FROM api_profiles WHERE id=?",[id])?;Ok(())}
  pub fn model_prices(&self)->Result<Vec<ModelPrice>> {let mut q=self.conn.prepare("SELECT profile_id,model,input_price,output_price FROM model_prices")?;let rows=q.query_map([],|r|Ok(ModelPrice{profile_id:r.get(0)?,model:r.get(1)?,input_price:r.get(2)?,output_price:r.get(3)?}))?.collect::<std::result::Result<Vec<_>,_>>()?;Ok(rows)}
  pub fn save_model_price(&self,p:&ModelPrice)->Result<()> {self.conn.execute("INSERT INTO model_prices VALUES(?1,?2,?3,?4) ON CONFLICT(profile_id,model) DO UPDATE SET input_price=excluded.input_price,output_price=excluded.output_price",params![p.profile_id,p.model,p.input_price,p.output_price])?;Ok(())}
}

fn migrate_usage(conn:&Connection)->Result<()> {
  let version:i64=conn.query_row("PRAGMA user_version",[],|r|r.get(0))?;
  if version<2 {
    let mut columns=conn.prepare("PRAGMA table_info(usage_records)")?;
    let names=columns.query_map([],|r|r.get::<_,String>(1))?.collect::<std::result::Result<Vec<_>,_>>()?;
    if !names.iter().any(|name|name=="profile_name") {conn.execute("ALTER TABLE usage_records ADD COLUMN profile_name TEXT NOT NULL DEFAULT ''",[])?;}
    conn.execute("UPDATE usage_records SET profile_name=COALESCE((SELECT name FROM api_profiles WHERE id=usage_records.profile_id),'') WHERE profile_name=''",[])?;
    conn.execute_batch("CREATE INDEX IF NOT EXISTS idx_usage_created ON usage_records(created_at); CREATE INDEX IF NOT EXISTS idx_usage_dimensions ON usage_records(model,profile_id,conversation_id,created_at); PRAGMA user_version=2;")?;
  }
  Ok(())
}

fn generate_title(content:&str,attachments:&[Attachment])->String {
  let first_line=content.lines().find(|line|!line.trim().is_empty()).unwrap_or("").trim();
  let cleaned=first_line.trim_start_matches(|c:char|c.is_whitespace()||"#>*-•".contains(c));
  let cleaned=["请帮我","帮我","请你","请","帮忙","能否","可以帮我"].iter().find_map(|prefix|cleaned.strip_prefix(prefix)).unwrap_or(cleaned).trim();
  let clause=cleaned.split(['。','！','？','!','?','\n']).next().unwrap_or("").trim_matches(|c:char|c.is_whitespace()||"，,：:；;。.".contains(c));
  let title=if clause.is_empty()||matches!(clause,"总结这个文件"|"分析这个文件"|"阅读这个文件"|"总结文档"|"分析文档") {attachments.first().map(|a|format!("阅读 {}",std::path::Path::new(&a.name).file_stem().and_then(|s|s.to_str()).unwrap_or(&a.name))).unwrap_or_else(||"对话".into())}else{clause.into()};
  let short:String=title.chars().take(22).collect();if title.chars().count()>22{format!("{}…",short)}else{short}
}

#[cfg(test)] mod tests {use super::*;#[test] fn title_uses_first_request(){assert_eq!(generate_title("请帮我总结这篇论文。后续问题",&[]),"总结这篇论文");assert_eq!(generate_title("",&[Attachment{id:"1".into(),name:"report.md".into(),mime:"text/markdown".into(),kind:"document".into(),size:1,text:None,data:None}]),"阅读 report");}
#[test] fn usage_migration_preserves_records(){let conn=Connection::open_in_memory().unwrap();conn.execute_batch("CREATE TABLE api_profiles(id TEXT PRIMARY KEY,name TEXT); INSERT INTO api_profiles VALUES('p','工作'); CREATE TABLE usage_records(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL,profile_id TEXT NOT NULL,model TEXT NOT NULL,input_tokens INTEGER NOT NULL,output_tokens INTEGER NOT NULL,thinking_tokens INTEGER NOT NULL,duration_ms INTEGER NOT NULL,estimated_cost REAL NOT NULL,created_at TEXT NOT NULL); INSERT INTO usage_records VALUES('u','c','p','m',12,4,1,900,0.02,'2026-09-29T00:00:00Z');").unwrap();migrate_usage(&conn).unwrap();migrate_usage(&conn).unwrap();let (name,tokens):(String,i64)=conn.query_row("SELECT profile_name,input_tokens FROM usage_records WHERE id='u'",[],|r|Ok((r.get(0)?,r.get(1)?))).unwrap();assert_eq!(name,"工作");assert_eq!(tokens,12);}
}
