use std::cell::{Cell, RefCell};
use std::path::{Path, PathBuf};
use std::time::Duration;

use super::paths::{QoderRoots, QoderTarget};
use super::proc::QoderProcessOps;
use super::store;
use super::switch::{execute, SwitchOptions};

struct Sandbox {
    root: PathBuf,
    roots: QoderRoots,
    store: PathBuf,
}

impl Drop for Sandbox {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

fn sandbox() -> Sandbox {
    let root =
        std::env::temp_dir().join(format!("wb-qoder-test-{}", uuid::Uuid::new_v4().simple()));
    let roots = QoderRoots {
        home: root.join("home"),
        app_data: root.join("appdata"),
    };
    Sandbox {
        store: root.join("store"),
        roots,
        root,
    }
}

fn put(path: &Path, bytes: &[u8]) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, bytes).unwrap();
}

/// 造一份桌面端登录态。`overlay` 为 None 时不写成组文件。
fn login_desktop(sb: &Sandbox, auth: &[u8], name: &str, overlay: Option<&[u8]>) {
    let dir = sb.roots.desktop_dir();
    put(&dir.join("auth.v1.dat"), auth);
    put(&dir.join("Local State"), b"{\"os_crypt\":{}}");
    put(&dir.join("auth.machine-id"), b"device");
    let overlay_path = dir.join("auth-profile-overlays.v1.dat");
    match overlay {
        Some(b) => put(&overlay_path, b),
        None => {
            let _ = std::fs::remove_file(&overlay_path);
        }
    }
    let echo = format!("{{\"logged_in\":true,\"name\":\"{name}\"}}");
    put(&sb.roots.status_echo(), echo.as_bytes());
}

fn read(path: &Path) -> Vec<u8> {
    std::fs::read(path).unwrap()
}

#[derive(Default)]
struct FakeOps {
    running: Cell<bool>,
    hosted: bool,
    closed: Cell<u32>,
    launched: RefCell<Vec<Option<PathBuf>>>,
}

impl QoderProcessOps for FakeOps {
    fn running_pids(&self, _: QoderTarget) -> Vec<u32> {
        if self.running.get() {
            vec![42]
        } else {
            Vec::new()
        }
    }
    fn running_exe(&self, _: QoderTarget) -> Option<PathBuf> {
        self.running.get().then(|| PathBuf::from("Qoder CN.exe"))
    }
    fn close(&self, _: QoderTarget, _: Duration) -> Result<(), String> {
        self.closed.set(self.closed.get() + 1);
        self.running.set(false);
        Ok(())
    }
    fn launch(&self, _: QoderTarget, exe: Option<PathBuf>) -> Result<(), String> {
        self.launched.borrow_mut().push(exe);
        Ok(())
    }
    fn hosted_by(&self, _: QoderTarget) -> bool {
        self.hosted
    }
}

const OPEN: SwitchOptions = SwitchOptions {
    close_running: true,
    relaunch: true,
};

fn no_progress(_: &str) {}

#[test]
fn capture_requires_login() {
    let sb = sandbox();
    let err = store::capture(&sb.store, &sb.roots, QoderTarget::Desktop, None).unwrap_err();
    assert!(err.contains("未登录"), "{err}");
}

#[test]
fn four_targets_have_separate_paths_and_saved_accounts() {
    let sb = sandbox();
    let targets = [
        QoderTarget::Desktop,
        QoderTarget::Cli,
        QoderTarget::GlobalDesktop,
        QoderTarget::GlobalCli,
    ];
    let mut primary_paths = Vec::new();
    for target in targets {
        let specs = super::paths::credentials(&sb.roots, target);
        for spec in &specs {
            if spec.criticality == super::paths::Criticality::Required {
                put(&spec.path, b"same-login-bytes");
            }
        }
        if !target.is_desktop() {
            put(
                &sb.roots
                    .cli_dir_for(target)
                    .join(".auth")
                    .join("machine_id"),
                b"machine",
            );
        }
        primary_paths.push(specs[0].path.clone());
        store::capture(&sb.store, &sb.roots, target, None).unwrap();
    }
    let unique: std::collections::HashSet<_> = primary_paths.iter().collect();
    assert_eq!(unique.len(), 4);
    assert_eq!(
        store::list(&sb.store, None).len(),
        4,
        "相同密文也不能跨目标合并"
    );
    for target in targets {
        assert!(store::current_id(&sb.store, &sb.roots, target).is_some());
    }
}

