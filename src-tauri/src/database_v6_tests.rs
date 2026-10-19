use super::*;

fn db()->Database {let db=super::v3_tests::legacy();migrate_v3(&db.conn).unwrap();db}

#[test]
fn stable_application_directory_migrates_legacy_database_without_overwriting_new_data(){
    let root=std::env::temp_dir().join(format!("claudechat-v016-{}",Uuid::new_v4()));let legacy=root.join("ClaudeChat");let current=root.join("com.ruanzeyu.claudechat");std::fs::create_dir_all(&legacy).unwrap();
    let old=super::v3_tests::legacy();old.conn.execute("VACUUM INTO ?",[legacy.join("claudechat.db").to_string_lossy().as_ref()]).unwrap();
    {let migrated=Database::open(&current,&legacy).unwrap();assert_eq!(migrated.messages("c").unwrap().len(),2);migrated.rename("c","新目录中的标题").unwrap();}
    {let reopened=Database::open(&current,&legacy).unwrap();assert_eq!(reopened.conversations().unwrap()[0].title,"新目录中的标题");}
    assert!(legacy.join("claudechat.db").exists());std::fs::remove_dir_all(&root).unwrap();
}

#[test]
fn failed_clear_restores_profile_and_legacy_credentials_and_database_rows(){
    use crate::profile_service::Secrets;
    struct MemorySecrets(std::cell::RefCell<std::collections::HashMap<String,String>>);
    impl Secrets for MemorySecrets{
        fn read(&self,id:&str)->Result<Option<String>>{Ok(self.0.borrow().get(id).cloned())}
        fn write(&self,id:&str,key:&str)->Result<()>{self.0.borrow_mut().insert(id.into(),key.into());Ok(())}
        fn remove(&self,id:&str)->Result<()>{self.0.borrow_mut().remove(id);Ok(())}
    }
    let db=db();let secrets=MemorySecrets(std::cell::RefCell::new(std::collections::HashMap::new()));secrets.write("p","profile-secret").unwrap();secrets.write("","legacy-secret").unwrap();
    db.conn.execute_batch("CREATE TRIGGER reject_clear BEFORE DELETE ON messages BEGIN SELECT RAISE(ABORT,'disk failure'); END;").unwrap();
    assert!(crate::profile_service::clear_all(&db,&secrets).is_err());assert_eq!(db.messages("c").unwrap().len(),2);assert_eq!(secrets.read("p").unwrap().as_deref(),Some("profile-secret"));assert_eq!(secrets.read("").unwrap().as_deref(),Some("legacy-secret"));
    db.conn.execute_batch("DROP TRIGGER reject_clear;").unwrap();crate::profile_service::clear_all(&db,&secrets).unwrap();assert!(secrets.0.borrow().is_empty());assert!(db.messages("c").unwrap().is_empty());
}

