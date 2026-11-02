//! Qoder 账号切换：校验 → 关闭目标 → 整组备份 → 写回 → 读回比对 → 失败整组回滚。
//! 流程与安全规则参考 JIUSHIQINGSHAN/qoder-switch（MIT）的 `switch.rs` / `bundle.rs`。
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};

use super::paths::{credentials, CredentialSpec, Criticality, QoderRoots, QoderTarget};
use super::proc::QoderProcessOps;
use super::store::{self, sha256_hex, BundleMeta};

#[derive(Debug, Clone, Copy)]
pub struct SwitchOptions {
    /// 目标正在运行时是否由本工具关闭。false 时遇到运行中的目标直接拒绝。
    pub close_running: bool,
    /// 切换前桌面端在运行时，写完后是否重新打开（CLI 无此能力）。
    pub relaunch: bool,
}

const CLOSE_TIMEOUT: Duration = Duration::from_secs(20);
/// 短暂的锁竞争等待结束后再切换，持续占锁时仍拒绝并发操作。
const SWITCH_LOCK_TIMEOUT: Duration = Duration::from_secs(2);
/// 已完结的备份保留份数（每个目标各自计）。
const KEEP_BACKUPS: usize = 10;

#[derive(Debug, Serialize, serde::Deserialize)]
struct RestoreItem {
    name: String,
    path: PathBuf,
    existed: bool,
}

fn backups_dir(store: &Path) -> PathBuf {
    store.join("backups")
}

/// 把现场整组凭据备份进新目录；清单先于任何写入落盘。
fn backup_live(
    store: &Path,
    target: QoderTarget,
    specs: &[CredentialSpec],
) -> Result<PathBuf, String> {
    let stamp = chrono::Utc::now().format("%Y%m%dT%H%M%S%9f");
    // Fast successive switches can share a clock tick; never reuse a backup directory.
    let dir = backups_dir(store).join(format!(
        "{}-{stamp}-{}",
        target_slug(target),
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(backups_dir(store))
        .and_then(|_| std::fs::create_dir(&dir))
        .map_err(|e| format!("创建备份目录失败: {e}"))?;
    let mut items = Vec::new();
    for spec in specs {
        let existed = match std::fs::read(&spec.path) {
            Ok(bytes) => {
                std::fs::write(dir.join(spec.name), bytes)
                    .map_err(|e| format!("备份 {} 失败: {e}", spec.name))?;
                true
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => false,
            Err(e) => return Err(format!("备份 {} 失败: {e}", spec.name)),
        };
        items.push(RestoreItem {
            name: spec.name.to_string(),
            path: spec.path.clone(),
            existed,
        });
    }
    let manifest = serde_json::to_string_pretty(&items).map_err(|e| e.to_string())?;
    crate::modules::config::atomic_write(&dir.join("_restore.json"), &manifest)
        .map_err(|e| format!("写入备份清单失败: {e}"))?;
    Ok(dir)
}

/// 按备份清单退回现场。尽力而为：逐项执行，返回失败项。
fn restore_backup(dir: &Path) -> Vec<String> {
    let Ok(raw) = std::fs::read_to_string(dir.join("_restore.json")) else {
        return vec!["备份清单缺失".to_string()];
    };
    let Ok(items) = serde_json::from_str::<Vec<RestoreItem>>(&raw) else {
        return vec!["备份清单损坏".to_string()];
    };
    let mut failed = Vec::new();
    for item in items {
        let result = if item.existed {
            std::fs::read(dir.join(&item.name)).and_then(|b| write_bytes_atomic(&item.path, &b))
        } else {
            remove_if_exists(&item.path)
        };
        if let Err(e) = result {
            failed.push(format!("{}: {e}", item.name));
        }
    }
    failed
}

fn target_slug(target: QoderTarget) -> &'static str {
    match target {
        QoderTarget::Desktop => "desktop",
        QoderTarget::Cli => "cli",
        QoderTarget::GlobalDesktop => "global-desktop",
        QoderTarget::GlobalCli => "global-cli",
    }
}

fn prune_backups(store: &Path, target: QoderTarget) {
    let prefix = format!("{}-", target_slug(target));
    let Ok(entries) = std::fs::read_dir(backups_dir(store)) else {
        return;
    };
    let mut dirs: Vec<PathBuf> = entries
        .flatten()
        .filter(|e| e.file_name().to_string_lossy().starts_with(&prefix))
        .map(|e| e.path())
        .collect();
    dirs.sort();
    let excess = dirs.len().saturating_sub(KEEP_BACKUPS);
    for dir in dirs.into_iter().take(excess) {
        let _ = std::fs::remove_dir_all(dir);
    }
}

fn write_bytes_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let tmp = path.with_file_name(format!("{name}.tmp-{}", uuid::Uuid::new_v4().simple()));
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, path).inspect_err(|_| {
        let _ = std::fs::remove_file(&tmp);
    })
}

fn remove_if_exists(path: &Path) -> std::io::Result<()> {
    match std::fs::remove_file(path) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e),
        _ => Ok(()),
    }
}

/// 读出账号包里的全部文件并核对哈希；任何一份不符就拒绝（包已损坏或被改动）。
fn load_payload(store: &Path, meta: &BundleMeta) -> Result<Vec<(String, Vec<u8>)>, String> {
    let dir = store::bundle_dir(store, &meta.id)?;
    meta.files
        .iter()
        .map(|f| {
            let bytes = std::fs::read(dir.join(&f.name))
                .map_err(|_| format!("账号包缺少文件 {}，请重新认领该账号", f.name))?;
            if sha256_hex(&bytes) != f.sha256 {
                return Err(format!("账号包文件 {} 校验失败，请重新认领该账号", f.name));
            }
            Ok((f.name.clone(), bytes))
        })
        .collect()
}

