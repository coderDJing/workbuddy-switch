//! Qoder 进程探测 / 关闭 / 启动。抽成 trait，切换流程的测试用假实现，不碰真进程。
use std::path::PathBuf;
use std::time::Duration;

#[allow(unused_imports)]
use crate::modules::process::{self, run_cmd_timeout};

use super::paths::{process_images, QoderRoots, QoderTarget};

pub trait QoderProcessOps {
    fn running_pids(&self, target: QoderTarget) -> Vec<u32>;
    /// 运行中实例的可执行文件路径（重开时优先用它，而不是猜安装位置）。
    fn running_exe(&self, target: QoderTarget) -> Option<PathBuf>;
    fn close(&self, target: QoderTarget, timeout: Duration) -> Result<(), String>;
    fn launch(&self, target: QoderTarget, exe: Option<PathBuf>) -> Result<(), String>;
    /// 本进程是否运行在该目标托管的会话里（例如从 Qoder 内置终端启动）。
    /// 是的话关闭目标会连自己一起结束，必须拒绝。
    fn hosted_by(&self, target: QoderTarget) -> bool;
}

pub struct RealProcessOps;

/// Qoder 给子进程注入的环境标记（qoder-switch 实测：`QODER_PRODUCT_ID`、
/// `QODERCN_CLI`、`QODERCN_SESSION_TYPE`）。按前缀判定，宁可多拒不可误杀。
fn env_marks_qoder_host() -> bool {
    std::env::vars_os().any(|(k, _)| {
        let k = k.to_string_lossy().to_ascii_uppercase();
        k.starts_with("QODER_") || k.starts_with("QODERCN_")
    })
}

#[cfg(target_os = "windows")]
fn windows_rows(target: QoderTarget) -> Vec<process::WindowsProcessRow> {
    let self_pid = std::process::id();
    process_images(target)
        .iter()
        .flat_map(|image| process::windows_tasklist_image_rows(image))
        .filter(|r| r.pid != self_pid)
        .collect()
}

#[cfg(target_os = "macos")]
fn macos_patterns(target: QoderTarget) -> Vec<String> {
    match target {
        QoderTarget::Desktop => vec!["Qoder CN.app/Contents/MacOS".to_string()],
        QoderTarget::Cli => vec!["/qoderclicn".to_string()],
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn linux_pids(target: QoderTarget) -> Vec<u32> {
    let self_pid = std::process::id();
    process_images(target)
        .iter()
        .filter_map(|image| run_cmd_timeout("pgrep", &["-x", image], 5))
        .flat_map(|out| {
            String::from_utf8_lossy(&out.stdout)
                .lines()
                .filter_map(|l| l.trim().parse::<u32>().ok())
                .collect::<Vec<_>>()
        })
        .filter(|pid| *pid != self_pid)
        .collect()
}

impl QoderProcessOps for RealProcessOps {
    fn running_pids(&self, target: QoderTarget) -> Vec<u32> {
        #[cfg(target_os = "windows")]
        {
            windows_rows(target).into_iter().map(|r| r.pid).collect()
        }
        #[cfg(target_os = "macos")]
        {
            process::macos_pids_by_patterns(&macos_patterns(target))
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            linux_pids(target)
        }
    }

    fn running_exe(&self, target: QoderTarget) -> Option<PathBuf> {
        #[cfg(target_os = "windows")]
        {
            let names = process_images(target)
                .iter()
                .map(|i| format!("'{}'", i.trim_end_matches(".exe")))
                .collect::<Vec<_>>()
                .join(",");
            let script = format!(
                "Get-Process -Name {names} -ErrorAction SilentlyContinue | \
                 ForEach-Object {{ $p = ''; try {{ $p = $_.Path }} catch {{}}; '{{0}}|{{1}}|{{2}}' -f $_.Id, $_.ProcessName, $p }}"
            );
            let stdout = process::ps_output(&script, 5)?;
            process::parse_windows_process_rows(&stdout)
                .into_iter()
                .filter_map(|r| r.exe_path)
                .find(|p| p.is_file())
        }
        #[cfg(target_os = "macos")]
        {
            process::macos_rows_by_patterns(&macos_patterns(target))
                .into_iter()
                .find_map(|(_, args)| process::extract_app_bundle_from_args(&args))
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            let _ = target;
            None
        }
    }

    fn close(&self, target: QoderTarget, timeout: Duration) -> Result<(), String> {
        let pids = self.running_pids(target);
        if pids.is_empty() {
            return Ok(());
        }
        let graceful = Duration::from_secs(8).min(timeout);
        #[cfg(target_os = "windows")]
        let leftover = {
            for pid in &pids {
                let _ = run_cmd_timeout("taskkill", &["/PID", &pid.to_string(), "/T"], 10);
            }
            let remaining = process::wait_windows_pids_gone(&pids, graceful);
            for pid in &remaining {
                let _ = run_cmd_timeout("taskkill", &["/PID", &pid.to_string(), "/T", "/F"], 10);
            }
            process::wait_windows_pids_gone(&remaining, timeout.saturating_sub(graceful))
        };
        #[cfg(not(target_os = "windows"))]
        let leftover = {
            let signal = |sig: &str, pids: &[u32]| {
                let mut args = vec![sig.to_string()];
                args.extend(pids.iter().map(u32::to_string));
                let refs: Vec<&str> = args.iter().map(String::as_str).collect();
                let _ = run_cmd_timeout("kill", &refs, 10);
            };
            let wait = |budget: Duration| {
                let deadline = std::time::Instant::now() + budget;
                loop {
                    let alive = self.running_pids(target);
                    if alive.is_empty() || std::time::Instant::now() >= deadline {
                        return alive;
                    }
                    std::thread::sleep(Duration::from_millis(500));
                }
            };
            signal("-TERM", &pids);
            let remaining = wait(graceful);
            if !remaining.is_empty() {
                signal("-9", &remaining);
            }
            wait(timeout.saturating_sub(graceful).max(Duration::from_secs(1)))
        };
        if leftover.is_empty() {
            Ok(())
        } else {
            Err(format!(
                "{} 无法完全关闭（残留进程: {:?}），请手动退出后重试",
                target.label(),
                leftover
            ))
        }
    }

    fn launch(&self, target: QoderTarget, exe: Option<PathBuf>) -> Result<(), String> {
        if target == QoderTarget::Cli {
            return Err("Qoder CN CLI 不支持自动重开，请在终端中重新运行".to_string());
        }
        let exe = exe
            .or_else(|| super::paths::desktop_default_exe(&QoderRoots::real()))
            .ok_or_else(|| "未找到 Qoder CN 程序，请手动打开 Qoder CN".to_string())?;
        let mut cmd = if cfg!(target_os = "macos") {
            let mut c = process::cmd_builder("open");
            c.arg("-a").arg(&exe);
            c
        } else {
            process::cmd_builder(&exe)
        };
        cmd.stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("启动 Qoder CN 失败: {e}（路径: {}）", exe.display()))
    }

    fn hosted_by(&self, _target: QoderTarget) -> bool {
        env_marks_qoder_host()
    }
}