#[test]
fn v3_upgrade_migrates_origin_maps_and_base64_drafts_once(){
    let db=db();db.conn.execute_batch("PRAGMA user_version=3;").unwrap();
    db.conn.execute("INSERT INTO settings VALUES('v4:requestOrigins',?)",[r#"{"reply:a":{"provider":"openai"}}"#]).unwrap();
    db.conn.execute("INSERT INTO settings VALUES('v4:usageOrigins',?)",[r#"{"usage":{"input":"provider"}}"#]).unwrap();
    db.conn.execute("INSERT INTO settings VALUES('v4:drafts',?)",[r#"{"c":{"text":"未发送","attachments":[{"id":"draft","name":"image.png","mime":"image/png","kind":"image","size":4,"text":null,"data":"BASE64"}]}}"#]).unwrap();
    migrate_v3(&db.conn).unwrap();migrate_v3(&db.conn).unwrap();
    assert!(db.setting("v4:drafts").unwrap().is_none());assert!(db.setting("v4:requestOrigins").unwrap().is_none());
    assert_eq!(db.extension("v4:requestOrigins").unwrap()["reply:a"]["provider"],"openai");
    assert_eq!(db.origin("usage","usage").unwrap()["input"],"provider");
    assert_eq!(db.drafts().unwrap()["c"]["text"],"未发送");assert!(db.drafts().unwrap()["c"]["attachments"][0].get("data").is_none());
    assert_eq!(db.attachment_data("draft").unwrap().as_deref(),Some("BASE64"));
}

#[test]
fn drafts_are_bounded_metadata_and_hydrate_cached_files_without_rewriting_other_conversations(){
    let db=db();let other=db.create("model").unwrap();
    let file=Attachment{id:"draft".into(),name:"photo.png".into(),mime:"image/png".into(),kind:"image".into(),size:10,text:None,data:Some("LARGE_BINARY".repeat(1000))};
    db.cache_attachment("c",&file).unwrap();
    db.save_draft("c",serde_json::json!({"text":"草稿","attachments":[file]})).unwrap();
    db.save_draft(&other.id,serde_json::json!({"text":"独立草稿","attachments":[]})).unwrap();
    let saved=db.drafts().unwrap();assert!(saved["c"].to_string().len()<300);assert_eq!(saved[&other.id]["text"],"独立草稿");
    let meta:Attachment=serde_json::from_value(saved["c"]["attachments"][0].clone()).unwrap();assert!(meta.data.is_none());assert_eq!(db.hydrate_attachment("c",&meta).unwrap().data,file.data);
    assert!(db.hydrate_attachment(&other.id,&meta).unwrap().data.is_none());
    assert!(db.save_draft("c",serde_json::json!({"text":"x".repeat(256*1024),"attachments":[]})).is_err());
    assert_eq!(db.drafts().unwrap()["c"]["text"],"草稿");
}

#[test]
fn context_selections_are_isolated_and_survive_settings_restore(){
    let db=db();let other=db.create("model").unwrap();let mut settings=crate::connection::read(&db).unwrap();
    settings.context_mode="recent".into();settings.recent_turns=3;settings.selected_message_ids=vec!["u".into()];settings.selected_attachment_ids=vec!["file".into()];
    crate::connection::save(&db,settings,Some("c")).unwrap();
    let second=crate::connection::restore(&db,&other.id).unwrap();assert!(second.selected_message_ids.is_empty());assert_eq!(second.context_mode,"full");
    let first=crate::connection::restore(&db,"c").unwrap();assert_eq!(first.selected_message_ids,vec!["u"]);assert_eq!(first.selected_attachment_ids,vec!["file"]);assert_eq!(first.recent_turns,3);
}

#[test]
fn checkpoints_upsert_only_the_current_origin_row_and_rollback_together(){
    let db=db();db.set_origin("request","old",&serde_json::json!({"untouched":true})).unwrap();
    for n in 0..20 {db.checkpoint_response("c","checkpoint",&format!("段落 {n}"),&[],"",&serde_json::json!({}),&serde_json::json!({"n":n})).unwrap();}
    assert_eq!(db.origin("request","old").unwrap()["untouched"],true);assert_eq!(db.origin("request","reply:checkpoint").unwrap()["n"],19);
    assert_eq!(db.conn.query_row("SELECT count(*) FROM origins WHERE kind='request'",[],|r|r.get::<_,i64>(0)).unwrap(),2);
    db.conn.execute_batch("CREATE TRIGGER reject_checkpoint BEFORE UPDATE ON origins BEGIN SELECT RAISE(ABORT,'disk full'); END;").unwrap();
    assert!(db.checkpoint_response("c","checkpoint","cannot save",&[],"",&serde_json::json!({}),&serde_json::json!({"n":20})).is_err());
    assert_eq!(db.messages("c").unwrap().last().unwrap().content,"段落 19");
}

#[test]
fn deleting_turn_removes_its_descendants_and_attachments_but_preserves_usage(){
    let db=db();db.add_message("c","user","follow up",None).unwrap();db.add_message("c","assistant","answer",None).unwrap();
    db.set_leaf("c",Some("u")).unwrap();db.add_message("c","assistant","sibling answer",None).unwrap();let sibling=db.leaf("c").unwrap();
    db.delete_turn("c","a").unwrap();assert!(db.messages("c").unwrap().is_empty());assert!(db.leaf("c").unwrap().is_none());
    assert_eq!(db.usage().unwrap().len(),1);assert!(db.attachment_data("file").unwrap().is_none());assert!(sibling.is_some());
}

#[test]
fn deletion_and_maintenance_remove_auxiliary_data_and_keep_historical_bills(){
    let db=db();db.set_setting("v4:conversationConnection:c","{}").unwrap();db.set_setting("v6:context:c","{}").unwrap();
    db.set_origin("request","usage",&serde_json::json!({"profileId":"p"})).unwrap();db.set_origin("usage","usage",&serde_json::json!({"input":"provider"})).unwrap();
    db.delete("c").unwrap();assert!(db.setting("v4:conversationConnection:c").unwrap().is_none());assert!(db.setting("v6:context:c").unwrap().is_none());assert!(db.origin("usage","usage").unwrap().is_null());assert_eq!(db.usage().unwrap().len(),1);
    db.set_origin("usage","orphan",&serde_json::json!({})).unwrap();assert_eq!(db.cleanup().unwrap(),1);
    db.clear_all().unwrap();assert!(db.usage().unwrap().is_empty());assert!(db.profiles().unwrap().is_empty());assert!(db.conversations().unwrap().is_empty());
}

#[test]
fn bulk_message_loading_retains_branch_metadata_and_search_escapes_wildcards(){
    let db=db();db.annotate_leaf("c",&[MessageReference{message_id:"u".into(),text:"引用".into()}],Some(&serde_json::json!({"status":"off"}))).unwrap();
    let all=db.messages("c").unwrap();let path=db.path_from("c",&all).unwrap();assert_eq!(path.len(),2);assert_eq!(path[1].references[0].text,"引用");assert_eq!(path[0].attachments.len(),1);
    db.rename("c","literal 100%_\\ match").unwrap();assert_eq!(db.search("100%_\\").unwrap().len(),1);assert!(db.search("100%xx").unwrap().is_empty());
    for _ in 0..55{db.create("model").unwrap();}assert_eq!(db.search("准备开始").unwrap().len(),50);
    assert_eq!(db.usage_page(0,1,None,None,None).unwrap().len(),1);assert!(db.usage_page(1,1,None,None,None).unwrap().is_empty());assert!(db.usage_page(0,500,Some("2026"),None,None).unwrap().is_empty());
}
