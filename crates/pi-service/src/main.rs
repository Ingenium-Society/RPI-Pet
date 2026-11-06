use std::{sync::Arc, time::Duration};

use axum::{
    extract::State,
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

// Mirrors [limits] in config/pi-service.toml (which is not read by code yet).
const MAX_INPUT_CHARS: usize = 200;
const N_PREDICT: u32 = 32;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(12);
/// Cap on the optional mood text from the game, to protect the small context window.
const MAX_STYLE_HINT_CHARS: usize = 200;

// TODO: move to data/prompts/prefix.{id,en}.txt once those are written.
const SYSTEM_PROMPT: &str = "You are a small, friendly virtual pet. \
Answer in one or two short sentences, in the same language the person uses.";

#[derive(Clone)]
struct AppState {
    client: reqwest::Client,
    /// Base URL of llama-server, e.g. http://127.0.0.1:8081. None = mock replies.
    llama_url: Option<Arc<str>>,
}

#[derive(Deserialize)]
struct ChatRequest {
    message: String,
    /// Optional extra system-prompt text from the game (mood: tired, cheerful, ...).
    #[serde(default)]
    style_hint: String,
}

#[derive(Serialize)]
struct ChatResponse {
    reply: String,
    /// "llama" when the model answered, "mock" when no model is configured.
    source: &'static str,
}

type ApiError = (StatusCode, Json<Value>);

fn api_error(status: StatusCode, msg: impl Into<String>) -> ApiError {
    (status, Json(json!({ "error": msg.into() })))
}

async fn health(State(st): State<AppState>) -> Json<Value> {
    // TODO: tok/s, queue depth, free RAM, CPU temp, throttle flags, llama-server status
    Json(json!({
        "status": "ok",
        "service": "pi-service",
        "version": env!("CARGO_PKG_VERSION"),
        "llama_configured": st.llama_url.is_some(),
    }))
}

async fn chat(
    State(st): State<AppState>,
    Json(req): Json<ChatRequest>,
) -> Result<Json<ChatResponse>, ApiError> {
    let message = req.message.trim();
    if message.is_empty() {
        return Err(api_error(StatusCode::BAD_REQUEST, "message is empty"));
    }
    if message.chars().count() > MAX_INPUT_CHARS {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            format!("message is longer than {MAX_INPUT_CHARS} characters"),
        ));
    }

    let Some(base) = st.llama_url.as_deref() else {
        return Ok(Json(ChatResponse {
            reply: mock_reply(message),
            source: "mock",
        }));
    };

    let system = build_system_prompt(&req.style_hint);
    let reply = ask_llama(&st.client, base, &system, message).await.map_err(|e| {
        tracing::warn!("llama-server request failed: {e}");
        api_error(StatusCode::BAD_GATEWAY, "the pet's brain did not answer")
    })?;
    Ok(Json(ChatResponse {
        reply,
        source: "llama",
    }))
}

/// Base prompt plus the game's mood hint (trimmed and length-capped), if any.
fn build_system_prompt(style_hint: &str) -> String {
    let hint: String = style_hint.trim().chars().take(MAX_STYLE_HINT_CHARS).collect();
    if hint.is_empty() {
        SYSTEM_PROMPT.to_string()
    } else {
        format!("{SYSTEM_PROMPT} {hint}")
    }
}

fn mock_reply(message: &str) -> String {
    format!("(mock pet) I heard you say: {message}")
}

async fn ask_llama(
    client: &reqwest::Client,
    base: &str,
    system: &str,
    message: &str,
) -> Result<String, String> {
    let body = json!({
        "messages": [
            { "role": "system", "content": system },
            { "role": "user", "content": message },
        ],
        "max_tokens": N_PREDICT,
        "temperature": 0.7,
        "stream": false,
    });
    let res = client
        .post(format!("{}/v1/chat/completions", base.trim_end_matches('/')))
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    let value: Value = res.json().await.map_err(|e| e.to_string())?;
    extract_reply(&value).ok_or_else(|| "unexpected response shape".to_string())
}

/// Pull `choices[0].message.content` out of an OpenAI-style response.
fn extract_reply(value: &Value) -> Option<String> {
    let text = value["choices"][0]["message"]["content"].as_str()?.trim();
    (!text.is_empty()).then(|| text.to_string())
}

