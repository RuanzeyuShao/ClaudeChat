//! Persist the chosen connection independently from historical reply/usage data.
use crate::{commands::Settings, database::Database};
use anyhow::{anyhow, Result};
use serde_json::{json, Value};
use std::sync::{atomic::{AtomicBool, Ordering}, Arc};

pub const FIELDS: &[&str] = &["baseUrl","provider","profileId","model","thinking","webSearch","searchMode","searchProvider","searchBaseUrl","searchModel","requestOptions"];
pub const COLOR_THEMES:&[&str]=&["emerald","ocean","violet","coral","sakura","forest","amber","graphite"];
pub fn default_color_theme()->String{"emerald".into()}
fn color_theme(value:String)->String{if COLOR_THEMES.contains(&value.as_str()){value}else{default_color_theme()}}
#[derive(Clone,serde::Serialize)]
#[serde(rename_all="camelCase")]
pub struct Appearance {pub theme:String,pub color_theme:String}
pub fn save_appearance(db:&Database,theme:String,color_theme:String)->Result<Appearance>{
    anyhow::ensure!(matches!(theme.as_str(),"light"|"dark"|"system"),"外观模式无效");
    anyhow::ensure!(COLOR_THEMES.contains(&color_theme.as_str()),"颜色主题无效");
    db.save_settings_and_prompt_atomic(&[("theme",theme.as_str()),("color_theme",color_theme.as_str())],None,None)?;
    Ok(Appearance{theme,color_theme})
}

