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

fn switch_profile(db:&Database,id:&str,provider:&str,base:&str) {
    db.save_profile_with_credentials(&ApiProfile{id:id.into(),name:format!("Profile {id}"),base_url:base.into(),provider:provider.into(),model:"profile-default-must-not-override".into(),thinking:"off".into(),input_price:1.0,output_price:2.0,has_key:false,request_options:serde_json::Value::Null},false).unwrap();
}
fn choice(db:&Database,id:&str,model:&str)->crate::commands::Settings {
    let mut settings=crate::connection::read(db).unwrap();settings.profile_id=id.into();settings.model=model.into();settings.thinking="low".into();settings.search_mode="off".into();settings.web_search=false;settings
}
fn switch_sse(anthropic:bool,answer:&str)->String {
    let values=if anthropic {vec![serde_json::json!({"type":"message_start","message":{"usage":{"input_tokens":7}}}),serde_json::json!({"type":"content_block_delta","delta":{"text":answer}}),serde_json::json!({"type":"message_delta","usage":{"output_tokens":4}})]}
        else{vec![serde_json::json!({"choices":[{"delta":{"content":answer,"reasoning_content":"request-specific thought"}}]}),serde_json::json!({"choices":[],"usage":{"prompt_tokens":7,"completion_tokens":4,"completion_tokens_details":{"reasoning_tokens":1}}})]};
    values.iter().map(|value|format!("data: {value}\n\n")).collect::<String>()+"data: [DONE]\n\n"
}
#[tokio::test]
async fn model_switch_roundtrip_routes_http_and_preserves_tree_attachments_usage_and_restart() {
    use crate::profile_service::Secrets;
    let db=legacy();migrate_v3(&db.conn).unwrap();
    let before=serde_json::to_value(db.messages("c").unwrap()).unwrap();
    let keys=secrets();
    let (claude,c)=crate::test_http::serve_observed(vec![(200,"text/event-stream",switch_sse(true,"Claude first")),(200,"text/event-stream",switch_sse(true,"Claude last"))]);
    let (deepseek,d)=crate::test_http::serve_observed(vec![(200,"text/event-stream",switch_sse(false,"DeepSeek"))]);
    let (gpt,g)=crate::test_http::serve_observed(vec![(200,"text/event-stream",switch_sse(false,"GPT"))]);
    for (id,kind,base) in [("claude","anthropic-compatible",claude.as_str()),("deepseek","deepseek",deepseek.as_str()),("gpt","openai",gpt.as_str())] {switch_profile(&db,id,kind,base);keys.write(id,&format!("mock-{id}")).unwrap();}
    let image=Attachment{id:"image".into(),name:"pixel.png".into(),mime:"image/png".into(),kind:"image".into(),size:8,text:None,data:Some("iVBORw0KGgo=".into())};
    for (index,(id,model)) in [("claude","claude-selected"),("deepseek","deepseek-selected"),("gpt","gpt-selected"),("claude","claude-return")].iter().enumerate() {
        let saved=crate::connection::save(&db,choice(&db,id,model),Some("c")).unwrap();
        assert_eq!(saved.model,*model);assert_eq!(saved.base_url,match *id{"claude"=>claude.as_str(),"deepseek"=>deepseek.as_str(),_=>gpt.as_str()});
        db.add_user_with_attachments("c",&format!("round {index}"),if index==0{std::slice::from_ref(&image)}else{&[]}).unwrap();
        let history=crate::connection::prepare_history(db.active_messages("c").unwrap(),&db.extension("v4:requestOrigins").unwrap(),&saved);
        let (answer,sources,input,output,thinking,_,reasoning)=crate::provider::stream(&saved,keys.read(id).unwrap().unwrap(),history,"旧 Prompt".into(),false,std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),|_|Ok(())).await.unwrap();
        let usage=Usage{id:format!("switch-{index}"),conversation_id:"c".into(),profile_id:id.to_string(),profile_name:format!("Profile {id}"),model:model.to_string(),input_tokens:input,output_tokens:output,thinking_tokens:thinking,duration_ms:100,estimated_cost:(input as f64+output as f64*2.0)/1_000_000.0,created_at:format!("2026-10-09T00:00:0{index}Z")};
        db.save_response_with_origin("c",&answer,&sources,&serde_json::json!({"status":"off"}),&usage,&reasoning,Some(&crate::connection::identity(&saved,&usage.profile_name))).unwrap();
    }
    let cr=c.join().unwrap();let dr=d.join().unwrap();let gr=g.join().unwrap();
    for request in &cr {assert_eq!(request.path,"/v1/messages");assert_eq!(request.headers["x-api-key"],"mock-claude");assert_eq!(request.body["system"],"旧 Prompt");}
    assert_eq!(cr[0].body["model"],"claude-selected");assert_eq!(cr[1].body["model"],"claude-return");
    assert_eq!(dr[0].path,"/v1/chat/completions");assert_eq!(dr[0].headers["authorization"],"Bearer mock-deepseek");assert_eq!(dr[0].body["model"],"deepseek-selected");
    assert_eq!(gr[0].path,"/v1/chat/completions");assert_eq!(gr[0].headers["authorization"],"Bearer mock-gpt");assert_eq!(gr[0].body["model"],"gpt-selected");
    assert!(cr[1].body["messages"].to_string().contains("GPT"));assert!(gr[0].body["messages"].to_string().contains("DeepSeek"));
    assert!(cr[0].body["messages"].to_string().contains("旧文档"));assert!(cr[1].body["messages"].to_string().contains("base64"));assert!(dr[0].body["messages"].to_string().contains("image_url"));assert!(!gr[0].body["messages"].to_string().contains("reasoning_content"));
    let messages=db.messages("c").unwrap();assert_eq!(messages.len(),10);assert_eq!(serde_json::to_value(&messages[..2]).unwrap(),before);
    assert_eq!(db.active_messages("c").unwrap().len(),10);assert_eq!(db.attachment_data("file").unwrap().as_deref(),Some("b2xk"));
    let origins=db.extension("v4:requestOrigins").unwrap();assert_eq!(origins["switch-0"]["provider"],"anthropic-compatible");assert_eq!(origins["switch-1"]["provider"],"deepseek");assert_eq!(origins["switch-2"]["provider"],"openai");assert_eq!(origins["switch-0"]["model"],"claude-selected");assert!(origins["switch-0"].get("apiKey").is_none());
    let usage=db.usage().unwrap();assert_eq!(usage.len(),5);assert_eq!(usage.iter().find(|u|u.id=="usage").unwrap().estimated_cost,0.03);
    for index in 0..4 {let row=usage.iter().find(|u|u.id==format!("switch-{index}")).unwrap();assert_eq!((row.input_tokens,row.output_tokens),(7,4));assert_eq!(row.estimated_cost,0.000015);assert_eq!(row.model,origins[&row.id]["model"].as_str().unwrap());}
    crate::connection::save(&db,choice(&db,"gpt","temporary-global"),None).unwrap();
    let restored=crate::connection::restore(&db,"c").unwrap();assert_eq!(restored.provider,"anthropic-compatible");assert_eq!(restored.model,"claude-return");assert_eq!(restored.base_url,claude);assert_eq!(db.extension("v4:lastConversation").unwrap(),"c");
    db.set_leaf("c",Some("a")).unwrap();assert_eq!(db.active_messages("c").unwrap().len(),2);assert_eq!(db.messages("c").unwrap().len(),10);
}
#[test]
fn connection_failure_rolls_back_global_conversation_snapshot_and_reply_identity() {
    let db=legacy();migrate_v3(&db.conn).unwrap();switch_profile(&db,"switch","openai","https://example.com/v1");
    crate::connection::save(&db,choice(&db,"switch","original"),Some("c")).unwrap();
    let before=db.extension("v4:conversationConnection:c").unwrap();
    db.conn.execute_batch("CREATE TRIGGER reject_connection BEFORE UPDATE ON settings WHEN NEW.key='v4:conversationConnection:c' BEGIN SELECT RAISE(ABORT,'simulated disk error'); END;").unwrap();
    assert!(crate::connection::save(&db,choice(&db,"switch","new-model"),Some("c")).is_err());assert_eq!(crate::connection::read(&db).unwrap().model,"original");assert_eq!(db.conversations().unwrap()[0].model,"original");assert_eq!(db.extension("v4:conversationConnection:c").unwrap(),before);
    let mut usage=db.usage().unwrap().remove(0);usage.id="new".into();db.conn.execute_batch("CREATE TRIGGER reject_origin BEFORE INSERT ON settings WHEN NEW.key='v4:requestOrigins' BEGIN SELECT RAISE(ABORT,'simulated disk error'); END;").unwrap();
    assert!(db.save_response_with_origin("c","new reply",&vec![],&serde_json::json!({}),&usage,"thought",Some(&before)).is_err());assert_eq!(db.messages("c").unwrap().len(),2);assert_eq!(db.usage().unwrap().len(),1);
}
#[test]
fn generation_guard_blocks_switch_but_allows_appearance_changes_and_releases_on_failure() {
    let db=legacy();let original=crate::connection::read(&db).unwrap();let mut changed=original.clone();changed.model="new".into();
    let generating=std::sync::Arc::new(std::sync::atomic::AtomicBool::new(true));assert!(crate::connection::lock_if_changed(&original,&changed,&generating).is_err());
    let mut appearance=original.clone();appearance.theme="light".into();assert!(crate::connection::lock_if_changed(&original,&appearance,&generating).unwrap().is_none());assert!(generating.load(std::sync::atomic::Ordering::Relaxed));
    generating.store(false,std::sync::atomic::Ordering::Relaxed);let guard=crate::connection::lock_if_changed(&original,&changed,&generating).unwrap();assert!(generating.load(std::sync::atomic::Ordering::Relaxed));drop(guard);assert!(!generating.load(std::sync::atomic::Ordering::Relaxed));
}
#[test]
fn restoring_legacy_history_keeps_complete_last_connection_and_all_six_providers() {
    let db=legacy();migrate_v3(&db.conn).unwrap();
    for (index,provider) in ["anthropic-compatible","openai","deepseek","moonshot","zhipu","grok"].iter().enumerate(){let id=format!("provider-{index}");switch_profile(&db,&id,provider,"https://example.com/custom");let saved=crate::connection::save(&db,choice(&db,&id,"selected-custom-model"),None).unwrap();let restored=crate::connection::restore(&db,"c").unwrap();if index==0{assert_eq!(restored.provider,saved.provider)}else{crate::connection::save(&db,choice(&db,&id,"selected-custom-model"),Some("c")).unwrap();assert_eq!(crate::connection::restore(&db,"c").unwrap().provider,*provider)}assert_eq!(db.messages("c").unwrap().len(),2);}
}
#[test]
fn foreign_reasoning_is_filtered_only_from_request_copies_not_saved_messages() {
    let db=legacy();let mut target=crate::connection::read(&db).unwrap();target.provider="deepseek".into();target.model="selected".into();
    let message=Message{id:"answer".into(),usage_id:Some("usage".into()),role:"assistant".into(),content:"keep this answer".into(),reasoning_content:"private reasoning".into(),..Default::default()};
    let same=serde_json::json!({"usage":{"provider":"deepseek","model":"selected"}});assert_eq!(crate::connection::prepare_history(vec![message.clone()],&same,&target)[0].reasoning_content,"private reasoning");
    let other=serde_json::json!({"usage":{"provider":"anthropic-compatible","model":"selected"}});assert!(crate::connection::prepare_history(vec![message.clone()],&other,&target)[0].reasoning_content.is_empty());assert_eq!(message.reasoning_content,"private reasoning");
    target.model="different-model".into();assert!(crate::connection::prepare_history(vec![message.clone()],&same,&target)[0].reasoning_content.is_empty());
    assert_eq!(crate::connection::prepare_history(vec![message],&serde_json::Value::Null,&target)[0].reasoning_content,"private reasoning");
}
#[test]
fn search_mode_and_flag_restore_together_and_snapshots_never_store_api_keys() {
    let db=legacy();migrate_v3(&db.conn).unwrap();switch_profile(&db,"chosen","openai","https://example.com/v1");
    let mut original=choice(&db,"chosen","custom-model");original.search_mode="auto".into();original.web_search=true;original.api_key="mock-key-must-not-persist".into();
    crate::connection::save(&db,original.clone(),Some("c")).unwrap();let mut other=original;other.web_search=false;other.search_mode="off".into();crate::connection::save(&db,other,None).unwrap();
    let restored=crate::connection::restore(&db,"c").unwrap();assert!(restored.web_search);assert_eq!(restored.search_mode,"auto");assert!(restored.api_key.is_empty());let snapshot=db.extension("v4:conversationConnection:c").unwrap();assert!(snapshot.get("apiKey").is_none());assert!(!snapshot.to_string().contains("mock-key"));
}