#[test]
fn global_switch_does_not_touch_cn_credentials() {
    let sb = sandbox();
    let cn_specs = super::paths::credentials(&sb.roots, QoderTarget::Desktop);
    for spec in &cn_specs {
        if spec.criticality == super::paths::Criticality::Required {
            put(&spec.path, b"cn");
        }
    }
    let global_specs = super::paths::credentials(&sb.roots, QoderTarget::GlobalDesktop);
    for spec in &global_specs {
        if spec.criticality == super::paths::Criticality::Required {
            put(&spec.path, b"global-a");
        }
    }
    let a = store::capture(&sb.store, &sb.roots, QoderTarget::GlobalDesktop, None).unwrap();
    put(&global_specs[0].path, b"global-b");
    let ops = FakeOps::default();
    execute(&sb.store, &sb.roots, &ops, &a.id, OPEN, &no_progress).unwrap();
    assert_eq!(read(&global_specs[0].path), b"global-a");
    assert_eq!(read(&cn_specs[0].path), b"cn");
    assert_eq!(
        store::list(&sb.store, Some(QoderTarget::GlobalDesktop)).len(),
        2
    );
}

#[test]
fn empty_credentials_are_not_treated_as_a_login() {
    let sb = sandbox();
    let specs = super::paths::credentials(&sb.roots, QoderTarget::GlobalCli);
    put(&specs[0].path, b"");
    put(&specs[1].path, b"machine");
    assert!(store::live_primary_sha(&sb.roots, QoderTarget::GlobalCli).is_none());
    assert!(store::capture(&sb.store, &sb.roots, QoderTarget::GlobalCli, None).is_err());
}

