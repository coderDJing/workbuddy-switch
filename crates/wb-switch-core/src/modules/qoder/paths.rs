//! Qoder CN 的凭据文件布局（2026-11 在 Windows 本机核对）。
//!
//! 新版 Qoder CN 桌面端是独立 Electron 应用（不再是 VS Code 分支，没有
//! `state.vscdb`），登录态由 safeStorage 加密：
//! - 桌面端：`<userData>/auth.v1.dat`（magic `v10`），主密钥在同目录 `Local State`
//!   的 `os_crypt.encrypted_key`（Windows 为 DPAPI，macOS 在登录钥匙串）。
//! - CLI：`~/.qoder-cn/.auth/user`（base64 密文），密钥派生自同目录 `machine_id`。
//!
//! 本模块不解密任何凭据：账号包就是整组文件的字节副本，切换时整组写回。
//! 布局参考 JIUSHIQINGSHAN/qoder-switch（MIT）的 `variant.rs`。
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

/// 切换目标。桌面端与 CLI 登录态相互独立（CLI 有自己的 `.auth/user`），分开切换。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum QoderTarget {
    Desktop,
    Cli,
}

impl QoderTarget {
    pub fn label(self) -> &'static str {
        match self {
            Self::Desktop => "Qoder CN",
            Self::Cli => "Qoder CN CLI",
        }
    }

    pub fn parse(raw: &str) -> Option<Self> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "desktop" => Some(Self::Desktop),
            "cli" => Some(Self::Cli),
            _ => None,
        }
    }
}

/// 凭据文件在切换中的地位。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Criticality {
    /// 认领与切换都必须有；缺了就拒绝，绝不做半换号。
    Required,
    /// 与登录态成组：账号包里有就写回，没有就删掉现场那份（先备份）。
    Paired,
    /// 设备级文件：账号包里有才写回，没有时保留现场。
    Optional,
}

#[derive(Debug, Clone)]
pub struct CredentialSpec {
    /// 账号包里的存储名，同时是现场文件名。
    pub name: &'static str,
    pub path: PathBuf,
    pub criticality: Criticality,
}

/// 可注入的根目录：生产取真实目录，测试指向临时沙箱。
#[derive(Debug, Clone)]
pub struct QoderRoots {
    pub home: PathBuf,
    /// Electron userData 的父目录（Windows `%APPDATA%`，macOS
    /// `~/Library/Application Support`，Linux `~/.config`）。
    pub app_data: PathBuf,
}

const DESKTOP_DATA_DIR: &str = "com.qodercn.app.stable";
const CLI_HOME_DIR: &str = ".qoder-cn";

impl QoderRoots {
    pub fn real() -> Self {
        let home = crate::modules::config::home_dir();
        let app_data = if cfg!(target_os = "macos") {
            home.join("Library").join("Application Support")
        } else {
            dirs::config_dir().unwrap_or_else(|| home.join(".config"))
        };
        Self { home, app_data }
    }

    pub fn desktop_dir(&self) -> PathBuf {
        self.app_data.join(DESKTOP_DATA_DIR)
    }

    pub fn cli_dir(&self) -> PathBuf {
        self.home.join(CLI_HOME_DIR)
    }

    /// 桌面端写下的明文登录回显（`name` / `logged_in`），账号标签的零解密来源。
    pub fn status_echo(&self) -> PathBuf {
        self.cli_dir().join(".qoder-app-status.json")
    }
}

/// 目标的凭据清单。第一项是主凭据：它的哈希用来识别「当前是哪个账号包」。
pub fn credentials(roots: &QoderRoots, target: QoderTarget) -> Vec<CredentialSpec> {
    let spec = |name, path, criticality| CredentialSpec {
        name,
        path,
        criticality,
    };
    match target {
        QoderTarget::Desktop => {
            let dir = roots.desktop_dir();
            // macOS 的主密钥在钥匙串里，Local State 只有 uninstall_metrics。
            let local_state = if cfg!(target_os = "macos") {
                Criticality::Optional
            } else {
                Criticality::Required
            };
            vec![
                spec("auth.v1.dat", dir.join("auth.v1.dat"), Criticality::Required),
                spec("Local State", dir.join("Local State"), local_state),
                spec(
                    "auth-profile-overlays.v1.dat",
                    dir.join("auth-profile-overlays.v1.dat"),
                    Criticality::Paired,
                ),
                spec("auth.machine-id", dir.join("auth.machine-id"), Criticality::Optional),
                spec(
                    "channel-activation.v1.json",
                    dir.join("channel-activation.v1.json"),
                    Criticality::Optional,
                ),
                // 回显随账号走，否则换号后界面仍显示上一个账号的名字。
                spec(".qoder-app-status.json", roots.status_echo(), Criticality::Paired),
            ]
        }
        QoderTarget::Cli => {
            let auth = roots.cli_dir().join(".auth");
            vec![
                spec("user", auth.join("user"), Criticality::Required),
                // CLI 凭据的解密密钥，必须与 user 成组。
                spec("machine_id", auth.join("machine_id"), Criticality::Required),
            ]
        }
    }
}

/// 进程映像名（不含路径）。
pub fn process_images(target: QoderTarget) -> &'static [&'static str] {
    match target {
        QoderTarget::Desktop => {
            if cfg!(target_os = "windows") {
                &["Qoder CN.exe"]
            } else {
                &["Qoder CN"]
            }
        }
        QoderTarget::Cli => {
            if cfg!(target_os = "windows") {
                &["qoderclicn.exe"]
            } else {
                &["qoderclicn"]
            }
        }
    }
}

/// 桌面端的默认安装位置，供「切换后重新打开」使用。
pub fn desktop_default_exe(roots: &QoderRoots) -> Option<PathBuf> {
    let candidates: Vec<PathBuf> = if cfg!(target_os = "windows") {
        dirs::data_local_dir()
            .map(|d| vec![d.join("Programs").join("Qoder CN").join("Qoder CN.exe")])
            .unwrap_or_default()
    } else if cfg!(target_os = "macos") {
        vec![
            PathBuf::from("/Applications/Qoder CN.app"),
            roots.home.join("Applications").join("Qoder CN.app"),
        ]
    } else {
        Vec::new()
    };
    candidates.into_iter().find(|p| p.exists())
}
