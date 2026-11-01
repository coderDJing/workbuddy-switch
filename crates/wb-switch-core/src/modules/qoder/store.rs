//! Qoder 账号包：整组凭据文件的字节副本 + `bundle.json` 元数据。
//!
//! 布局：`<store>/bundles/<id>/{bundle.json, <凭据存储名>…}`。副本是真实凭据的
//! 密文，受 DPAPI / 钥匙串绑定，只能在本机同一系统用户下复用，不参与 WebDAV 同步。
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::paths::{credentials, Criticality, QoderRoots, QoderTarget};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BundleFile {
    pub name: String,
    pub sha256: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BundleMeta {
    pub id: String,
    pub target: QoderTarget,
    pub label: String,
    /// 认领时从明文回显读到的名字（仅桌面端有）。
    #[serde(default)]
    pub echo_name: Option<String>,
    pub captured_at: i64,
    #[serde(default)]
    pub last_switched_at: Option<i64>,
    pub files: Vec<BundleFile>,
}

impl BundleMeta {
    /// 主凭据哈希：识别「现场是哪个账号包」的依据。
    pub fn primary_sha(&self) -> Option<&str> {
        self.files.first().map(|f| f.sha256.as_str())
    }
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

pub fn default_store() -> PathBuf {
    crate::modules::config::store_dir().join("qoder")
}

fn bundles_dir(store: &Path) -> PathBuf {
    store.join("bundles")
}

/// 账号包目录。id 只允许 uuid 字符，防止前端传入的 id 拼出库外路径。
pub(crate) fn bundle_dir(store: &Path, id: &str) -> Result<PathBuf, String> {
    let ok = !id.is_empty()
        && id.len() <= 64
        && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
    if !ok {
        return Err(format!("无效的账号包 id: {id}"));
    }
    Ok(bundles_dir(store).join(id))
}

fn write_meta(store: &Path, meta: &BundleMeta) -> Result<(), String> {
    let dir = bundle_dir(store, &meta.id)?;
    let json = serde_json::to_string_pretty(meta).map_err(|e| e.to_string())?;
    crate::modules::config::atomic_write(&dir.join("bundle.json"), &json)
        .map_err(|e| format!("写入账号包元数据失败: {e}"))
}

pub fn load(store: &Path, id: &str) -> Result<BundleMeta, String> {
    let path = bundle_dir(store, id)?.join("bundle.json");
    let raw = std::fs::read_to_string(&path).map_err(|_| format!("账号包不存在: {id}"))?;
    serde_json::from_str(&raw).map_err(|e| format!("账号包元数据损坏（{id}）: {e}"))
}

/// 列出账号包；元数据损坏的条目跳过（不让一个坏包拖垮整页）。
pub fn list(store: &Path, target: Option<QoderTarget>) -> Vec<BundleMeta> {
    let Ok(entries) = std::fs::read_dir(bundles_dir(store)) else {
        return Vec::new();
    };
    let mut out: Vec<BundleMeta> = entries
        .flatten()
        .filter_map(|e| load(store, &e.file_name().to_string_lossy()).ok())
        .filter(|m| target.is_none_or(|t| m.target == t))
        .collect();
    out.sort_by_key(|m| m.captured_at);
    out
}

/// 读明文回显里的账号名。只在 `logged_in` 为 true 时采信。
pub fn read_echo_name(roots: &QoderRoots) -> Option<String> {
    let raw = std::fs::read_to_string(roots.status_echo()).ok()?;
    let v: serde_json::Value = serde_json::from_str(&raw).ok()?;
    if v.get("logged_in").and_then(|x| x.as_bool()) != Some(true) {
        return None;
    }
    v.get("name")
        .and_then(|x| x.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// 现场主凭据的哈希；文件不存在 = 未登录。
pub fn live_primary_sha(roots: &QoderRoots, target: QoderTarget) -> Option<String> {
    let spec = credentials(roots, target).into_iter().next()?;
    std::fs::read(&spec.path).ok().map(|b| sha256_hex(&b))
}

/// 现场对应的账号包 id（按主凭据哈希匹配）。
pub fn current_id(store: &Path, roots: &QoderRoots, target: QoderTarget) -> Option<String> {
    let live = live_primary_sha(roots, target)?;
    list(store, Some(target))
        .into_iter()
        .find(|m| m.primary_sha() == Some(live.as_str()))
        .map(|m| m.id)
}

/// 认领现场登录态为账号包。
///
/// 去重：主凭据哈希相同的包直接刷新；桌面端回显名相同且现场哈希无包匹配时，
/// 视为同一账号的登录态已刷新，覆盖旧包而不是再存一份。
pub fn capture(
    store: &Path,
    roots: &QoderRoots,
    target: QoderTarget,
    label: Option<&str>,
) -> Result<BundleMeta, String> {
    let specs = credentials(roots, target);
    let mut payload: Vec<(String, Vec<u8>)> = Vec::new();
    for spec in &specs {
        match std::fs::read(&spec.path) {
            Ok(bytes) => payload.push((spec.name.to_string(), bytes)),
            Err(_) if spec.criticality == Criticality::Required => {
                return Err(format!(
                    "{} 当前未登录（缺少 {}），请先在 {} 中登录后再认领",
                    target.label(),
                    spec.name,
                    target.label()
                ));
            }
            Err(_) => {}
        }
    }
    let echo_name = match target {
        QoderTarget::Desktop => read_echo_name(roots),
        QoderTarget::Cli => None,
    };
    let primary = sha256_hex(&payload[0].1);
    let existing = list(store, Some(target));
    let reuse = existing
        .iter()
        .find(|m| m.primary_sha() == Some(primary.as_str()))
        .or_else(|| {
            let name = echo_name.as_deref()?;
            existing.iter().find(|m| m.echo_name.as_deref() == Some(name))
        })
        .cloned();

    let id = reuse
        .as_ref()
        .map(|m| m.id.clone())
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let dir = bundle_dir(store, &id)?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建账号包目录失败: {e}"))?;
    // 旧包里本次现场已不存在的文件要清掉，否则切换时会写回过期的成组文件。
    for spec in &specs {
        if !payload.iter().any(|(n, _)| n == spec.name) {
            let _ = std::fs::remove_file(dir.join(spec.name));
        }
    }
    let mut files = Vec::new();
    for (name, bytes) in &payload {
        std::fs::write(dir.join(name), bytes).map_err(|e| format!("保存凭据副本失败: {e}"))?;
        files.push(BundleFile {
            name: name.clone(),
            sha256: sha256_hex(bytes),
            size: bytes.len() as u64,
        });
    }

    let fallback_label = || {
        echo_name.clone().unwrap_or_else(|| {
            let n = existing.len() + usize::from(reuse.is_none());
            format!("{} 账号 {n}", target.label())
        })
    };
    let label = label
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .or_else(|| reuse.as_ref().map(|m| m.label.clone()))
        .unwrap_or_else(fallback_label);
    let meta = BundleMeta {
        id,
        target,
        label,
        echo_name,
        captured_at: reuse.as_ref().map_or_else(now_ms, |m| m.captured_at),
        last_switched_at: reuse.and_then(|m| m.last_switched_at),
        files,
    };
    write_meta(store, &meta)?;
    Ok(meta)
}

pub fn rename(store: &Path, id: &str, label: &str) -> Result<BundleMeta, String> {
    let label = label.trim();
    if label.is_empty() {
        return Err("名称不能为空".to_string());
    }
    let mut meta = load(store, id)?;
    meta.label = label.to_string();
    write_meta(store, &meta)?;
    Ok(meta)
}

pub fn delete(store: &Path, id: &str) -> Result<(), String> {
    let dir = bundle_dir(store, id)?;
    if !dir.join("bundle.json").exists() {
        return Err(format!("账号包不存在: {id}"));
    }
    std::fs::remove_dir_all(&dir).map_err(|e| format!("删除账号包失败: {e}"))
}

pub(crate) fn mark_switched(store: &Path, id: &str) -> Result<(), String> {
    let mut meta = load(store, id)?;
    meta.last_switched_at = Some(now_ms());
    write_meta(store, &meta)
}
