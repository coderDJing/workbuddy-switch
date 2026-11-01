//! 自动更新：检查公开 GitHub Releases 版本 + 更新源配置。
//!
//! 对照 server.py `load_github_config` / `save_github_config` /
//! `compare_versions` / `update_check`。下载安装走 tauri-plugin-updater（整包更新）。
//!
//! 版本检查不走 GitHub API（避免 60 次/小时/IP 限流）：
//! 1. 主端点：release 资产的 updater manifest（下载不计 API 配额）；
//! 2. 兜底端点：`/releases/latest` 的 302 `Location` 头解析 tag；
//! 3. 成功结果进程级缓存 6 小时，缓存命中不发网络请求。

use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Instant;

use crate::modules::rc_diagnostics;

use crate::modules::config::{
    atomic_write, http_request_raw, http_request_with_proxy, now_secs, store_dir,
};

/// 应用当前版本（来自 Cargo.toml package.version）。
pub const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
pub const GITHUB_OWNER: &str = "coderDJing";
pub const GITHUB_REPO: &str = "workbuddy-switch-next";
pub const UPDATE_CHANNEL: &str = "preview";

/// 成功结果缓存有效期（6 小时）。自动轮询（30 分钟）命中缓存，不发网络请求；
/// 设置页手动检查传 force=true 绕过缓存强制刷新。
const CACHE_TTL_SECS: i64 = 6 * 60 * 60;

/// 进程级内存缓存，只缓存 ok=true 的结果；失败不写缓存。
struct CachedCheck {
    checked_at: i64,
    value: Value,
}

static CACHE: Mutex<Option<CachedCheck>> = Mutex::new(None);

pub fn github_config_file() -> PathBuf {
    store_dir().join("github_config_next.json")
}

/// 读取更新源配置（兼容旧配置文件，但永不返回 token）。
pub fn load_github_config() -> Value {
    load_github_config_from(
        &github_config_file(),
        &store_dir().join("github_config.json"),
    )
}

fn load_github_config_from(f: &std::path::Path, legacy: &std::path::Path) -> Value {
    // Import the old source/proxy once, writing only Next's separate config.
    // The original application's configuration and shared account store stay intact.
    let source = if f.exists() { f } else { legacy };
    let value = std::fs::read_to_string(source)
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok());
    let normalized = normalize_github_config(value.as_ref().unwrap_or(&Value::Null));
    if value.is_some() && (source != f || value.as_ref() != Some(&normalized)) {
        let _ = atomic_write(
            f,
            &serde_json::to_string_pretty(&normalized).unwrap_or_default(),
        );
    }
    normalized
}

fn normalize_github_config(value: &Value) -> Value {
    let field = |key: &str| {
        value
            .get(key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|v| !v.is_empty())
    };
    let mut owner = field("owner").unwrap_or(GITHUB_OWNER);
    let mut repo = field("repo").unwrap_or(GITHUB_REPO);
    if (owner == "changexbc" && matches!(repo, "workbuddy-switch" | "wb-switch"))
        || (owner.eq_ignore_ascii_case(GITHUB_OWNER) && repo == "workbuddy-switch")
    {
        owner = GITHUB_OWNER;
        repo = GITHUB_REPO;
    }
    json!({"owner": owner, "repo": repo, "proxy": field("proxy").unwrap_or("")})
}

pub fn release_page_url(owner: &str, repo: &str) -> String {
    if UPDATE_CHANNEL == "preview" {
        format!("https://github.com/{owner}/{repo}/releases/tag/preview")
    } else {
        format!("https://github.com/{owner}/{repo}/releases/latest")
    }
}

fn release_download_base(owner: &str, repo: &str) -> String {
    if UPDATE_CHANNEL == "preview" {
        format!("https://github.com/{owner}/{repo}/releases/download/preview")
    } else {
        format!("https://github.com/{owner}/{repo}/releases/latest/download")
    }
}

