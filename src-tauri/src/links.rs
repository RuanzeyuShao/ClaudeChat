use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

pub fn http_url(value: &str) -> Result<reqwest::Url, String> {
    let url=reqwest::Url::parse(value.trim()).map_err(|_|"链接地址无效".to_string())?;
    if !matches!(url.scheme(),"https"|"http") || url.host_str().is_none() || !url.username().is_empty() || url.password().is_some() {
        return Err("仅支持不含登录凭据的 HTTP 或 HTTPS 链接".into());
    }
    Ok(url)
}
pub fn trusted_app_view(label: &str, url: &reqwest::Url) -> bool {
    label=="main" && ((url.scheme()=="tauri" && url.host_str()==Some("localhost"))
        || (matches!(url.scheme(),"http"|"https") && url.host_str()==Some("tauri.localhost"))
        || (url.scheme()=="http" && matches!(url.host_str(),Some("localhost"|"127.0.0.1")) && url.port()==Some(1420)))
}
#[tauri::command]
pub async fn open_link_preview(app: tauri::AppHandle, url: String) -> Result<(),String> {
    let url=http_url(&url)?;
    if let Some(window)=app.get_webview_window("link-preview") {
        window.navigate(url).map_err(|e|e.to_string())?;
        window.set_focus().map_err(|e|e.to_string())?;
        return Ok(());
    }
    let back=tauri::menu::MenuItem::with_id(&app,"link-return-chat","返回聊天",true,Some("Esc")).map_err(|e|e.to_string())?;
    let browser=tauri::menu::MenuItem::with_id(&app,"link-open-browser","在系统浏览器打开",true,None::<&str>).map_err(|e|e.to_string())?;
    let menu=tauri::menu::Menu::with_items(&app,&[&back,&browser]).map_err(|e|e.to_string())?;
    let window=WebviewWindowBuilder::new(&app,"link-preview",WebviewUrl::External(url))
        .title("网页预览 · 返回聊天请点击顶部菜单")
        .inner_size(1080.0,760.0).min_inner_size(560.0,420.0)
        .menu(menu)
        .on_navigation(|url|http_url(url.as_str()).is_ok())
        .on_menu_event(|window,event|{
            match event.id().as_ref() {
                "link-return-chat"=>{let _=window.close();if let Some(main)=window.app_handle().get_webview_window("main"){let _=main.set_focus();}},
                "link-open-browser"=>{if let Some(view)=window.app_handle().get_webview_window("link-preview"){if let Ok(url)=view.url(){if http_url(url.as_str()).is_ok(){let _=window.app_handle().opener().open_url(url.as_str(),None::<&str>);}}}},
                _=>{}
            }
        }).build().map_err(|e|e.to_string())?;
    let handle=app.clone();
    window.on_window_event(move |event|{if matches!(event,tauri::WindowEvent::Destroyed){if let Some(main)=handle.get_webview_window("main"){let _=main.set_focus();}}});
    Ok(())
}
#[cfg(test)] mod tests {
    use super::*;
    #[test] fn accepts_only_web_links(){for bad in ["javascript:alert(1)","file:///C:/Users/x","data:text/html,test","https://user:secret@example.com"]{assert!(http_url(bad).is_err());}assert!(http_url("https://commons.wikimedia.org/wiki/File:X.jpg").is_ok());}
    #[test] fn remote_preview_never_has_application_ipc_access(){assert!(trusted_app_view("main",&http_url("http://tauri.localhost/").unwrap()));assert!(trusted_app_view("main",&http_url("http://localhost:1420/").unwrap()));assert!(!trusted_app_view("main",&http_url("https://example.com").unwrap()));assert!(!trusted_app_view("link-preview",&http_url("http://tauri.localhost/").unwrap()));}
}
