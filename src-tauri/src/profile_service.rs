use crate::{
    database::{ApiProfile, Database},
    provider::ProviderAdapter,
};
use anyhow::{anyhow, ensure, Result};

pub trait Secrets {
    fn read(&self, id: &str) -> Result<Option<String>>;
    fn write(&self, id: &str, key: &str) -> Result<()>;
    fn remove(&self, id: &str) -> Result<()>;
}
pub struct KeyringSecrets;
impl Secrets for KeyringSecrets {
    fn read(&self, id: &str) -> Result<Option<String>> {
        match entry(id)?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(anyhow!("无法读取系统密钥存储：{error}")),
        }
    }
    fn write(&self, id: &str, key: &str) -> Result<()> {
        entry(id)?
            .set_password(key)
            .map_err(|e| anyhow!("无法保存 API Key：{e}"))
    }
    fn remove(&self, id: &str) -> Result<()> {
        match entry(id)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(anyhow!("无法删除系统密钥：{error}")),
        }
    }
}
fn entry(id: &str) -> Result<keyring::Entry> {
    Ok(keyring::Entry::new("ClaudeChat", &format!("profile:{id}"))?)
}

pub fn normalize(mut profile: ApiProfile) -> Result<ApiProfile> {
    profile.id = profile.id.trim().into();
    profile.name = profile.name.trim().into();
    profile.base_url = profile.base_url.trim().trim_end_matches('/').into();
    profile.model = profile.model.trim().into();
    ensure!(!profile.id.is_empty(), "配置 ID 不能为空");
    let adapter = ProviderAdapter::new(&profile.provider)?;
    if profile
        .request_options
        .as_object()
        .is_some_and(|options| options.is_empty())
    {
        profile.request_options = serde_json::Value::Null;
    }
    adapter.configure_options(&mut serde_json::json!({}), &profile.request_options)?;
    let url = reqwest::Url::parse(&profile.base_url)
        .map_err(|_| anyhow!("请输入完整 API 地址，例如 https://api.example.com/v1"))?;
    ensure!(
        matches!(url.scheme(), "https" | "http") && url.host_str().is_some(),
        "API 地址必须使用 HTTP 或 HTTPS"
    );
    ensure!(
        url.username().is_empty()
            && url.password().is_none()
            && url.query().is_none()
            && url.fragment().is_none(),
        "请使用不含用户名、密码或查询参数的 API 地址，密钥请填入 API Key"
    );
    if profile.name.is_empty() {
        profile.name = url.host_str().unwrap_or("API").into();
    }
    ensure!(
        matches!(profile.thinking.as_str(), "off" | "low" | "medium" | "high"),
        "思考强度无效"
    );
    ensure!(
        profile.input_price.is_finite()
            && profile.output_price.is_finite()
            && profile.input_price >= 0.0
            && profile.output_price >= 0.0,
        "价格必须是大于等于 0 的数字"
    );
    Ok(profile)
}

// SQLite and Credential Manager cannot share a transaction. Restore the old
// credential if the database commit fails; do not report partial success.
pub fn save(
    db: &Database,
    secrets: &impl Secrets,
    profile: ApiProfile,
    key: &str,
) -> Result<ApiProfile> {
    let mut profile = normalize(profile)?;
    let previous = secrets.read(&profile.id)?;
    let changed = !key.trim().is_empty();
    if changed {
        secrets.write(&profile.id, key.trim())?;
    }
    if let Err(error) = db.save_profile_with_credentials(&profile, changed) {
        if changed {
            restore(secrets, &profile.id, previous.as_deref())
                .map_err(|_| anyhow!("配置保存失败，且密钥恢复失败，请重新填写此配置的 API Key"))?;
        }
        return Err(error);
    }
    profile.has_key = changed || previous.as_ref().is_some_and(|key| !key.trim().is_empty());
    Ok(profile)
}
pub fn delete(db: &Database, secrets: &impl Secrets, id: &str) -> Result<()> {
    let previous = secrets.read(id)?;
    secrets.remove(id)?;
    if let Err(error) = db.delete_profile(id) {
        restore(secrets, id, previous.as_deref())
            .map_err(|_| anyhow!("删除失败，且密钥恢复失败，请重新填写此配置的 API Key"))?;
        return Err(error);
    }
    Ok(())
}
fn restore(secrets: &impl Secrets, id: &str, previous: Option<&str>) -> Result<()> {
    match previous {
        Some(key) => secrets.write(id, key),
        None => secrets.remove(id),
    }
}