/// 保存更新源配置；公开仓库不需要也不保存 GitHub token。
pub fn save_github_config(cfg: &Value) -> std::io::Result<()> {
    let clean = normalize_github_config(cfg);
    std::fs::create_dir_all(store_dir())?;
    atomic_write(
        &github_config_file(),
        &serde_json::to_string_pretty(&clean).unwrap_or_default(),
    )?;
    *CACHE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = None;
    Ok(())
}

fn parse_version(value: &str) -> Result<semver::Version, semver::Error> {
    let value = value.trim().trim_start_matches('v');
    let components = value.split('.').count();
    let normalized = if components < 3 && value.chars().all(|c| c.is_ascii_digit() || c == '.') {
        format!("{value}{}", ".0".repeat(3 - components))
    } else {
        value.to_string()
    };
    semver::Version::parse(&normalized)
}

/// 版本比较：a > b 返回 1，a < b 返回 -1，相等返回 0。
pub fn compare_versions(a: &str, b: &str) -> i64 {
    let (Ok(a), Ok(b)) = (parse_version(a), parse_version(b)) else {
        return 0;
    };
    match a.cmp_precedence(&b) {
        std::cmp::Ordering::Less => -1,
        std::cmp::Ordering::Equal => 0,
        std::cmp::Ordering::Greater => 1,
    }
}

/// updater manifest 候选 URL（按优先级）。
///
/// 1. 合并后的 `latest.json`（含各平台）；
/// 2. 当前系统的 `latest-<os>-<arch>.json`；
/// 3. 兼容旧 Windows 安装包：它们仍请求 `latest-macos-<arch>.json`。
pub fn updater_manifest_urls(owner: &str, repo: &str, os: &str, arch: &str) -> Vec<String> {
    let os_slug = match os {
        "macos" | "darwin" => "macos",
        other => other,
    };
    let base = release_download_base(owner, repo);
    let mut urls = vec![format!("{base}/latest.json")];
    urls.push(format!("{base}/latest-{os_slug}-{arch}.json"));
    if os_slug != "macos" {
        urls.push(format!("{base}/latest-macos-{arch}.json"));
    }
    urls.dedup();
    urls
}

/// 主端点：拉取 updater manifest。成功返回解析后的 JSON（含 version / pub_date），
/// 失败返回可读错误信息。
async fn fetch_manifest_version(
    owner: &str,
    repo: &str,
    proxy: Option<&str>,
) -> Result<Value, String> {
    let mut headers = HashMap::new();
    headers.insert("Accept".to_string(), "application/json".to_string());
    headers.insert("User-Agent".to_string(), "wb-switch".to_string());
    let mut last_err = "更新清单解析失败".to_string();
    for (index, url) in
        updater_manifest_urls(owner, repo, std::env::consts::OS, std::env::consts::ARCH)
            .into_iter()
            .enumerate()
    {
        let started = Instant::now();
        rc_diagnostics::record(
            "update_http",
            "manifest_started",
            json!({"attempt": index + 1, "explicitProxy": proxy.is_some_and(|p| !p.trim().is_empty())}),
        );
        let resp = http_request_with_proxy(&url, "GET", None, Some(&headers), proxy).await;
        let version = resp.get("version").and_then(|v| v.as_str()).unwrap_or("");
        rc_diagnostics::record(
            "update_http",
            "manifest_finished",
            json!({"attempt": index + 1, "validVersion": parse_version(version).is_ok(), "code": resp.get("code").and_then(Value::as_i64), "elapsedMs": started.elapsed().as_millis()}),
        );
        if parse_version(version).is_ok() {
            return Ok(resp);
        }
        last_err = resp
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("更新清单解析失败")
            .to_string();
    }
    Err(last_err)
}

