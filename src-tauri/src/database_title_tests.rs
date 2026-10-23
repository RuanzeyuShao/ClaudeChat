use super::*;
fn db()->Database{let db=super::v3_tests::legacy();migrate_v3(&db.conn).unwrap();db}
#[test] fn claims_only_the_first_user_turn_and_preserves_manual_names(){
 let db=db();let c=db.create("model").unwrap();let ticket=db.add_user_with_attachments(&c.id,"很长的用户请求，不应该直接截取为标题",&[]).unwrap().unwrap();
 assert_eq!(db.conversations().unwrap().iter().find(|x|x.id==c.id).unwrap().title,"新对话");assert!(db.title_pending(&c.id,&ticket).unwrap());
 assert!(db.add_user_with_attachments(&c.id,"第二个问题",&[]).unwrap().is_none());
 assert_eq!(db.finish_title(&c.id,&ticket,Some("需求分析与执行计划"),None,&serde_json::Value::Null,&serde_json::Value::Null).unwrap(),Some(true));
 assert!(db.add_user_with_attachments(&c.id,"第三问",&[]).unwrap().is_none());
 let manual=db.create("model").unwrap();db.rename(&manual.id,"自定义标题").unwrap();assert!(db.add_user_with_attachments(&manual.id,"首问",&[]).unwrap().is_none());
 assert!(db.add_user_with_attachments("c","旧会话继续聊",&[]).unwrap().is_none());
}
#[test] fn failed_or_deleted_first_turn_is_not_claimed_again_after_reopen(){
 let db=db();let c=db.create("model").unwrap();let ticket=db.add_user_with_attachments(&c.id,"首次发送",&[]).unwrap().unwrap();
 assert_eq!(db.finish_title(&c.id,&ticket,None,None,&serde_json::Value::Null,&serde_json::Value::Null).unwrap(),Some(false));
 let user=db.messages(&c.id).unwrap()[0].id.clone();db.delete_turn(&c.id,&user).unwrap();migrate_v3(&db.conn).unwrap();
 assert!(db.add_user_with_attachments(&c.id,"清空消息后发送",&[]).unwrap().is_none());
}
#[test] fn delayed_titles_cannot_overwrite_manual_names_or_resurrect_deleted_conversations(){
 let db=db();let c=db.create("model").unwrap();let ticket=db.add_user_with_attachments(&c.id,"首问",&[]).unwrap().unwrap();db.rename(&c.id,"新对话").unwrap();
 assert!(!db.title_pending(&c.id,&ticket).unwrap());assert_eq!(db.finish_title(&c.id,&ticket,Some("迟到标题"),None,&serde_json::Value::Null,&serde_json::Value::Null).unwrap(),Some(false));
 db.delete(&c.id).unwrap();assert_eq!(db.finish_title(&c.id,&ticket,Some("迟到标题"),None,&serde_json::Value::Null,&serde_json::Value::Null).unwrap(),None);
 assert!(db.rename(&c.id,"不能复活").is_err());
}
#[test] fn title_usage_is_separate_and_committed_with_the_title(){
 let db=db();let c=db.create("model").unwrap();let ticket=db.add_user_with_attachments(&c.id,"首问",&[]).unwrap().unwrap();let mut usage=db.usage().unwrap().remove(0);usage.id=format!("title:{ticket}");usage.conversation_id=c.id.clone();
 let origin=serde_json::json!({"purpose":"conversation_title"});let usage_origin=serde_json::json!({"input":"provider","output":"provider"});
 assert_eq!(db.finish_title(&c.id,&ticket,Some("AI概括标题"),Some(&usage),&origin,&usage_origin).unwrap(),Some(true));
 assert_eq!(db.origin("request",&usage.id).unwrap()["purpose"],"conversation_title");assert_eq!(db.messages(&c.id).unwrap().len(),1);
}
