use super::*;

fn legacy() -> Database {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("CREATE TABLE conversations(id TEXT PRIMARY KEY,title TEXT,model TEXT,created_at TEXT,updated_at TEXT,system_prompt TEXT DEFAULT '');
 CREATE TABLE messages(id TEXT PRIMARY KEY,conversation_id TEXT,role TEXT,content TEXT,created_at TEXT,metadata TEXT);
 CREATE TABLE attachments(id TEXT PRIMARY KEY,message_id TEXT,name TEXT,mime TEXT,kind TEXT,size INTEGER,text TEXT,data TEXT);
 CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT);
 CREATE TABLE api_profiles(id TEXT PRIMARY KEY,name TEXT,base_url TEXT,provider TEXT,model TEXT,thinking TEXT,input_price REAL,output_price REAL);
 CREATE TABLE model_prices(profile_id TEXT,model TEXT,input_price REAL,output_price REAL,PRIMARY KEY(profile_id,model));
 CREATE TABLE usage_records(id TEXT PRIMARY KEY,conversation_id TEXT,profile_id TEXT,model TEXT,input_tokens INTEGER,output_tokens INTEGER,thinking_tokens INTEGER,duration_ms INTEGER,estimated_cost REAL,created_at TEXT,profile_name TEXT);
 INSERT INTO conversations VALUES('c','旧对话','custom-model','0','0','旧 Prompt');
 INSERT INTO messages VALUES('u','c','user','原问题','0',NULL);
 INSERT INTO messages VALUES('a','c','assistant','原回答','1','[{\"title\":\"旧来源\",\"url\":\"https://example.com\",\"snippet\":\"摘要\"}]');
 INSERT INTO attachments VALUES('file','u','old.md','text/markdown','document',3,'旧文档','b2xk');
 INSERT INTO api_profiles VALUES('p','旧配置','https://custom.example/v1','openai-compatible','custom-model','off',1,2);
 INSERT INTO model_prices VALUES('p','custom-model',3,4);
 INSERT INTO usage_records VALUES('usage','c','p','custom-model',123,45,6,1000,0.03,'1','旧配置');
 INSERT INTO settings VALUES('theme','dark'); PRAGMA user_version=2;").unwrap();
    Database { conn }
}

#[derive(Default)]
struct FakeSecrets {
    values: std::cell::RefCell<std::collections::HashMap<String, String>>,
    reject_write: bool,
}

#[test]
fn api_activation_updates_connection_and_model_together() {
    let db = legacy();
    db.set_setting("profile_id", "previous").unwrap();
    db.set_setting("base_url", "https://old.example").unwrap();
    let values = [
        ("profile_id", "p"),
        ("base_url", "https://new.example"),
        ("model", "new-model"),
    ];
    assert!(db
        .save_settings_atomic(&values, Some("missing-conversation"))
        .is_err());
    assert_eq!(
        db.setting("profile_id").unwrap().as_deref(),
        Some("previous")
    );
    assert_eq!(
        db.setting("base_url").unwrap().as_deref(),
        Some("https://old.example")
    );
    assert_eq!(db.conversations().unwrap()[0].model, "custom-model");
    db.save_settings_atomic(&values, Some("c")).unwrap();
    assert_eq!(db.setting("profile_id").unwrap().as_deref(), Some("p"));
    assert_eq!(db.conversations().unwrap()[0].model, "new-model");
}
impl crate::profile_service::Secrets for FakeSecrets {
    fn read(&self, id: &str) -> Result<Option<String>> {
        Ok(self.values.borrow().get(id).cloned())
    }
    fn write(&self, id: &str, key: &str) -> Result<()> {
        anyhow::ensure!(!self.reject_write, "credential write rejected");
        self.values.borrow_mut().insert(id.into(), key.into());
        Ok(())
    }
    fn remove(&self, id: &str) -> Result<()> {
        self.values.borrow_mut().remove(id);
        Ok(())
    }
}
fn secrets() -> FakeSecrets {
    let secrets = FakeSecrets::default();
    secrets
        .values
        .borrow_mut()
        .insert("p".into(), "old-test-secret".into());
    secrets
}