/// 兜底端点：请求 `/releases/latest`，读 302 `Location` 头（形如
/// `.../releases/tag/v0.1.13`）解析 tag。不跟随重定向，避免拉到 HTML 页面。
/// 成功返回 tag，失败返回可读错误 + code（状态码或 -1）。
async fn fetch_latest_tag(
    owner: &str,
    repo: &str,
    proxy: Option<&str>,
) -> Result<String, (String, i64)> {
    let url = format!("https://github.com/{owner}/{repo}/releases/latest");
    let mut headers = HashMap::new();
    headers.insert("Accept".to_string(), "text/html".to_string());
    headers.insert("User-Agent".to_string(), "wb-switch".to_string());
    let (status, resp_headers, body) =
        http_request_raw(&url, "GET", None, Some(&headers), proxy, false).await;

    if status == 0 {
        let msg = if body.trim().is_empty() {
            "网络请求失败".to_string()
        } else {
            body
        };
        return Err((msg, -1));
    }
    if status == 404 {
        // 无正式 release 或仓库不存在。
        return Err(("未找到可用的发布版本".to_string(), 404));
    }
    let location = resp_headers
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case("location"))
        .map(|(_, v)| v.clone());
    let location = match location {
        Some(location) => location,
        None => {
            return Err((
                format!("无法获取发布页跳转地址（HTTP {status}）"),
                status as i64,
            ))
        }
    };
    let tag = location.rsplit('/').next().unwrap_or("").trim().to_string();
    if tag.is_empty() || !location.contains("/releases/tag/") {
        return Err(("无法解析发布版本标签".to_string(), -1));
    }
    Ok(tag)
}

