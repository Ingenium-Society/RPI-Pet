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

# Web (npm workspaces): install once from the repo root
npm install

# Dev server, proxying /v1 to the Pi (or to a local pi-service)
npm run web                                 # PI_URL defaults to http://192.168.7.1:3000
PI_URL=http://127.0.0.1:3000 npm run web

# Cross-compile the service for the Pi (Debian trixie, aarch64)
./scripts/build-pi.sh
```

On the Pi, run the service bound to the USB link address: `BIND=192.168.7.1:3000 ./pi-service`.

## Run it on the Pi from the Mac (one command)

```bash
./scripts/run.sh                                  # PI_HOST defaults to edgelm@edgelm.local
PI_HOST=edgelm@192.168.22.73 ./scripts/run.sh     # if edgelm.local does not resolve
```

It copies `scripts/pi-run.sh` to the Pi, starts llama-server and `pi-service` there, forwards
port 3000 through SSH, waits until `/v1/health` reports `llama_configured: true`, then starts the
chatbox at http://localhost:5173. Ctrl-C stops everything, including the processes on the Pi.
Pi-side output goes to `logs/pi.log` on the Mac, and llama-server's own log is `~/pet-llama.log`
on the Pi. The Pi needs the `pi-service` binary at `~/pi-service` (see `scripts/build-pi.sh`);
model and paths can be changed with env vars at the top of `scripts/pi-run.sh`.

### On Windows

Same thing, with `scripts\run.cmd` (a wrapper for `scripts\run.ps1`). It needs Node.js and the
OpenSSH client (built into Windows 10/11; Settings > Optional features if missing).

```powershell
scripts\run.cmd
$env:PI_HOST = "edgelm@192.168.22.73"; scripts\run.cmd    # if edgelm.local does not resolve
```

Set up an SSH key once so ssh does not need to ask for a password mid-run:

```powershell
ssh-keygen -t ed25519                                  # press Enter through the prompts
type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh edgelm@edgelm.local "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys"
```

On Windows the Pi-side log is on the Pi at `~/pet-run.log` (the script prints its last lines if the
Pi side fails to start).

## Chat bridge

The web app's chatbox talks to the Pi through the Vite proxy (`/v1/*` -> `PI_URL`).

| Endpoint | Request | Response |
|---|---|---|
| `GET /v1/health` | | `{status, service, version, llama_configured}` |
| `POST /v1/chat` | `{"message": "..."}` (1 to 200 chars) | `{"reply": "...", "source": "llama" \| "mock"}` |

Errors are `{"error": "..."}`: `400` for an empty or too-long message, `502` if llama-server
did not answer.

`pi-service` forwards the message to llama-server's OpenAI-style `/v1/chat/completions` when
`LLAMA_URL` is set, and returns a mock reply otherwise, so the whole chain can be tried with no Pi
and no model:

```bash
cargo run -p pi-service                                  # mock replies
LLAMA_URL=http://127.0.0.1:8081 cargo run -p pi-service  # real model
npm run web                                              # chatbox at http://localhost:5173
```

## Privacy

Visitor questions are logged **on the laptop only**, to `logs/interactions.jsonl`
(git-ignored). The Pi never stores typed text.
