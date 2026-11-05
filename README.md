# Pet

An original Pou-style virtual pet whose "brain" is a small LLM (Gemma 3 270M / SmolLM2)
running on a Raspberry Pi Zero 2 W, connected to a laptop over a USB cable.

```
laptop (game + UI, source of truth)  <--- USB Ethernet (RNDIS/ECM) --->  Pi Zero 2 W
  apps/web (Vite + React + TS)                                          pi-service (Rust/axum)
  - game state, rendering, sound                                         -> llama-server (llama.cpp)
  - interaction log (logs/, local only)                                  - facts retrieval, validation, fallback
```

## Layout

| Path | What |
|---|---|
| `crates/pet-core` | pure library: facts schema, retrieval, (later) prompt builder, validator, mock generator |
| `crates/pi-service` | axum service that runs on the Pi and fronts `llama-server` |
| `apps/web` | game UI, runs on the laptop |
| `data/facts.json` | bilingual (id/en) facts the pet may state. Placeholders are `public: false` |
| `data/prompts/` | static prompt prefixes per language |
| `config/` | service config (planned, not yet read by code) |
| `pi/` | gadget-mode scripts, dnsmasq, systemd units for the Pi |
| `bench/` | model bake-off scripts and results |
| `scripts/` | build and deploy helpers |

## Everyday commands

```bash
# Rust: test everything, run the service locally (no Pi needed)
cargo test --workspace
cargo run -p pi-service                      # listens on 127.0.0.1:3000

# Web: dev server, proxying /v1 to the Pi (or to a local pi-service)
cd apps/web && npm dev                      # PI_URL defaults to http://192.168.7.1:3000
cd apps/web && PI_URL=http://127.0.0.1:3000 npm dev

# Cross-compile the service for the Pi (Debian trixie, aarch64)
./scripts/build-pi.sh
```

On the Pi, run the service bound to the USB link address: `BIND=192.168.7.1:3000 ./pi-service`.

## Privacy

Visitor questions are logged **on the laptop only**, to `logs/interactions.jsonl`
(git-ignored). The Pi never stores typed text.
