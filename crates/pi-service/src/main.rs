use std::{sync::Arc, time::Duration};

use axum::{
    extract::State,
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

mod telemetry;
use telemetry::Telemetry;

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
    /// Numbers remembered between requests (last tokens/s, model name).
    telemetry: Arc<Telemetry>,
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

/// Everything after `llama_configured` is optional: a field is left out when it cannot be
/// measured (no llama-server configured, not running on a Pi, nothing generated yet).
#[derive(Serialize)]
struct Health {
    status: &'static str,
    service: &'static str,
    version: &'static str,
    llama_configured: bool,
    /// Is llama-server answering right now? Only present when it is configured.
    #[serde(skip_serializing_if = "Option::is_none")]
    llama_up: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    model: Option<String>,
    /// Generation speed of the most recent llama reply.
    #[serde(skip_serializing_if = "Option::is_none")]
    tok_per_sec: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    cpu_temp_c: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    ram_free_mb: Option<u32>,
    /// True while the Pi is under-volted, frequency-capped or thermally throttled.
    #[serde(skip_serializing_if = "Option::is_none")]
    throttled: Option<bool>,
    // TODO: queue depth, once requests are queued.
}

async fn health(State(st): State<AppState>) -> Json<Health> {
    let (temp, meminfo, throttled) = tokio::join!(
        telemetry::read_file(telemetry::CPU_TEMP_PATH),
        telemetry::read_file(telemetry::MEMINFO_PATH),
        telemetry::read_file(telemetry::THROTTLED_PATH),
    );

    let (llama_up, model) = match st.llama_url.as_deref() {
        None => (None, None),
        Some(base) => {
            let up = telemetry::llama_is_up(&st.client, base).await;
            let model = match st.telemetry.cached_model() {
                Some(m) => Some(m),
                // Learn the name once llama-server is up; keep trying until it answers.
                None if up => {
                    let fetched = telemetry::fetch_model(&st.client, base).await;
                    if let Some(m) = &fetched {
                        st.telemetry.set_model(m.clone());
                    }
                    fetched
                }
                None => None,
            };
            (Some(up), model)
        }
    };

    Json(Health {
        status: "ok",
        service: "pi-service",
        version: env!("CARGO_PKG_VERSION"),
        llama_configured: st.llama_url.is_some(),
        llama_up,
        model,
        tok_per_sec: st.telemetry.tok_per_sec(),
        cpu_temp_c: temp.as_deref().and_then(telemetry::parse_cpu_temp_c),
        ram_free_mb: meminfo
            .as_deref()
            .and_then(telemetry::parse_mem_available_mb),
        throttled: throttled
            .as_deref()
            .and_then(telemetry::parse_throttled_now),
    })
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
    let (reply, tok_per_sec) = ask_llama(&st.client, base, &system, message)
        .await
        .map_err(|e| {
            tracing::warn!("llama-server request failed: {e}");
            api_error(StatusCode::BAD_GATEWAY, "the pet's brain did not answer")
        })?;
    if let Some(v) = tok_per_sec {
        st.telemetry.record_tok_per_sec(v);
    }
    Ok(Json(ChatResponse {
        reply,
        source: "llama",
    }))
}

/// Base prompt plus the game's mood hint (trimmed and length-capped), if any.
fn build_system_prompt(style_hint: &str) -> String {
    let hint: String = style_hint
        .trim()
        .chars()
        .take(MAX_STYLE_HINT_CHARS)
        .collect();
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
) -> Result<(String, Option<f32>), String> {
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
        .post(format!(
            "{}/v1/chat/completions",
            base.trim_end_matches('/')
        ))
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    let value: Value = res.json().await.map_err(|e| e.to_string())?;
    let reply = extract_reply(&value).ok_or_else(|| "unexpected response shape".to_string())?;
    Ok((reply, telemetry::extract_tok_per_sec(&value)))
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
    let state = AppState {
        client,
        llama_url,
        telemetry: Arc::default(),
    };

    let listener = tokio::net::TcpListener::bind(&bind)
        .await
        .unwrap_or_else(|e| panic!("cannot bind {bind}: {e}"));
    match &state.llama_url {
        Some(u) => tracing::info!("pi-service listening on {bind}, llama-server at {u}"),
        None => tracing::info!("pi-service listening on {bind}, mock replies (LLAMA_URL not set)"),
    }
    axum::serve(listener, app(state))
        .await
        .expect("server error");
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::{to_bytes, Body},
        http::Request,
    };
    use tower::ServiceExt;

    fn state_for(llama_url: Option<&str>) -> AppState {
        AppState {
            client: reqwest::Client::new(),
            llama_url: llama_url.map(Arc::from),
            telemetry: Arc::default(),
        }
    }

    fn mock_state() -> AppState {
        state_for(None)
    }

    async fn call(state: AppState, req: Request<Body>) -> (StatusCode, Value) {
        let res = app(state).oneshot(req).await.unwrap();
        let status = res.status();
        let bytes = to_bytes(res.into_body(), 1 << 20).await.unwrap();
        (
            status,
            serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        )
    }

    async fn get_health(state: AppState) -> Value {
        let (status, body) = call(
            state,
            Request::get("/v1/health").body(Body::empty()).unwrap(),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        body
    }

    fn chat_req(message: &str) -> Request<Body> {
        Request::post("/v1/chat")
            .header("content-type", "application/json")
            .body(Body::from(json!({ "message": message }).to_string()))
            .unwrap()
    }

    /// A stand-in for llama-server on a random local port.
    async fn spawn_fake_llama() -> String {
        let fake = Router::new()
            .route("/health", get(|| async { Json(json!({ "status": "ok" })) }))
            .route(
                "/v1/models",
                get(|| async {
                    Json(json!({ "data": [{ "id": "/home/edgelm/models/gemma-3-270m-it-qat-Q4_0.gguf" }] }))
                }),
            )
            .route(
                "/v1/chat/completions",
                post(|| async {
                    Json(json!({
                        "choices": [{ "message": { "content": "hi" } }],
                        "timings": { "predicted_per_second": 7.34 }
                    }))
                }),
            );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, fake).await.unwrap() });
        format!("http://{addr}")
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
        (
            status,
            serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        )
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

    #[tokio::test]
    async fn health_without_llama_omits_llama_fields() {
        let h = get_health(mock_state()).await;
        assert_eq!(h["status"], "ok");
        assert_eq!(h["llama_configured"], false);
        for key in ["llama_up", "model", "tok_per_sec"] {
            assert!(h.get(key).is_none(), "{key} should be absent: {h}");
        }
    }

    #[tokio::test]
    async fn health_reports_llama_up_model_and_speed() {
        let url = spawn_fake_llama().await;
        let state = state_for(Some(&url));

        // Before any chat: llama is up and named, but no speed has been measured.
        let h = get_health(state.clone()).await;
        assert_eq!(h["llama_configured"], true);
        assert_eq!(h["llama_up"], true);
        assert_eq!(h["model"], "gemma-3-270m-it-qat-Q4_0");
        assert!(h.get("tok_per_sec").is_none());

        // After a chat the speed from llama-server's timings shows up.
        let (status, body) = call(state.clone(), chat_req("hello")).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["source"], "llama");
        let h = get_health(state).await;
        assert!(
            (h["tok_per_sec"].as_f64().unwrap() - 7.3).abs() < 1e-6,
            "{h}"
        );
    }

    #[tokio::test]
    async fn health_reports_llama_down() {
        // Nothing listens on port 1.
        let h = get_health(state_for(Some("http://127.0.0.1:1"))).await;
        assert_eq!(h["llama_configured"], true);
        assert_eq!(h["llama_up"], false);
        assert!(h.get("model").is_none());
    }

    #[tokio::test]
    async fn chat_without_timings_leaves_speed_unset() {
        let fake = Router::new().route(
            "/v1/chat/completions",
            post(|| async { Json(json!({ "choices": [{ "message": { "content": "hi" } }] })) }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(listener, fake).await.unwrap() });

        let state = state_for(Some(&url));
        let (status, _) = call(state.clone(), chat_req("hello")).await;
        assert_eq!(status, StatusCode::OK);
        assert!(state.telemetry.tok_per_sec().is_none());
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
        assert_eq!(
            p.chars().count(),
            SYSTEM_PROMPT.chars().count() + 1 + MAX_STYLE_HINT_CHARS
        );
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
        assert!(
            extract_reply(&json!({ "choices": [{ "message": { "content": "  " } }] })).is_none()
        );
    }
}
