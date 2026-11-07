//! Pi health numbers for the /v1/health endpoint: CPU temperature, free RAM, throttle flag,
//! llama-server status, model name and the last measured generation speed.
//!
//! The parsers are pure functions so they can be tested on any machine. Everything is
//! optional: on a laptop (no /sys thermal files) the fields are simply left out.

use std::{sync::Mutex, time::Duration};

use serde_json::Value;

pub const CPU_TEMP_PATH: &str = "/sys/class/thermal/thermal_zone0/temp";
pub const MEMINFO_PATH: &str = "/proc/meminfo";
/// Raspberry Pi firmware flags (same value `vcgencmd get_throttled` prints).
pub const THROTTLED_PATH: &str = "/sys/devices/platform/soc/soc:firmware/get_throttled";

/// Probes of llama-server must never make /v1/health slow.
const PROBE_TIMEOUT: Duration = Duration::from_secs(1);

/// Values remembered between requests.
#[derive(Default)]
pub struct Telemetry {
    last_tok_per_sec: Mutex<Option<f32>>,
    model: Mutex<Option<String>>,
}

impl Telemetry {
    pub fn record_tok_per_sec(&self, v: f32) {
        *self.last_tok_per_sec.lock().unwrap() = Some(v);
    }

    pub fn tok_per_sec(&self) -> Option<f32> {
        *self.last_tok_per_sec.lock().unwrap()
    }

    pub fn cached_model(&self) -> Option<String> {
        self.model.lock().unwrap().clone()
    }

    pub fn set_model(&self, name: String) {
        *self.model.lock().unwrap() = Some(name);
    }
}

/// Read a small text file, `None` if it does not exist or cannot be read.
pub async fn read_file(path: &str) -> Option<String> {
    tokio::fs::read_to_string(path).await.ok()
}

/// `/sys/class/thermal/thermal_zone0/temp` holds millidegrees Celsius, e.g. "48312".
pub fn parse_cpu_temp_c(raw: &str) -> Option<f32> {
    let milli: f32 = raw.trim().parse().ok()?;
    let c = milli / 1000.0;
    // Sanity range: anything else is a broken sensor, not a temperature.
    (-40.0..=150.0).contains(&c).then(|| round1(c))
}

/// "MemAvailable:  123456 kB" in /proc/meminfo, returned in whole MB.
pub fn parse_mem_available_mb(meminfo: &str) -> Option<u32> {
    let line = meminfo.lines().find(|l| l.starts_with("MemAvailable:"))?;
    let kb: u64 = line.split_whitespace().nth(1)?.parse().ok()?;
    Some((kb / 1024) as u32)
}

/// Firmware flags are a hex bitmask. Bits 0 to 3 mean "happening right now":
/// under-voltage, frequency capped, throttled, soft temperature limit.
/// (Bits 16 to 19 are "has happened since boot", ignored here.)
pub fn parse_throttled_now(raw: &str) -> Option<bool> {
    let s = raw.trim();
    let s = s.strip_prefix("0x").unwrap_or(s);
    let flags = u32::from_str_radix(s, 16).ok()?;
    Some(flags & 0xF != 0)
}

/// `/home/edgelm/models/gemma-3-270m-it-qat-Q4_0.gguf` -> `gemma-3-270m-it-qat-Q4_0`.
pub fn model_label(id: &str) -> String {
    let file = id.rsplit(['/', '\\']).next().unwrap_or(id);
    file.strip_suffix(".gguf").unwrap_or(file).to_string()
}

/// llama-server adds a `timings` object to completion responses.
pub fn extract_tok_per_sec(response: &Value) -> Option<f32> {
    let v = response["timings"]["predicted_per_second"].as_f64()?;
    (v.is_finite() && v > 0.0).then(|| round1(v as f32))
}

pub fn round1(v: f32) -> f32 {
    (v * 10.0).round() / 10.0
}

/// Is llama-server answering its /health endpoint?
pub async fn llama_is_up(client: &reqwest::Client, base: &str) -> bool {
    client
        .get(format!("{}/health", base.trim_end_matches('/')))
        .timeout(PROBE_TIMEOUT)
        .send()
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}

/// Model name from llama-server's OpenAI-style /v1/models.
pub async fn fetch_model(client: &reqwest::Client, base: &str) -> Option<String> {
    let res = client
        .get(format!("{}/v1/models", base.trim_end_matches('/')))
        .timeout(PROBE_TIMEOUT)
        .send()
        .await
        .ok()?
        .error_for_status()
        .ok()?;
    let body: Value = res.json().await.ok()?;
    let id = body["data"][0]["id"].as_str()?;
    Some(model_label(id))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn cpu_temp_from_millidegrees() {
        assert_eq!(parse_cpu_temp_c("48312\n"), Some(48.3));
        assert_eq!(parse_cpu_temp_c("  61000 "), Some(61.0));
    }

    #[test]
    fn cpu_temp_rejects_garbage_and_absurd_values() {
        assert_eq!(parse_cpu_temp_c(""), None);
        assert_eq!(parse_cpu_temp_c("hot"), None);
        assert_eq!(parse_cpu_temp_c("999999"), None);
    }

    #[test]
    fn mem_available_in_mb() {
        let meminfo = "MemTotal:         462680 kB\nMemFree:           50000 kB\nMemAvailable:     190676 kB\nBuffers: 1 kB\n";
        assert_eq!(parse_mem_available_mb(meminfo), Some(186));
    }

    #[test]
    fn mem_available_missing_or_malformed() {
        assert_eq!(parse_mem_available_mb("MemTotal: 1 kB\n"), None);
        assert_eq!(parse_mem_available_mb("MemAvailable: lots kB\n"), None);
    }

    #[test]
    fn throttled_flags() {
        assert_eq!(parse_throttled_now("0\n"), Some(false));
        assert_eq!(parse_throttled_now("0x0"), Some(false));
        // Under-voltage right now (bit 0).
        assert_eq!(parse_throttled_now("0x1"), Some(true));
        // Only the "has happened" bits (16 and 18): not throttled now.
        assert_eq!(parse_throttled_now("50000"), Some(false));
        // Both: still throttled now.
        assert_eq!(parse_throttled_now("0x50005"), Some(true));
        assert_eq!(parse_throttled_now("nope"), None);
    }

    #[test]
    fn model_label_strips_directory_and_extension() {
        assert_eq!(
            model_label("/home/edgelm/models/gemma-3-270m-it-qat-Q4_0.gguf"),
            "gemma-3-270m-it-qat-Q4_0"
        );
        assert_eq!(model_label("smollm2"), "smollm2");
        assert_eq!(model_label(r"C:\m\x.gguf"), "x");
    }

    #[test]
    fn tok_per_sec_from_timings() {
        let v = json!({ "timings": { "predicted_per_second": 7.34 } });
        assert_eq!(extract_tok_per_sec(&v), Some(7.3));
        assert_eq!(extract_tok_per_sec(&json!({})), None);
        assert_eq!(
            extract_tok_per_sec(&json!({ "timings": { "predicted_per_second": 0 } })),
            None
        );
    }
}