/// 查询最新 Release，与本地版本对比。对照 server.py `update_check`。
///
/// `force=true` 绕过缓存强制刷新（设置页手动检查）；否则 6 小时内成功结果直接返回，
/// 不发网络请求。主端点 manifest 失败时自动走 302 兜底；两个端点都失败返回可读错误。
pub async fn update_check(proxy: Option<&str>, force: bool) -> Value {
    rc_diagnostics::record("update_core", "check_started", json!({"force": force}));
    if !force {
        if let Some(cached) = CACHE.lock().unwrap().as_ref() {
            if now_secs() - cached.checked_at < CACHE_TTL_SECS {
                rc_diagnostics::record("update_core", "cache_hit", json!({}));
                return cached.value.clone();
            }
        }
    }

    let cfg = load_github_config();
    rc_diagnostics::record(
        "update_core",
        "config_loaded",
        json!({"channel": UPDATE_CHANNEL}),
    );
    let owner = cfg
        .get("owner")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let repo = cfg
        .get("repo")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let configured_proxy = cfg
        .get("proxy")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|v| !v.is_empty());
    let proxy = proxy.or(configured_proxy);
    let release_url = release_page_url(&owner, &repo);
    let current = APP_VERSION.to_string();

    // 主端点：updater manifest（release 资产下载，不计 GitHub API 配额）。
    if let Ok(manifest) = fetch_manifest_version(&owner, &repo, proxy).await {
        let version = manifest
            .get("version")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        let latest = version.strip_prefix('v').unwrap_or(version).to_string();
        let tag = format!("v{latest}");
        let release_name = manifest
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or(&tag)
            .to_string();
        let published_at = manifest
            .get("pub_date")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let value = json!({
            "ok": true,
            "current": current,
            "latest": latest,
            "latestTag": tag,
            "hasUpdate": compare_versions(&latest, &current) > 0,
            "releaseName": release_name,
            "releaseUrl": release_url,
            "publishedAt": published_at,
            "checkedAt": now_secs(),
        });
        *CACHE.lock().unwrap() = Some(CachedCheck {
            checked_at: now_secs(),
            value: value.clone(),
        });
        return value;
    }

    // 兜底端点：`/releases/latest` 的 302 Location 头解析 tag（仅 manifest 失败时）。
    // GitHub /latest excludes prereleases. Preview builds use their signed
    // preview feed and must never fall back to an unrelated stable release.
    if UPDATE_CHANNEL == "preview" {
        return json!({"ok": false, "error": "预览版更新源暂不可用", "message": "预览版更新源暂不可用，请稍后重试或打开发布页", "releaseUrl": release_url});
    }
    match fetch_latest_tag(&owner, &repo, proxy).await {
        Ok(tag) => {
            let latest = tag.strip_prefix('v').unwrap_or(&tag).to_string();
            let value = json!({
                "ok": true,
                "current": current,
                "latest": latest,
                "latestTag": tag,
                "hasUpdate": compare_versions(&latest, &current) > 0,
                "releaseName": tag.clone(),
                "releaseUrl": release_url,
                "checkedAt": now_secs(),
            });
            *CACHE.lock().unwrap() = Some(CachedCheck {
                checked_at: now_secs(),
                value: value.clone(),
            });
            value
        }
        Err((msg, code)) => json!({
            "ok": false,
            "error": msg,
            "message": format!("{msg}（code={code}）"),
            "releaseUrl": release_url,
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn updater_manifest_urls_macos_skips_duplicate_fallback() {
        let urls = updater_manifest_urls("coderDJing", "workbuddy-switch-next", "macos", "aarch64");
        assert_eq!(
            urls,
            vec![
                "https://github.com/coderDJing/workbuddy-switch-next/releases/download/preview/latest.json",
                "https://github.com/coderDJing/workbuddy-switch-next/releases/download/preview/latest-macos-aarch64.json",
            ]
        );
    }

    #[test]
    fn updater_manifest_urls_windows_keeps_macos_compat() {
        let urls =
            updater_manifest_urls("coderDJing", "workbuddy-switch-next", "windows", "x86_64");
        assert_eq!(
            urls,
            vec![
                "https://github.com/coderDJing/workbuddy-switch-next/releases/download/preview/latest.json",
                "https://github.com/coderDJing/workbuddy-switch-next/releases/download/preview/latest-windows-x86_64.json",
                "https://github.com/coderDJing/workbuddy-switch-next/releases/download/preview/latest-macos-x86_64.json",
            ]
        );
    }

    #[test]
    fn compare_versions_orders_semver() {
        assert_eq!(compare_versions("0.1.18", "0.1.18"), 0);
        assert_eq!(compare_versions("0.1.19", "0.1.18"), 1);
        assert_eq!(compare_versions("v0.1.17", "0.1.18"), -1);
    }

    #[test]
    fn preview_versions_follow_semver_precedence() {
        assert_eq!(compare_versions("0.2.0-beta.10", "0.2.0-beta.2"), 1);
        assert_eq!(compare_versions("0.2.0", "0.2.0-beta.10"), 1);
        assert_eq!(compare_versions("0.2.0-beta.1", "0.2.0"), -1);
        assert_eq!(compare_versions("0.2.0+build2", "0.2.0+build1"), 0);
        assert_eq!(compare_versions("not-a-version", "0.2.0"), 0);
        assert_eq!(compare_versions("0.1", "0.1.0"), 0);
    }

    #[test]
    fn importing_the_old_source_preserves_original_config_and_accounts() {
        let root = std::env::temp_dir().join(format!("wb-next-update-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let legacy = root.join("github_config.json");
        let next = root.join("github_config_next.json");
        let accounts = root.join("accounts.json");
        let original = r#"{"owner":"changexbc","repo":"workbuddy-switch","proxy":" http://localhost:7890 ","token":"fixture"}"#;
        std::fs::write(&legacy, original).unwrap();
        std::fs::write(&accounts, "fixture account bytes").unwrap();
        let loaded = load_github_config_from(&next, &legacy);
        assert_eq!(
            loaded,
            json!({"owner":GITHUB_OWNER,"repo":GITHUB_REPO,"proxy":"http://localhost:7890"})
        );
        assert_eq!(std::fs::read_to_string(&legacy).unwrap(), original);
        assert_eq!(
            std::fs::read_to_string(&accounts).unwrap(),
            "fixture account bytes"
        );
        std::fs::write(
            &next,
            r#"{"owner":"custom","repo":"private-feed","proxy":""}"#,
        )
        .unwrap();
        assert_eq!(load_github_config_from(&next, &legacy)["owner"], "custom");
        assert_eq!(std::fs::read_to_string(&legacy).unwrap(), original);
        std::fs::remove_dir_all(root).unwrap();
    }
}
