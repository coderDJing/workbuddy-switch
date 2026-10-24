//! Targeted repair using the existing official QR authorization flow.
//! New credentials stay in an isolated candidate store until verified. No
//! client processes are closed, and healthy accounts cannot be overwritten.
use serde_json::json;
use wb_switch_core::modules::{account, config, oauth, refresh, variant::WbVariant};

async fn verify(candidate: &serde_json::Value) -> Result<(), String> {
    let response = config::http_request(
        "https://www.workbuddy.cn/v2/activity/growth/profile",
        "GET",
        None,
        Some(&account::build_auth_headers(candidate)),
    )
    .await;
    if response["code"] != 0 || !response["data"].is_object() {
        return Err("新登录的业务接口验证失败，未替换原账号".into());
    }
    Ok(())
}

async fn run() -> Result<(), String> {
    let id = std::env::args()
        .nth(1)
        .ok_or("请指定一个失效账号的本地 ID")?;
    let expected = account::find_account(&id).ok_or("账号不存在")?;
    if expected["needs_relogin"] != true || account::variant_of(&expected) != WbVariant::Cn {
        return Err("仅支持明确失效的国内版账号；正常账号未操作".into());
    }
    let original_home = std::env::var_os(config::HOME_ENV_VAR);
    let candidate_home = config::store_dir()
        .join("repair-candidates")
        .join(uuid::Uuid::new_v4().to_string());
    std::env::set_var(config::HOME_ENV_VAR, &candidate_home);
    let attempt: Result<serde_json::Value, String> = async {
        let start = oauth::oauth_start(WbVariant::Cn).await.map_err(|_| "申请扫码授权失败")?;
        println!("{}",json!({"stage":"awaiting_qr","verificationUri":start["verificationUri"],"expiresIn":start["expiresIn"]}));
        let login_id = start["loginId"].as_str().ok_or("授权响应缺少 ID")?;
        for _ in 0..300 {
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            let result = oauth::oauth_poll(login_id).await;
            if result["done"] != true { continue; }
            if !result["error"].is_null() { return Err("扫码授权失败或已过期".into()); }
            let candidate_id = result["result"]["id"].as_str().ok_or("授权缺少账号信息")?;
            let candidate = account::find_account(candidate_id).ok_or("授权凭据尚未保存")?;
            if candidate["uid"] != expected["uid"] { return Err("扫码选错账号；原账号库未改动".into()); }
            verify(&candidate).await?;
            let candidate = refresh::refresh_account_token(candidate).await;
            if candidate["needs_relogin"] == true || refresh::refresh_failure(&candidate).is_some() {
                return Err("新登录的续期验证失败，原账号库未改动".into());
            }
            verify(&candidate).await?;
            return Ok(candidate);
        }
        Err("扫码等待超时，原账号库未改动".into())
    }.await;
    match original_home {
        Some(home) => std::env::set_var(config::HOME_ENV_VAR, home),
        None => std::env::remove_var(config::HOME_ENV_VAR),
    }
    let candidate = attempt?;
    account::commit_qr_repair(&expected, candidate)?;
    println!(
        "{}",
        json!({"stage":"repaired","businessVerified":true,"refreshVerified":true,"otherAccountsChanged":false})
    );
    Ok(())
}

fn main() -> std::process::ExitCode {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("runtime");
    match runtime.block_on(run()) {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("{error}");
            std::process::ExitCode::FAILURE
        }
    }
}