#[test]
fn profile_blank_key_preserves_secret_and_runtime_model() {
    let db = legacy();
    let secrets = secrets();
    db.set_setting("profile_id", "p").unwrap();
    db.set_setting("model", "runtime-model").unwrap();
    let mut p = db.profiles().unwrap().remove(0);
    p.name = "renamed".into();
    p.request_options = serde_json::json!({});
    let saved = crate::profile_service::save(&db, &secrets, p, "").unwrap();
    assert!(saved.has_key);
    assert_eq!(secrets.values.borrow()["p"], "old-test-secret");
    assert_eq!(db.profiles().unwrap().len(), 1);
    assert_eq!(
        db.setting("model").unwrap().as_deref(),
        Some("runtime-model")
    );
    let leaked: bool = db
        .conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM settings WHERE value LIKE '%test-secret%')",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert!(!leaked);
}
#[test]
fn profile_draft_is_saved_without_switching_or_requiring_a_secret() {
    let db = legacy();
    let secrets = secrets();
    let mut p = db.profiles().unwrap().remove(0);
    p.id = "new".into();
    p.name = "".into();
    p.model = "".into();
    p.base_url = " https://example.com/v1/ ".into();
    let saved = crate::profile_service::save(&db, &secrets, p, "").unwrap();
    assert_eq!(saved.name, "example.com");
    assert_eq!(saved.base_url, "https://example.com/v1");
    assert!(!saved.has_key);
    assert!(db.setting("profile_id").unwrap().is_none());
    assert_eq!(db.profiles().unwrap().len(), 2);
}
#[test]
fn profile_failed_database_save_restores_secret_and_options() {
    let db = legacy();
    let secrets = secrets();
    db.set_setting("v3:profileOptions:p", "{\"temperature\":0.2}")
        .unwrap();
    db.conn.execute_batch("CREATE TRIGGER fail_profile BEFORE UPDATE ON api_profiles BEGIN SELECT RAISE(ABORT,'simulated disk failure'); END;").unwrap();
    let mut p = db.profiles().unwrap().remove(0);
    p.name = "changed".into();
    p.request_options = serde_json::json!({"temperature":0.8});
    assert!(crate::profile_service::save(&db, &secrets, p, "new-test-secret").is_err());
    assert_eq!(secrets.values.borrow()["p"], "old-test-secret");
    assert_eq!(db.profiles().unwrap()[0].name, "旧配置");
    assert_eq!(
        db.extension("v3:profileOptions:p").unwrap()["temperature"],
        0.2
    );
}
#[test]
fn credential_failure_does_not_modify_profile() {
    let db = legacy();
    let mut secrets = secrets();
    secrets.reject_write = true;
    let mut p = db.profiles().unwrap().remove(0);
    p.name = "changed".into();
    assert!(crate::profile_service::save(&db, &secrets, p, "new-test-secret").is_err());
    assert_eq!(db.profiles().unwrap()[0].name, "旧配置");
    assert_eq!(secrets.values.borrow()["p"], "old-test-secret");
}
#[test]
fn deleting_active_profile_clears_connections_but_keeps_history() {
    let db = legacy();
    let secrets = secrets();
    db.set_setting("profile_id", "p").unwrap();
    db.set_setting("base_url", "https://example.com").unwrap();
    db.set_setting(
        "v3:chatProviders",
        "{\"gpt\":{\"profileId\":\"p\"},\"kimi\":{\"profileId\":\"other\"}}",
    )
    .unwrap();
    db.set_setting("v3:capabilities:p", "{}").unwrap();
    crate::profile_service::delete(&db, &secrets, "p").unwrap();
    assert_eq!(db.setting("profile_id").unwrap().as_deref(), Some(""));
    assert_eq!(db.setting("base_url").unwrap().as_deref(), Some(""));
    assert!(db.profiles().unwrap().is_empty());
    assert!(!secrets.values.borrow().contains_key("p"));
    assert!(db.extension("v3:chatProviders").unwrap()["gpt"].is_null());
    assert_eq!(
        db.extension("v3:chatProviders").unwrap()["kimi"]["profileId"],
        "other"
    );
    assert_eq!(db.usage().unwrap().len(), 1);
    assert_eq!(db.messages("c").unwrap().len(), 2);
    assert_eq!(db.attachment_data("file").unwrap().as_deref(), Some("b2xk"));
}
#[test]
fn failed_delete_restores_secret_and_model_prices() {
    let db = legacy();
    let secrets = secrets();
    db.conn.execute_batch("CREATE TRIGGER fail_delete BEFORE DELETE ON api_profiles BEGIN SELECT RAISE(ABORT,'disk failure'); END;").unwrap();
    assert!(crate::profile_service::delete(&db, &secrets, "p").is_err());
    assert_eq!(secrets.values.borrow()["p"], "old-test-secret");
    assert_eq!(db.model_prices().unwrap().len(), 1);
    assert_eq!(db.profiles().unwrap().len(), 1);
}

