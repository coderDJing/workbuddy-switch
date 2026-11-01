//! Qoder CN 桌面端与 Qoder CN CLI 的账号切换。
//!
//! Qoder 账号与 WorkBuddy / CodeBuddy 账号库互不相通：这里存的是「账号包」
//! （整组加密凭据文件的副本），不解密、不入 `accounts.json`、不参与 WebDAV 同步。
//! 思路与凭据布局参考 [JIUSHIQINGSHAN/qoder-switch](https://github.com/JIUSHIQINGSHAN/qoder-switch)（MIT）。
pub mod paths;
pub mod proc;
pub mod store;
pub mod switch;
#[cfg(test)]
mod tests;

use serde_json::{json, Value};

pub use paths::{QoderRoots, QoderTarget};
use proc::{QoderProcessOps, RealProcessOps};
pub use switch::SwitchOptions;

fn target_status(roots: &QoderRoots, target: QoderTarget) -> Value {
    let store = store::default_store();
    let installed = match target {
        QoderTarget::Desktop => roots.desktop_dir().is_dir(),
        QoderTarget::Cli => roots.cli_dir().is_dir(),
    };
    let current_id = store::current_id(&store, roots, target);
    let current_label = current_id
        .as_deref()
        .and_then(|id| store::load(&store, id).ok())
        .map(|m| m.label);
    json!({
        "target": target,
        "label": target.label(),
        "installed": installed,
        "loggedIn": store::live_primary_sha(roots, target).is_some(),
        "running": !RealProcessOps.running_pids(target).is_empty(),
        "currentId": current_id,
        "currentLabel": current_label,
        "echoName": match target {
            QoderTarget::Desktop => store::read_echo_name(roots),
            QoderTarget::Cli => None,
        },
    })
}

/// GET 状态：两个目标的现场情况 + 全部账号包元数据（不含任何凭据内容）。
pub fn status() -> Value {
    let roots = QoderRoots::real();
    json!({
        "desktop": target_status(&roots, QoderTarget::Desktop),
        "cli": target_status(&roots, QoderTarget::Cli),
        "bundles": store::list(&store::default_store(), None),
    })
}

pub fn capture(target: QoderTarget, label: Option<&str>) -> Result<Value, String> {
    let meta = store::capture(&store::default_store(), &QoderRoots::real(), target, label)?;
    serde_json::to_value(meta).map_err(|e| e.to_string())
}

pub fn rename(id: &str, label: &str) -> Result<Value, String> {
    let meta = store::rename(&store::default_store(), id, label)?;
    serde_json::to_value(meta).map_err(|e| e.to_string())
}

pub fn delete(id: &str) -> Result<(), String> {
    store::delete(&store::default_store(), id)
}

pub fn switch_to(id: &str, opts: SwitchOptions, progress: &dyn Fn(&str)) -> Result<Value, String> {
    let ops: &dyn QoderProcessOps = &RealProcessOps;
    switch::execute(&store::default_store(), &QoderRoots::real(), ops, id, opts, progress)
}