fn app(state: AppState) -> Router {
    Router::new()
        .route("/v1/health", get(health))
        .route("/v1/chat", post(chat))
        .with_state(state)
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    // On the Pi: BIND=192.168.7.1:3000 (the USB link address). Locally the default is fine.
    let bind = std::env::var("BIND").unwrap_or_else(|_| "127.0.0.1:3000".into());
    // Set LLAMA_URL=http://127.0.0.1:8081 to use a running llama-server; unset = mock replies.
    let llama_url = std::env::var("LLAMA_URL")
        .ok()
        .filter(|s| !s.is_empty())
        .map(Arc::from);

    let client = reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .build()
        .expect("cannot build http client");
    let state = AppState { client, llama_url };

    let listener = tokio::net::TcpListener::bind(&bind)
        .await
        .unwrap_or_else(|e| panic!("cannot bind {bind}: {e}"));
    match &state.llama_url {
        Some(u) => tracing::info!("pi-service listening on {bind}, llama-server at {u}"),
        None => tracing::info!("pi-service listening on {bind}, mock replies (LLAMA_URL not set)"),
    }
    axum::serve(listener, app(state)).await.expect("server error");
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::{to_bytes, Body},
        http::Request,
    };
    use tower::ServiceExt;

    fn mock_state() -> AppState {
        AppState {
            client: reqwest::Client::new(),
            llama_url: None,
        }
    }

    async fn post_chat(body: &str) -> (StatusCode, Value) {
        let res = app(mock_state())
            .oneshot(
                Request::post("/v1/chat")
                    .header("content-type", "application/json")
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        let status = res.status();
        let bytes = to_bytes(res.into_body(), 1 << 20).await.unwrap();
        (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
    }

    #[tokio::test]
    async fn chat_returns_mock_reply() {
        let (status, body) = post_chat(r#"{"message":"  hello  "}"#).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["source"], "mock");
        assert!(body["reply"].as_str().unwrap().contains("hello"));
    }

    #[tokio::test]
    async fn chat_rejects_empty_message() {
        let (status, body) = post_chat(r#"{"message":"   "}"#).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert!(body["error"].is_string());
    }

    #[tokio::test]
    async fn chat_rejects_overlong_message() {
        let long = "a".repeat(MAX_INPUT_CHARS + 1);
        let (status, _) = post_chat(&format!(r#"{{"message":"{long}"}}"#)).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn chat_counts_characters_not_bytes() {
        // 200 two-byte characters is within the limit even though it is 400 bytes.
        let msg = "é".repeat(MAX_INPUT_CHARS);
        let (status, _) = post_chat(&format!(r#"{{"message":"{msg}"}}"#)).await;
        assert_eq!(status, StatusCode::OK);
    }

    #[tokio::test]
    async fn chat_rejects_malformed_json() {
        let (status, _) = post_chat(r#"{"nope":1}"#).await;
        assert!(status.is_client_error());
    }

    #[tokio::test]
    async fn chat_accepts_style_hint() {
        let (status, _) = post_chat(r#"{"message":"hi","style_hint":"You are sleepy."}"#).await;
        assert_eq!(status, StatusCode::OK);
    }

    #[test]
    fn empty_hint_leaves_prompt_unchanged() {
        assert_eq!(build_system_prompt(""), SYSTEM_PROMPT);
        assert_eq!(build_system_prompt("   "), SYSTEM_PROMPT);
    }

    #[test]
    fn hint_is_appended_to_prompt() {
        let p = build_system_prompt(" You are sleepy. ");
        assert_eq!(p, format!("{SYSTEM_PROMPT} You are sleepy."));
    }

    #[test]
    fn overlong_hint_is_truncated() {
        let p = build_system_prompt(&"x".repeat(MAX_STYLE_HINT_CHARS + 50));
        assert_eq!(p.chars().count(), SYSTEM_PROMPT.chars().count() + 1 + MAX_STYLE_HINT_CHARS);
    }

    #[test]
    fn extracts_openai_style_reply() {
        let v = json!({ "choices": [{ "message": { "content": " Hi there! " } }] });
        assert_eq!(extract_reply(&v).as_deref(), Some("Hi there!"));
    }

    #[test]
    fn rejects_bad_or_empty_reply_shapes() {
        assert!(extract_reply(&json!({})).is_none());
        assert!(extract_reply(&json!({ "choices": [] })).is_none());
        assert!(extract_reply(&json!({ "choices": [{ "message": { "content": "  " } }] })).is_none());
    }
}