#[test]
fn upgrade_preserves_all_legacy_data_and_is_repeatable() {
    let db = legacy();
    let before = db.messages("c").unwrap();
    let usage = serde_json::to_string(&db.usage().unwrap()).unwrap();
    let profiles = serde_json::to_string(&db.profiles().unwrap()).unwrap();
    let prices = serde_json::to_string(&db.model_prices().unwrap()).unwrap();
    migrate_v3(&db.conn).unwrap();
    migrate_v3(&db.conn).unwrap();
    let after = db.active_messages("c").unwrap();
    assert_eq!(after.len(), 2);
    assert_eq!(after[0].content, before[0].content);
    assert_eq!(after[0].attachments[0].text, before[0].attachments[0].text);
    assert_eq!(db.attachment_data("file").unwrap().as_deref(), Some("b2xk"));
    assert_eq!(
        after[1].sources.as_ref().unwrap()[0].url,
        "https://example.com"
    );
    assert_eq!(after[1].parent_id.as_deref(), Some("u"));
    assert_eq!(after[1].usage_id.as_deref(), Some("usage"));
    assert_eq!(serde_json::to_string(&db.usage().unwrap()).unwrap(), usage);
    assert_eq!(
        serde_json::to_string(&db.profiles().unwrap()).unwrap(),
        profiles
    );
    assert_eq!(
        serde_json::to_string(&db.model_prices().unwrap()).unwrap(),
        prices
    );
    assert_eq!(db.setting("theme").unwrap().as_deref(), Some("dark"));
    assert_eq!(db.system_prompt("c").unwrap(), "旧 Prompt");
}

#[test]
fn regenerating_and_editing_preserve_branches_and_attachments() {
    let db = legacy();
    migrate_v3(&db.conn).unwrap();
    db.set_leaf("c", Some("u")).unwrap();
    db.add_message("c", "assistant", "第二版", None).unwrap();
    let second = db.leaf("c").unwrap().unwrap();
    assert_eq!(db.messages("c").unwrap().len(), 3);
    assert_eq!(db.active_messages("c").unwrap()[1].content, "第二版");
    db.set_leaf("c", Some("a")).unwrap();
    assert_eq!(db.active_messages("c").unwrap()[1].content, "原回答");
    let original = db.messages("c").unwrap().remove(0);
    db.set_leaf("c", None).unwrap();
    db.add_user_with_attachments("c", "修改的问题", &original.attachments)
        .unwrap();
    let edited = db.active_messages("c").unwrap();
    assert_eq!(edited.len(), 1);
    assert_eq!(edited[0].attachments.len(), 1);
    assert_ne!(edited[0].attachments[0].id, "file");
    assert_eq!(
        db.attachment_data(&edited[0].attachments[0].id)
            .unwrap()
            .as_deref(),
        Some("b2xk")
    );
    assert_eq!(db.attachment_data("file").unwrap().as_deref(), Some("b2xk"));
    db.set_leaf("c", Some(&second)).unwrap();
    assert_eq!(db.active_messages("c").unwrap()[0].content, "原问题");
    let other = db.create("m").unwrap();
    assert!(db.set_leaf(&other.id, Some("a")).is_err());
    assert!(db.set_leaf("missing", None).is_err());
}

#[test]
fn response_and_usage_commit_atomically() {
    let db = legacy();
    migrate_v3(&db.conn).unwrap();
    let mut usage = db.usage().unwrap().remove(0);
    let before = db.leaf("c").unwrap();
    let trace = serde_json::json!({"status":"completed"});
    // Duplicate usage ID must roll back the message, node and active leaf.
    assert!(db
        .save_response("c", "new", &vec![], &trace, &usage, "thought")
        .is_err());
    assert_eq!(db.leaf("c").unwrap(), before);
    assert_eq!(db.messages("c").unwrap().len(), 2);
    usage.id = "new-usage".into();
    db.save_response("c", "new", &vec![], &trace, &usage, "thought")
        .unwrap();
    let path = db.active_messages("c").unwrap();
    assert_eq!(path.last().unwrap().usage_id.as_deref(), Some("new-usage"));
    assert_eq!(path.last().unwrap().reasoning_content, "thought");
}

#[test]
fn failed_migration_rolls_back_schema_and_version() {
    let db = legacy();
    db.conn.execute_batch("DROP TABLE usage_records;").unwrap();
    assert!(migrate_v3(&db.conn).is_err());
    let version: i64 = db
        .conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .unwrap();
    assert_eq!(version, 2);
    assert!(db.conn.prepare("SELECT * FROM message_nodes").is_err());
    assert_eq!(db.messages("c").unwrap().len(), 2);
}

#[test]
fn references_and_extension_data_survive_branch_switch() {
    let db = legacy();
    migrate_v3(&db.conn).unwrap();
    db.annotate_leaf(
        "c",
        &[MessageReference {
            message_id: "u".into(),
            text: "选中文字".into(),
        }],
        None,
    )
    .unwrap();
    db.set_setting("v3:presets", "[{\"name\":\"persona\"}]")
        .unwrap();
    db.set_leaf("c", Some("u")).unwrap();
    db.set_leaf("c", Some("a")).unwrap();
    assert_eq!(
        db.active_messages("c").unwrap()[1].references[0].text,
        "选中文字"
    );
    assert_eq!(db.extension("v3:presets").unwrap()[0]["name"], "persona");
}
