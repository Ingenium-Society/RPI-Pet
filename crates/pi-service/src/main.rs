use axum::{routing::get, Json, Router};
use serde_json::{json, Value};

async fn health() -> Json<Value> {
    // TODO: tok/s, queue depth, free RAM, CPU temp, throttle flags, llama-server status
    Json(json!({
        "status": "ok",
        "service": "pi-service",
        "version": env!("CARGO_PKG_VERSION"),
    }))
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    // On the Pi: BIND=192.168.7.1:3000 (the USB link address). Locally the default is fine.
    let bind = std::env::var("BIND").unwrap_or_else(|_| "127.0.0.1:3000".into());

    let app = Router::new().route("/v1/health", get(health));

    let listener = tokio::net::TcpListener::bind(&bind)
        .await
        .unwrap_or_else(|e| panic!("cannot bind {bind}: {e}"));
    tracing::info!("pi-service listening on {bind}");
    axum::serve(listener, app).await.expect("server error");
}
