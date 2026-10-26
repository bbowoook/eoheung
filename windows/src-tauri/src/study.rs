// 어흥이's study board — exams, timetable, assignments and notices — and the
// Telegram bot that brings group notices in and sends reminders out.
//
// The board is one JSON document the pages own (src/study/model.ts says what is in
// it); Rust only keeps it in study.json next to settings.json, hands it out, and
// tells every window when it changed. The bot token lives in the credential
// store under "telegram-bot-token" and never leaves Rust: the pages ask for
// updates and send messages through the commands below.

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use crate::secrets;

pub const TELEGRAM_KEY: &str = "telegram-bot-token";
const FILE: &str = "study.json";
/// A board bigger than this is refused: years of notices fit in far less.
const MAX_BYTES: usize = 4 * 1024 * 1024;

/// What a fresh install starts with (filled from what the user told us).
const SEED: &str = include_str!("../study-seed.json");

static LOCK: Mutex<()> = Mutex::new(());

fn path() -> PathBuf {
    crate::settings::config_dir().join(FILE)
}

fn seed() -> Value {
    serde_json::from_str(SEED).unwrap_or_else(|_| json!({}))
}

fn load() -> Value {
    match std::fs::read(path()) {
        Ok(bytes) => serde_json::from_slice::<Value>(&bytes)
            .ok()
            .filter(Value::is_object)
            .unwrap_or_else(seed),
        Err(_) => seed(),
    }
}

fn save(value: &Value) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?;
    if bytes.len() > MAX_BYTES {
        return Err("저장할 내용이 너무 커요.".into());
    }
    let dir = crate::settings::config_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let tmp = dir.join(format!("{FILE}.tmp"));
    std::fs::write(&tmp, &bytes).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn study_get() -> Value {
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    load()
}

/// Replaces the board and tells every window, the one that sent it included.
#[tauri::command]
pub fn study_set(app: AppHandle, data: Value) -> Result<(), String> {
    if !data.is_object() {
        return Err("잘못된 데이터예요.".into());
    }
    {
        let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
        save(&data)?;
    }
    let _ = app.emit("study", &data);
    Ok(())
}

// ── Telegram ────────────────────────────────────────────────────────────────

fn token() -> Result<String, String> {
    secrets::get(TELEGRAM_KEY).ok_or_else(|| "텔레그램 봇 토큰이 없어요.".to_string())
}

/// One Bot API call. The token is in the path, so it is never written to the log.
async fn call(method: &str, body: Value, timeout: Duration) -> Result<Value, String> {
    let token = token()?;
    let url = format!("https://api.telegram.org/bot{token}/{method}");
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(timeout)
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|_| "텔레그램에 연결하지 못했어요. 인터넷을 확인해 줘.".to_string())?;
    let status = response.status();
    let bytes = crate::net::read_capped(response, 2 * 1024 * 1024).await?;
    let value: Value = serde_json::from_slice(&bytes).map_err(|_| "텔레그램 응답을 읽지 못했어요.".to_string())?;
    if value.get("ok").and_then(Value::as_bool) == Some(true) {
        return Ok(value.get("result").cloned().unwrap_or(Value::Null));
    }
    let detail = value
        .get("description")
        .and_then(Value::as_str)
        .unwrap_or("")
        .chars()
        .take(160)
        .collect::<String>();
    Err(match status.as_u16() {
        401 | 404 => "봇 토큰이 맞지 않아요. BotFather가 준 토큰을 다시 확인해 줘.".into(),
        409 => "다른 프로그램이 같은 봇을 쓰고 있어요(웹훅이 켜져 있어요).".into(),
        _ => format!("텔레그램 오류: {detail}"),
    })
}

/// Who the bot is: `{ username, name }`. Used to check a token right after it is saved.
#[tauri::command]
pub async fn telegram_check() -> Result<Value, String> {
    let me = call("getMe", json!({}), Duration::from_secs(15)).await?;
    Ok(json!({
        "username": me.get("username").cloned().unwrap_or(Value::Null),
        "name": me.get("first_name").cloned().unwrap_or(Value::Null),
    }))
}

/// New updates after `offset` (the last update id + 1), without waiting: the
/// island asks every half minute while the bot is on.
#[tauri::command]
pub async fn telegram_updates(offset: i64) -> Result<Value, String> {
    call(
        "getUpdates",
        json!({
            "offset": offset,
            "timeout": 0,
            "limit": 100,
            "allowed_updates": ["message", "channel_post", "edited_channel_post", "my_chat_member"],
        }),
        Duration::from_secs(20),
    )
    .await
}

/// Sends `text` to `chat_id` (the user's own chat with the bot).
#[tauri::command]
pub async fn telegram_send(chat_id: i64, text: String) -> Result<(), String> {
    let text: String = text.chars().take(4000).collect();
    call(
        "sendMessage",
        json!({ "chat_id": chat_id, "text": text, "disable_web_page_preview": true }),
        Duration::from_secs(20),
    )
    .await
    .map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_seed_is_a_board() {
        let v = seed();
        assert!(v.is_object());
        assert!(v.get("exams").map(Value::is_array).unwrap_or(false));
    }
}
