use std::{path::Path, sync::Arc, time::Duration};

use axum::{
    extract::State,
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use pet_core::{build_prompt, detect_lang, ground, no_match_line, retrieve, Lang, MIN_SCORE};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

mod knowledge;
mod telemetry;
use knowledge::Knowledge;
use telemetry::Telemetry;

// Mirrors [limits] in config/pi-service.toml (which is not read by code yet).
const MAX_INPUT_CHARS: usize = 200;
const N_PREDICT: u32 = 32;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(12);
/// Low: the answer should restate the fact, not get creative.
const TEMPERATURE: f32 = 0.3;

#[derive(Clone)]
struct AppState {
    client: reqwest::Client,
    /// Base URL of llama-server, e.g. http://127.0.0.1:8081. None = no model: facts only.
    llama_url: Option<Arc<str>>,
    /// Numbers remembered between requests (last tokens/s, model name).
    telemetry: Arc<Telemetry>,
    /// Facts and prompt prefixes.
    knowledge: Arc<Knowledge>,
}

/// Unknown fields are ignored on purpose: the game also sends a `style_hint` (mood text).
/// It is not used yet, because the prompt prefix must stay byte-identical for llama.cpp's
/// prompt cache and a 270M model has not been tested with extra instructions.
#[derive(Deserialize)]
struct ChatRequest {
    message: String,
}

#[derive(Serialize)]
struct ChatResponse {
    reply: String,
    /// Where the reply came from:
    /// - "llama":    the model answered and the answer passed validation
    /// - "fallback": a fact matched, but the model failed, timed out or broke the rules,
    ///   so the fact's pre-written `fallback_line` is used
    /// - "deflect":  no public fact matched, so the pet says it does not know (no model call)
    /// - "mock":     no model is configured; the fact's `fallback_line` is used
    source: &'static str,
    /// The fact the answer is based on. Absent for "deflect".
    #[serde(skip_serializing_if = "Option::is_none")]
    fact_id: Option<String>,
    /// Detected language of the question.
    lang: Lang,
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

    // 1. Which language, and which public fact (if any) answers the question?
    let lang = detect_lang(message);
    let Some(hit) = retrieve(&st.knowledge.facts, message, lang, MIN_SCORE) else {
        tracing::info!(?lang, "no fact matched, deflecting");
        return Ok(Json(ChatResponse {
            reply: no_match_line(lang).to_string(),
            source: "deflect",
            fact_id: None,
            lang,
        }));
    };
    let fact = hit.fact;

    // 2. Let the model phrase the fact in the pet's voice (if there is a model).
    let model_answer = match st.llama_url.as_deref() {
        None => None,
        Some(base) => {
            let prompt = build_prompt(st.knowledge.prefix(lang), fact, message, lang);
            match ask_llama(&st.client, base, &prompt).await {
                Ok((text, tok_per_sec)) => {
                    if let Some(v) = tok_per_sec {
                        st.telemetry.record_tok_per_sec(v);
                    }
                    Some(text)
                }
                Err(e) => {
                    // The visitor still gets a sensible answer; /v1/health shows llama is down.
                    tracing::warn!("llama-server request failed, using fallback line: {e}");
                    None
                }
            }
        }
    };

    // 3. Use the model's answer only if it validates, otherwise the pre-written line.
    let grounded = ground(fact, lang, model_answer.as_deref());
    let source = if st.llama_url.is_none() {
        "mock"
    } else if grounded.from_model {
        "llama"
    } else {
        "fallback"
    };
    tracing::info!(fact = %fact.id, ?lang, score = hit.score, source, "answered");
    Ok(Json(ChatResponse {
        reply: grounded.text,
        source,
        fact_id: Some(fact.id.clone()),
        lang,
    }))
}

/// Raw text completion: `prompt` already ends with "Answer:" / "Jawaban:", and the first
/// newline ends the answer. `cache_prompt` lets llama.cpp reuse the static prefix.
async fn ask_llama(
    client: &reqwest::Client,
    base: &str,
    prompt: &str,
) -> Result<(String, Option<f32>), String> {
    let body = json!({
        "prompt": prompt,
        "n_predict": N_PREDICT,
        "temperature": TEMPERATURE,
        "stop": ["\n"],
        "cache_prompt": true,
        "stream": false,
    });
    let res = client
        .post(format!("{}/completion", base.trim_end_matches('/')))
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    let value: Value = res.json().await.map_err(|e| e.to_string())?;
    let text = extract_content(&value).ok_or_else(|| "unexpected response shape".to_string())?;
    Ok((text, telemetry::extract_tok_per_sec(&value)))
}

/// The generated text of a llama-server `/completion` response (may be empty).
fn extract_content(value: &Value) -> Option<String> {
    value["content"].as_str().map(str::to_string)
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
    // Set LLAMA_URL=http://127.0.0.1:8081 to use a running llama-server; unset = facts only.
    let llama_url = std::env::var("LLAMA_URL")
        .ok()
        .filter(|s| !s.is_empty())
        .map(Arc::from);
    // Unset = the facts and prompts compiled into this binary. DATA_DIR=/path/to/data = load
    // facts.json and prompts/prefix.{id,en}.txt from there (no rebuild needed).
    let knowledge = match std::env::var("DATA_DIR").ok().filter(|s| !s.is_empty()) {
        Some(dir) => Knowledge::from_dir(Path::new(&dir)),
        None => Knowledge::embedded(),
    }
    .unwrap_or_else(|e| panic!("cannot load facts: {e}"));
    tracing::info!(
        "{} facts loaded ({} public)",
        knowledge.facts.len(),
        knowledge.public_count()
    );

    let client = reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .build()
        .expect("cannot build http client");
    let state = AppState {
        client,
        llama_url,
        telemetry: Arc::default(),
        knowledge: Arc::new(knowledge),
    };

    let listener = tokio::net::TcpListener::bind(&bind)
        .await
        .unwrap_or_else(|e| panic!("cannot bind {bind}: {e}"));
    match &state.llama_url {
        Some(u) => tracing::info!("pi-service listening on {bind}, llama-server at {u}"),
        None => {
            tracing::info!("pi-service listening on {bind}, facts only (LLAMA_URL not set)")
        }
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
    use std::sync::Mutex;
    use tower::ServiceExt;

    // In-scope and out-of-scope questions taken from data/eval/questions.json.
    const Q_INTRO_ID: &str = "Ingenium itu apa sih?"; // -> club.intro
    const Q_LEADER_EN: &str = "Who is the leader of the club?"; // -> club.leader
    const Q_OUT_OF_SCOPE: &str = "Presiden Indonesia siapa?"; // -> no fact

    fn state_for(llama_url: Option<&str>) -> AppState {
        AppState {
            client: reqwest::Client::new(),
            llama_url: llama_url.map(Arc::from),
            telemetry: Arc::default(),
            knowledge: Arc::new(Knowledge::embedded().unwrap()),
        }
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

    async fn post_chat(state: AppState, message: &str) -> (StatusCode, Value) {
        call(state, chat_req(message)).await
    }

    /// A stand-in for llama-server on a random local port. Answers every /completion with
    /// `content` and records the request bodies it receives.
    struct FakeLlama {
        url: String,
        requests: Arc<Mutex<Vec<Value>>>,
    }

    async fn spawn_fake_llama(content: &'static str, timings: bool) -> FakeLlama {
        let requests = Arc::new(Mutex::new(Vec::new()));
        let log = requests.clone();
        let fake = Router::new()
            .route("/health", get(|| async { Json(json!({ "status": "ok" })) }))
            .route(
                "/v1/models",
                get(|| async {
                    Json(json!({ "data": [{ "id": "/home/edgelm/models/gemma-3-270m-it-qat-Q4_0.gguf" }] }))
                }),
            )
            .route(
                "/completion",
                post(move |Json(body): Json<Value>| {
                    let log = log.clone();
                    async move {
                        log.lock().unwrap().push(body);
                        let mut res = json!({ "content": content });
                        if timings {
                            res["timings"] = json!({ "predicted_per_second": 7.34 });
                        }
                        Json(res)
                    }
                }),
            );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(listener, fake).await.unwrap() });
        FakeLlama { url, requests }
    }

    fn fallback_line(fact_id: &str, lang: Lang) -> String {
        let k = Knowledge::embedded().unwrap();
        k.fact(fact_id).unwrap().fallback_line.get(lang).clone()
    }

    // ---- request validation (unchanged behaviour) ----

    #[tokio::test]
    async fn chat_rejects_empty_message() {
        let (status, body) = post_chat(state_for(None), "   ").await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert!(body["error"].is_string());
    }

    #[tokio::test]
    async fn chat_rejects_overlong_message() {
        let long = "a".repeat(MAX_INPUT_CHARS + 1);
        let (status, _) = post_chat(state_for(None), &long).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn chat_counts_characters_not_bytes() {
        // 200 two-byte characters is within the limit even though it is 400 bytes.
        let (status, _) = post_chat(state_for(None), &"é".repeat(MAX_INPUT_CHARS)).await;
        assert_eq!(status, StatusCode::OK);
    }

    #[tokio::test]
    async fn chat_rejects_malformed_json() {
        let req = Request::post("/v1/chat")
            .header("content-type", "application/json")
            .body(Body::from(r#"{"nope":1}"#))
            .unwrap();
        let (status, _) = call(state_for(None), req).await;
        assert!(status.is_client_error());
    }

    #[tokio::test]
    async fn chat_ignores_the_games_style_hint() {
        let req = Request::post("/v1/chat")
            .header("content-type", "application/json")
            .body(Body::from(
                json!({ "message": Q_INTRO_ID, "style_hint": "You are sleepy." }).to_string(),
            ))
            .unwrap();
        let (status, body) = call(state_for(None), req).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["fact_id"], "club.intro");
    }

    // ---- the facts layer ----

    #[tokio::test]
    async fn without_a_model_the_matched_facts_fallback_line_is_returned() {
        let (status, body) = post_chat(state_for(None), Q_INTRO_ID).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["source"], "mock");
        assert_eq!(body["fact_id"], "club.intro");
        assert_eq!(body["lang"], "id");
        assert_eq!(body["reply"], fallback_line("club.intro", Lang::Id));
    }

    #[tokio::test]
    async fn out_of_scope_questions_deflect_without_calling_the_model() {
        let fake = spawn_fake_llama("ignored", true).await;
        let (status, body) = post_chat(state_for(Some(&fake.url)), Q_OUT_OF_SCOPE).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["source"], "deflect");
        assert_eq!(body["reply"], no_match_line(Lang::Id));
        assert!(body.get("fact_id").is_none());
        assert!(
            fake.requests.lock().unwrap().is_empty(),
            "model must not be called"
        );
    }

    #[tokio::test]
    async fn a_valid_model_answer_is_used() {
        let fake = spawn_fake_llama(" Aku bagian dari Ingenium, klub teknik!", true).await;
        let (status, body) = post_chat(state_for(Some(&fake.url)), Q_INTRO_ID).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["source"], "llama");
        assert_eq!(body["fact_id"], "club.intro");
        assert_eq!(body["reply"], "Aku bagian dari Ingenium, klub teknik!");
    }

    #[tokio::test]
    async fn the_prompt_sent_to_the_model_is_built_from_prefix_and_fact() {
        let fake = spawn_fake_llama("Ingenium!", true).await;
        post_chat(state_for(Some(&fake.url)), Q_INTRO_ID).await;

        let sent = fake.requests.lock().unwrap();
        assert_eq!(sent.len(), 1);
        let req = &sent[0];
        let prompt = req["prompt"].as_str().unwrap();
        let k = Knowledge::embedded().unwrap();
        // The static prefix comes first, byte for byte (llama.cpp prompt cache).
        assert!(prompt.starts_with(k.prefix(Lang::Id)));
        // Then the retrieved fact and the question, ending where the answer should start.
        let fact_text = k.fact("club.intro").unwrap().text.get(Lang::Id).clone();
        assert!(prompt.contains(&format!("Fakta: {fact_text}")));
        assert!(prompt.contains(&format!("Pertanyaan: {Q_INTRO_ID}")));
        assert!(prompt.ends_with("Jawaban:"));
        // The answer ends at the first newline, and the prefix is cached.
        assert_eq!(req["stop"], json!(["\n"]));
        assert_eq!(req["cache_prompt"], true);
        assert_eq!(req["n_predict"], N_PREDICT);
    }

    #[tokio::test]
    async fn english_questions_use_the_english_prefix_and_labels() {
        let fake = spawn_fake_llama("Arya leads us!", true).await;
        let (_, body) = post_chat(state_for(Some(&fake.url)), Q_LEADER_EN).await;
        assert_eq!(body["lang"], "en");
        assert_eq!(body["fact_id"], "club.leader");
        assert_eq!(body["source"], "llama");

        let sent = fake.requests.lock().unwrap();
        let prompt = sent[0]["prompt"].as_str().unwrap();
        let k = Knowledge::embedded().unwrap();
        assert!(prompt.starts_with(k.prefix(Lang::En)));
        assert!(prompt.ends_with("Answer:"));
    }

    #[tokio::test]
    async fn an_answer_that_breaks_the_rules_is_replaced_by_the_fallback_line() {
        // Breaks character (banned phrase) and is missing the fact's "Ingenium" anchor.
        let fake = spawn_fake_llama(" Aku adalah model bahasa.", true).await;
        let (status, body) = post_chat(state_for(Some(&fake.url)), Q_INTRO_ID).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["source"], "fallback");
        assert_eq!(body["reply"], fallback_line("club.intro", Lang::Id));
    }

    #[tokio::test]
    async fn an_answer_missing_the_facts_anchor_is_replaced_by_the_fallback_line() {
        let fake = spawn_fake_llama("Seseorang memimpin kami.", true).await;
        let (_, body) = post_chat(state_for(Some(&fake.url)), Q_LEADER_EN).await;
        assert_eq!(body["source"], "fallback");
        assert_eq!(body["reply"], fallback_line("club.leader", Lang::En));
    }

    #[tokio::test]
    async fn an_empty_model_answer_falls_back() {
        let fake = spawn_fake_llama("", true).await;
        let (_, body) = post_chat(state_for(Some(&fake.url)), Q_INTRO_ID).await;
        assert_eq!(body["source"], "fallback");
    }

    #[tokio::test]
    async fn an_unreachable_model_still_gives_the_visitor_an_answer() {
        // Nothing listens on port 1: the request fails, but this is not an error for the visitor.
        let (status, body) = post_chat(state_for(Some("http://127.0.0.1:1")), Q_INTRO_ID).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["source"], "fallback");
        assert_eq!(body["reply"], fallback_line("club.intro", Lang::Id));
    }

    // ---- health telemetry ----

    #[tokio::test]
    async fn health_without_llama_omits_llama_fields() {
        let h = get_health(state_for(None)).await;
        assert_eq!(h["status"], "ok");
        assert_eq!(h["llama_configured"], false);
        for key in ["llama_up", "model", "tok_per_sec"] {
            assert!(h.get(key).is_none(), "{key} should be absent: {h}");
        }
    }

    #[tokio::test]
    async fn health_reports_llama_up_model_and_speed() {
        let fake = spawn_fake_llama("Ingenium!", true).await;
        let state = state_for(Some(&fake.url));

        // Before any chat: llama is up and named, but no speed has been measured.
        let h = get_health(state.clone()).await;
        assert_eq!(h["llama_configured"], true);
        assert_eq!(h["llama_up"], true);
        assert_eq!(h["model"], "gemma-3-270m-it-qat-Q4_0");
        assert!(h.get("tok_per_sec").is_none());

        // After a chat the speed from llama-server's timings shows up.
        let (status, _) = post_chat(state.clone(), Q_INTRO_ID).await;
        assert_eq!(status, StatusCode::OK);
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
        let fake = spawn_fake_llama("Ingenium!", false).await;
        let state = state_for(Some(&fake.url));
        let (status, _) = post_chat(state.clone(), Q_INTRO_ID).await;
        assert_eq!(status, StatusCode::OK);
        assert!(state.telemetry.tok_per_sec().is_none());
    }

    #[tokio::test]
    async fn a_deflected_question_does_not_touch_the_speed() {
        let fake = spawn_fake_llama("x", true).await;
        let state = state_for(Some(&fake.url));
        post_chat(state.clone(), Q_OUT_OF_SCOPE).await;
        assert!(state.telemetry.tok_per_sec().is_none());
    }

    #[test]
    fn extracts_completion_content() {
        assert_eq!(
            extract_content(&json!({ "content": " Halo! " })).as_deref(),
            Some(" Halo! ")
        );
        // An empty answer is a valid response shape (validation rejects it later).
        assert_eq!(
            extract_content(&json!({ "content": "" })).as_deref(),
            Some("")
        );
    }

    #[test]
    fn rejects_unexpected_completion_shapes() {
        assert!(extract_content(&json!({})).is_none());
        assert!(extract_content(&json!({ "content": 5 })).is_none());
        // The chat-completions shape is not what /completion returns.
        assert!(
            extract_content(&json!({ "choices": [{ "message": { "content": "x" } }] })).is_none()
        );
    }
}