/// 执行切换。`progress` 收到人话步骤，供 UI 显示。
pub fn execute(
    store: &Path,
    roots: &QoderRoots,
    ops: &dyn QoderProcessOps,
    bundle_id: &str,
    opts: SwitchOptions,
    progress: &dyn Fn(&str),
) -> Result<Value, String> {
    let meta = store::load(store, bundle_id)?;
    let target = meta.target;
    let specs = credentials(roots, target);
    // 账号包只能包含此目标的已知文件，不接受路径或重复项目。
    let mut names = std::collections::HashSet::new();
    if meta
        .files
        .iter()
        .any(|f| !specs.iter().any(|s| s.name == f.name) || !names.insert(&f.name))
    {
        return Err("账号包包含未知或重复文件，拒绝切换".to_string());
    }
    let payload = load_payload(store, &meta)?;
    store::validate_cli_payload(target, &payload)?;
    for spec in specs
        .iter()
        .filter(|s| s.criticality == Criticality::Required)
    {
        if !payload.iter().any(|(n, _)| n == spec.name) {
            return Err(format!(
                "账号包缺少必需文件 {}，拒绝半换号，请重新认领该账号",
                spec.name
            ));
        }
    }

    let _lock = crate::modules::state_lock::StateLock::wait_at(
        &store.join("switch.lock"),
        SWITCH_LOCK_TIMEOUT,
    )
    .map_err(|e| e.to_string())?;

    // 现场登录态还没存成账号包时先认领，避免切走后再也回不去。
    let mut warnings: Vec<String> = Vec::new();
    let mut auto_saved: Option<BundleMeta> = None;
    if store::live_primary_sha(roots, target).is_some()
        && store::current_id(store, roots, target).is_none()
    {
        progress("保存当前登录态…");
        auto_saved = Some(
            store::capture(store, roots, target, None)
                .map_err(|e| format!("当前登录态未能自动保存，已取消切换: {e}"))?,
        );
    }
    if store::current_id(store, roots, target).as_deref() == Some(meta.id.as_str()) {
        return Ok(json!({
            "ok": true, "target": target, "accountId": meta.id, "unchanged": true,
            "message": format!("{} 已是该账号", target.label()),
        }));
    }

    let was_running = !ops.running_pids(target).is_empty();
    let running_exe = if was_running {
        ops.running_exe(target)
    } else {
        None
    };
    if was_running {
        if ops.hosted_by(target) {
            return Err(format!(
                "当前运行在 {0} 托管的会话中，关闭 {0} 会结束本工具自身。请先手动退出 {0} 后重试",
                target.label()
            ));
        }
        if !opts.close_running {
            return Err(format!("{0} 正在运行，请先退出 {0} 后重试", target.label()));
        }
        progress(&format!("正在关闭 {}…", target.label()));
        ops.close(target, CLOSE_TIMEOUT)?;
    }

    progress("备份当前凭据…");
    let backup = backup_live(store, target, &specs)?;

    progress("写入目标账号凭据…");
    let applied = apply(&specs, &payload);
    if let Err(reason) = applied {
        let failed = restore_backup(&backup);
        let tail = if failed.is_empty() {
            "已回滚到切换前状态".to_string()
        } else {
            format!(
                "回滚未完全成功（{}），备份在 {}",
                failed.join("；"),
                backup.display()
            )
        };
        return Err(format!("切换失败：{reason}，{tail}"));
    }
    let _ = store::mark_switched(store, &meta.id);
    prune_backups(store, target);

    let mut relaunched = false;
    if was_running && opts.relaunch && target.is_desktop() {
        progress(&format!("重新打开 {}…", target.label()));
        match ops.launch(target, running_exe) {
            Ok(()) => relaunched = true,
            Err(e) => warnings.push(e),
        }
    }
    if was_running && !target.is_desktop() {
        warnings.push(format!(
            "已关闭运行中的 {}，请在终端中重新运行",
            target.label()
        ));
    }
    progress("切换完成");
    Ok(json!({
        "ok": true,
        "target": target,
        "accountId": meta.id,
        "label": meta.label,
        "unchanged": false,
        "closed": was_running,
        "relaunched": relaunched,
        "autoSavedId": auto_saved.map(|m| m.id),
        "warnings": warnings,
    }))
}

/// 写回整组凭据并逐份读回比对；任何一步失败返回原因，由调用方回滚。
fn apply(specs: &[CredentialSpec], payload: &[(String, Vec<u8>)]) -> Result<(), String> {
    for spec in specs {
        let incoming = payload.iter().find(|(n, _)| n == spec.name).map(|(_, b)| b);
        match (incoming, spec.criticality) {
            (Some(bytes), _) => {
                write_bytes_atomic(&spec.path, bytes)
                    .map_err(|e| format!("写入 {} 失败: {e}", spec.name))?;
                let back = std::fs::read(&spec.path)
                    .map_err(|e| format!("读回 {} 失败: {e}", spec.name))?;
                if sha256_hex(&back) != sha256_hex(bytes) {
                    return Err(format!("{} 写入后校验不一致", spec.name));
                }
            }
            (None, Criticality::Paired) => {
                remove_if_exists(&spec.path)
                    .map_err(|e| format!("移除 {} 失败: {e}", spec.name))?;
            }
            (None, _) => {}
        }
    }
    Ok(())
}