#[test]
fn plaintext_cli_login_does_not_require_a_machine_key() {
    let sb = sandbox();
    let specs = super::paths::credentials(&sb.roots, QoderTarget::GlobalCli);
    put(&specs[0].path, br#"{"user":{"id":"test"}}"#);
    let a = store::capture(&sb.store, &sb.roots, QoderTarget::GlobalCli, None).unwrap();
    put(&specs[0].path, br#"{"user":{"id":"other"}}"#);
    execute(
        &sb.store,
        &sb.roots,
        &FakeOps::default(),
        &a.id,
        OPEN,
        &no_progress,
    )
    .unwrap();
    assert_eq!(read(&specs[0].path), br#"{"user":{"id":"test"}}"#);
}

#[test]
fn capture_labels_from_echo_and_dedups_by_hash() {
    let sb = sandbox();
    login_desktop(&sb, b"token-a", "Alice", None);
    let a = store::capture(&sb.store, &sb.roots, QoderTarget::Desktop, None).unwrap();
    assert_eq!(a.label, "Alice");
    let again = store::capture(&sb.store, &sb.roots, QoderTarget::Desktop, None).unwrap();
    assert_eq!(a.id, again.id);
    assert_eq!(store::list(&sb.store, None).len(), 1);
    assert_eq!(
        store::current_id(&sb.store, &sb.roots, QoderTarget::Desktop),
        Some(a.id)
    );
}

#[test]
fn capture_does_not_merge_distinct_credentials_with_same_echo_name() {
    let sb = sandbox();
    login_desktop(&sb, b"token-a1", "Alice", None);
    let first = store::capture(&sb.store, &sb.roots, QoderTarget::Desktop, Some("工作号")).unwrap();
    login_desktop(&sb, b"token-a2", "Alice", None);
    let second = store::capture(&sb.store, &sb.roots, QoderTarget::Desktop, None).unwrap();
    assert_ne!(first.id, second.id);
    assert_eq!(store::list(&sb.store, None).len(), 2);
    assert_eq!(store::load(&sb.store, &first.id).unwrap().label, "工作号");
    assert_eq!(
        second.primary_sha(),
        Some(store::sha256_hex(b"token-a2").as_str())
    );
}

#[test]
fn switch_stops_if_current_login_cannot_be_saved() {
    let sb = sandbox();
    let dir = sb.roots.cli_dir().join(".auth");
    put(&dir.join("user"), b"token-a");
    put(&dir.join("machine_id"), b"machine");
    let a = store::capture(&sb.store, &sb.roots, QoderTarget::Cli, None).unwrap();
    put(&dir.join("user"), b"token-b");
    std::fs::remove_file(dir.join("machine_id")).unwrap();
    let ops = FakeOps::default();
    let err = execute(&sb.store, &sb.roots, &ops, &a.id, OPEN, &no_progress).unwrap_err();
    assert!(err.contains("已取消切换"));
    assert_eq!(read(&dir.join("user")), b"token-b");
    assert_eq!(ops.closed.get(), 0);
}

#[test]
fn switch_writes_bundle_and_removes_unpaired_overlay() {
    let sb = sandbox();
    login_desktop(&sb, b"token-a", "Alice", None);
    let a = store::capture(&sb.store, &sb.roots, QoderTarget::Desktop, None).unwrap();
    login_desktop(&sb, b"token-b", "Bob", Some(b"overlay-b"));
    store::capture(&sb.store, &sb.roots, QoderTarget::Desktop, None).unwrap();

    let ops = FakeOps::default();
    let out = execute(&sb.store, &sb.roots, &ops, &a.id, OPEN, &no_progress).unwrap();
    assert_eq!(out["unchanged"], false);
    let dir = sb.roots.desktop_dir();
    assert_eq!(read(&dir.join("auth.v1.dat")), b"token-a");
    assert!(
        !dir.join("auth-profile-overlays.v1.dat").exists(),
        "A 没有成组文件，B 的那份要移除"
    );
    assert!(read(&sb.roots.status_echo())
        .windows(5)
        .any(|w| w == b"Alice"));
    assert_eq!(ops.closed.get(), 0, "目标没在运行，不应关闭");
    assert_eq!(
        store::current_id(&sb.store, &sb.roots, QoderTarget::Desktop),
        Some(a.id)
    );
}

#[test]
fn switch_auto_saves_unknown_live_login() {
    let sb = sandbox();
    login_desktop(&sb, b"token-a", "Alice", None);
    let a = store::capture(&sb.store, &sb.roots, QoderTarget::Desktop, None).unwrap();
    login_desktop(&sb, b"token-c", "Carol", None);

    let out = execute(
        &sb.store,
        &sb.roots,
        &FakeOps::default(),
        &a.id,
        OPEN,
        &no_progress,
    )
    .unwrap();
    let saved = out["autoSavedId"].as_str().expect("现场应被自动认领");
    assert_eq!(store::load(&sb.store, saved).unwrap().label, "Carol");
    assert_eq!(store::list(&sb.store, None).len(), 2);
}

#[test]
fn switch_to_current_is_noop() {
    let sb = sandbox();
    login_desktop(&sb, b"token-a", "Alice", None);
    let a = store::capture(&sb.store, &sb.roots, QoderTarget::Desktop, None).unwrap();
    let ops = FakeOps::default();
    ops.running.set(true);
    let out = execute(&sb.store, &sb.roots, &ops, &a.id, OPEN, &no_progress).unwrap();
    assert_eq!(out["unchanged"], true);
    assert_eq!(ops.closed.get(), 0);
}

#[test]
fn switch_closes_and_relaunches_running_desktop() {
    let sb = sandbox();
    login_desktop(&sb, b"token-a", "Alice", None);
    let a = store::capture(&sb.store, &sb.roots, QoderTarget::Desktop, None).unwrap();
    login_desktop(&sb, b"token-b", "Bob", None);
    store::capture(&sb.store, &sb.roots, QoderTarget::Desktop, None).unwrap();

    let ops = FakeOps::default();
    ops.running.set(true);
    let out = execute(&sb.store, &sb.roots, &ops, &a.id, OPEN, &no_progress).unwrap();
    assert_eq!(ops.closed.get(), 1);
    assert_eq!(
        *ops.launched.borrow(),
        vec![Some(PathBuf::from("Qoder CN.exe"))]
    );
    assert_eq!(out["relaunched"], true);
}

#[test]
fn switch_refuses_running_target_without_permission_or_when_hosted() {
    let sb = sandbox();
    login_desktop(&sb, b"token-a", "Alice", None);
    let a = store::capture(&sb.store, &sb.roots, QoderTarget::Desktop, None).unwrap();
    login_desktop(&sb, b"token-b", "Bob", None);
    store::capture(&sb.store, &sb.roots, QoderTarget::Desktop, None).unwrap();

    let ops = FakeOps::default();
    ops.running.set(true);
    let manual = SwitchOptions {
        close_running: false,
        relaunch: false,
    };
    let err = execute(&sb.store, &sb.roots, &ops, &a.id, manual, &no_progress).unwrap_err();
    assert!(err.contains("正在运行"), "{err}");

    let hosted = FakeOps {
        hosted: true,
        ..FakeOps::default()
    };
    hosted.running.set(true);
    let err = execute(&sb.store, &sb.roots, &hosted, &a.id, OPEN, &no_progress).unwrap_err();
    assert!(err.contains("托管"), "{err}");
    assert_eq!(hosted.closed.get(), 0);
    assert_eq!(
        read(&sb.roots.desktop_dir().join("auth.v1.dat")),
        b"token-b",
        "拒绝时现场不能被改"
    );
}

#[test]
fn switch_rejects_tampered_bundle_without_touching_live() {
    let sb = sandbox();
    login_desktop(&sb, b"token-a", "Alice", None);
    let a = store::capture(&sb.store, &sb.roots, QoderTarget::Desktop, None).unwrap();
    login_desktop(&sb, b"token-b", "Bob", None);
    put(
        &store::bundle_dir(&sb.store, &a.id)
            .unwrap()
            .join("auth.v1.dat"),
        b"tampered",
    );

    let err = execute(
        &sb.store,
        &sb.roots,
        &FakeOps::default(),
        &a.id,
        OPEN,
        &no_progress,
    )
    .unwrap_err();
    assert!(err.contains("校验失败"), "{err}");
    assert_eq!(
        read(&sb.roots.desktop_dir().join("auth.v1.dat")),
        b"token-b"
    );
}

#[test]
fn cli_switch_swaps_user_and_machine_id_as_a_pair() {
    let sb = sandbox();
    let auth = sb.roots.cli_dir().join(".auth");
    put(&auth.join("user"), b"cli-a");
    put(&auth.join("machine_id"), b"mid-a");
    let a = store::capture(&sb.store, &sb.roots, QoderTarget::Cli, Some("CLI A")).unwrap();
    put(&auth.join("user"), b"cli-b");
    put(&auth.join("machine_id"), b"mid-b");
    store::capture(&sb.store, &sb.roots, QoderTarget::Cli, Some("CLI B")).unwrap();

    let ops = FakeOps::default();
    ops.running.set(true);
    let out = execute(&sb.store, &sb.roots, &ops, &a.id, OPEN, &no_progress).unwrap();
    assert_eq!(read(&auth.join("user")), b"cli-a");
    assert_eq!(read(&auth.join("machine_id")), b"mid-a");
    assert!(ops.launched.borrow().is_empty(), "CLI 不自动重开");
    assert_eq!(out["warnings"].as_array().unwrap().len(), 1);
}

#[test]
fn bundle_ids_cannot_escape_store() {
    let sb = sandbox();
    assert!(store::delete(&sb.store, "../etc").is_err());
    assert!(store::load(&sb.store, "a/b").is_err());
}

#[test]
fn backups_are_pruned_per_target() {
    let sb = sandbox();
    login_desktop(&sb, b"token-a", "Alice", None);
    let a = store::capture(&sb.store, &sb.roots, QoderTarget::Desktop, None).unwrap();
    login_desktop(&sb, b"token-b", "Bob", None);
    let b = store::capture(&sb.store, &sb.roots, QoderTarget::Desktop, None).unwrap();
    let ops = FakeOps::default();
    for i in 0..12 {
        let id = if i % 2 == 0 { &a.id } else { &b.id };
        execute(&sb.store, &sb.roots, &ops, id, OPEN, &no_progress).unwrap();
        let count = std::fs::read_dir(sb.store.join("backups")).unwrap().count();
        assert_eq!(count, (i + 1).min(10), "each switch needs its own backup");
    }
    let count = std::fs::read_dir(sb.store.join("backups")).unwrap().count();
    assert_eq!(count, 10);
}