pub fn selection(settings: &Settings) -> Value {
    let value=serde_json::to_value(settings).expect("Settings is serializable");
    Value::Object(FIELDS.iter().map(|key| (key.to_string(),value[*key].clone())).collect())
}
pub fn identity(settings:&Settings, profile_name:&str)->Value {
    let mut value=selection(settings);
    value["profileName"]=json!(profile_name);
    value
}
pub fn read(db:&Database)->Result<Settings> {
    let saved=|key:&str,default:&str|->Result<String>{Ok(db.setting(key)?.unwrap_or_else(||default.to_string()))};
    let profile_id=saved("profile_id","")?;
    Ok(Settings {
        auto_continuations:saved("auto_continuations","1")?.parse::<usize>().unwrap_or(1).min(2),auto_recoveries:saved("auto_recoveries","0")?.parse::<usize>().unwrap_or(0).min(3),
        api_key:String::new(),base_url:saved("base_url","")?,provider:saved("provider","anthropic-compatible")?,model:saved("model","")?,
        thinking:saved("thinking","medium")?,web_search:saved("web_search","true")?=="true",theme:saved("theme","system")?,color_theme:color_theme(saved("color_theme","emerald")?),
        system_prompt:saved("system_prompt","")?,profile_id:profile_id.clone(),search_mode:saved("search_mode","auto")?,
        search_provider:saved("search_provider","claude")?,search_base_url:saved("search_base_url","")?,search_model:saved("search_model","")?,
        context_mode:saved("context_mode","full")?,recent_turns:saved("recent_turns","10")?.parse().unwrap_or(10),
        selected_message_ids:vec![],selected_attachment_ids:vec![],request_options:db.extension(&format!("v3:profileOptions:{profile_id}"))?,
    })
}
pub fn resolve(db:&Database,mut settings:Settings)->Result<Settings> {
    settings.auto_continuations=settings.auto_continuations.min(2);settings.auto_recoveries=settings.auto_recoveries.min(3);
    settings.color_theme=color_theme(settings.color_theme);
    if !settings.profile_id.is_empty() {
        let profile=db.profiles()?.into_iter().find(|p|p.id==settings.profile_id).ok_or_else(||anyhow!("此 API 配置已被删除，请重新选择"))?;
        settings.base_url=profile.base_url;
        settings.provider=profile.provider;
        settings.request_options=db.extension(&format!("v3:profileOptions:{}",settings.profile_id))?;
    }
    settings.model=settings.model.trim().to_string();
    settings.base_url=settings.base_url.trim().trim_end_matches('/').to_string();
    crate::provider::ProviderAdapter::new(&settings.provider)?;
    if !settings.base_url.is_empty() {
        let url=reqwest::Url::parse(&settings.base_url).map_err(|_|anyhow!("API 地址无效，请填写完整的 HTTP 或 HTTPS 地址"))?;
        anyhow::ensure!(matches!(url.scheme(),"http"|"https"),"API 地址须使用 HTTP 或 HTTPS");
    }
    // The selected model is deliberately never replaced by the Profile default.
    Ok(settings)
}
pub fn persist(db:&Database,settings:&Settings,id:Option<&str>)->Result<()> {
    persist_with_prompt(db,settings,id,None)
}
pub fn persist_with_prompt(db:&Database,settings:&Settings,id:Option<&str>,prompt:Option<&str>)->Result<()> {
    let recent=settings.recent_turns.to_string();
    let continuations=settings.auto_continuations.min(2).to_string();let recoveries=settings.auto_recoveries.min(3).to_string();
    let options=settings.request_options.to_string();
    let mut values=vec![("auto_continuations",continuations.as_str()),("auto_recoveries",recoveries.as_str()),
        ("base_url",settings.base_url.as_str()),("provider",settings.provider.as_str()),("profile_id",settings.profile_id.as_str()),
        ("model",settings.model.as_str()),("thinking",settings.thinking.as_str()),("web_search",if settings.web_search{"true"}else{"false"}),
        ("theme",settings.theme.as_str()),("color_theme",settings.color_theme.as_str()),("system_prompt",settings.system_prompt.as_str()),("search_mode",settings.search_mode.as_str()),
        ("search_provider",settings.search_provider.as_str()),("search_base_url",settings.search_base_url.as_str()),("search_model",settings.search_model.as_str()),
        ("context_mode",settings.context_mode.as_str()),("recent_turns",recent.as_str()),
    ];
    if settings.profile_id.is_empty(){values.push(("v3:profileOptions:",options.as_str()))}
    let connection_key=id.map(|id|format!("v4:conversationConnection:{id}"));
    let connection_value=selection(settings).to_string();
    let last=id.map(|id|json!(id).to_string());
    if let Some(key)=connection_key.as_ref(){values.push((key.as_str(),connection_value.as_str()));values.push(("v4:lastConversation",last.as_deref().unwrap()))}
    let context_key=id.map(|id|format!("v6:context:{id}"));
    let context=serde_json::json!({"contextMode":settings.context_mode,"recentTurns":settings.recent_turns,"selectedMessageIds":settings.selected_message_ids,"selectedAttachmentIds":settings.selected_attachment_ids}).to_string();
    if let Some(key)=context_key.as_ref(){values.push((key.as_str(),context.as_str()))}
    db.save_settings_and_prompt_atomic(&values,id,prompt)
}
pub fn save(db:&Database,settings:Settings,id:Option<&str>)->Result<Settings> {
    let mut settings=resolve(db,settings)?;
    persist(db,&settings,id)?;
    settings.api_key.clear();
    Ok(settings)
}
pub fn restore(db:&Database,id:&str)->Result<Settings> {
    let mut value=serde_json::to_value(read(db)?)?;
    let snapshot=db.extension(&format!("v4:conversationConnection:{id}"))?;
    if let Some(snapshot)=snapshot.as_object(){for field in FIELDS{if let Some(item)=snapshot.get(*field){value[*field]=item.clone()}}}
    value["contextMode"]=json!("full");value["recentTurns"]=json!(10);
    let context=db.extension(&format!("v6:context:{id}"))?;
    if let Some(context)=context.as_object(){for(key,item)in context{if matches!(key.as_str(),"contextMode"|"recentTurns"|"selectedMessageIds"|"selectedAttachmentIds"){value[key]=item.clone()}}}
    let mut settings:Settings=serde_json::from_value(value)?;
    if !settings.profile_id.is_empty() && !db.profiles()?.iter().any(|p|p.id==settings.profile_id) {
        // History remains readable after deleting a Profile; do not route to another key.
        settings.profile_id.clear();settings.base_url.clear();settings.model.clear();settings.request_options=Value::Null;
        settings.search_mode="off".into();settings.web_search=false;
    }
    save(db,settings,Some(id))
}

pub struct ConnectionGuard(Arc<AtomicBool>);
impl Drop for ConnectionGuard {fn drop(&mut self){self.0.store(false,Ordering::Release)}}
pub fn lock_if_changed(before:&Settings,after:&Settings,generating:&Arc<AtomicBool>)->Result<Option<ConnectionGuard>> {
    if selection(before)==selection(after) && after.api_key.trim().is_empty(){return Ok(None)}
    generating.compare_exchange(false,true,Ordering::AcqRel,Ordering::Acquire).map_err(|_|anyhow!("回答正在生成，请先停止或等待完成后应用配置"))?;
    Ok(Some(ConnectionGuard(generating.clone())))
}

pub fn prepare_history(mut history:Vec<crate::database::Message>,origins:&Value,target:&Settings)->Vec<crate::database::Message> {
    for message in &mut history {
        if let Some(origin)=message.usage_id.as_ref().and_then(|id|origins.get(id)) {
            if origin["provider"].as_str()!=Some(&target.provider) || origin["model"].as_str()!=Some(&target.model){message.reasoning_content.clear()}
        }
    }
    history.retain(|m|!m.content.trim().is_empty() || !m.attachments.is_empty());
    history
}
