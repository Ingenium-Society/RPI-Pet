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
| `crates/pet-core` | pure library: facts schema, language detection, retrieval, prompt builder, validator, (later) mock generator |
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
| `GET /v1/health` | | `{status, service, version, llama_configured}` plus, when measurable: `llama_up`, `model`, `tok_per_sec`, `cpu_temp_c`, `ram_free_mb`, `throttled` |
| `POST /v1/chat` | `{"message": "..."}` (1 to 200 chars) | `{"reply", "source", "fact_id", "lang"}` |

`source` says where the reply came from:

| `source` | Meaning |
|---|---|
| `llama` | a public fact matched, the model phrased it, and the answer passed validation |
| `fallback` | a fact matched, but the model failed, timed out or broke the rules, so the fact's pre-written `fallback_line` was used |
| `deflect` | no public fact matched; the pet says it does not know (the model is not called) |
| `mock` | no model configured (`LLAMA_URL` unset); the fact's `fallback_line` is used |

Errors are `{"error": "..."}`: `400` for an empty or too-long message. A model that is down is
not an error for the visitor: they get the `fallback` line, and `/v1/health` shows `llama_up: false`.

How a question is answered (`crates/pet-core` does the work, `pi-service` calls it):
detect the language -> retrieve the best **public** fact -> build the prompt from
`data/prompts/prefix.{id,en}.txt` + that one fact + the question -> llama-server `/completion`
(stops at the first newline) -> validate the answer (length, no breaking character, every
`must_contain` anchor present) -> use it, or else the `fallback_line`.

Facts and prompt prefixes are compiled into the `pi-service` binary, so the Pi only needs that one
file (rebuild after editing `data/`). To try edited data without rebuilding, point `DATA_DIR` at a
`data/` folder. The game's `style_hint` (mood text) is accepted but not used yet: the prompt prefix
must stay byte-identical for llama.cpp's prompt cache.

The whole chain can be tried with no Pi and no model:

```bash
cargo run -p pi-service                                  # facts only, no model
LLAMA_URL=http://127.0.0.1:8081 cargo run -p pi-service  # real model
DATA_DIR=data cargo run -p pi-service                    # load facts/prompts from disk
npm run web                                              # chatbox at http://localhost:5173
```

## Booth interactions

These live in the web app and need no Pi and no model. They react instantly; only a typed or
chipped question goes to the Pi (and takes seconds).

| Thing | What it does |
|---|---|
| Question chips | Three short Indonesian questions under the chat box, rotating every 9 s and after each tap. One tap sends the question. Every chip is also in `data/eval/questions.json` with the same `expect` fact id, and `apps/web/src/game/chips.test.ts` checks that fact is public — a tap cannot end in a deflection. Chips are disabled while offline or busy. |
| Poke | Tap the pet: wiggle, giggle, happiness up, canned line. |
| Treat | Drag the biscuit from the care bar onto the pet: bigger giggle and a larger stat boost. Pointer events, so it works on a touchscreen. |
| Feed / Play / Sleep | Change energy and happiness, say a canned line. Sleep also closes the eyes for 3.5 s. |
| Attract mode | After 30 s with no interaction the pet yawns, waves and asks "Mau tahu soal klub?", then repeats every 25 s until somebody touches it. |

Care and touch actions are logged to `logs/interactions.jsonl` with a `kind` field (`chat`,
`care`, `touch`). Canned lines use the same TTS cache as replies, so they play instantly once
warmed. **Browsers block all audio until the first click or tap on the page** — tap once after
loading at the booth to unlock the attract-mode voice.

## Voice (text-to-speech)

The pet speaks each reply. The Vite dev server on the laptop provides `GET /__tts?text=...&lang=id|en`
(`apps/web/tts-endpoint.ts`), which returns audio from Microsoft Edge's neural voices through the
`node-edge-tts` package.

- **Needs internet on the laptop**, but only the first time a line is spoken: every clip is cached
  in `logs/tts-cache`, and the pet's canned lines repeat a lot, so they then work offline and play
  instantly. To pre-load them at the venue, ask each question once while online.
- **It is not an official public API** (no API key, but Microsoft can change or limit it). If the
  project outgrows a school demo, Azure AI Speech offers the same voices officially.
- **If it fails** (no internet, service down) the page uses the browser's built-in voice for that
  reply, which works offline but sounds rougher. Browsers need one click or tap on the page
  before they will play any sound.
- **Voices:** deep male defaults, Indonesian `id-ID-ArdiNeural`, English `en-US-ChristopherNeural`,
  both pitched down `-14Hz` and slowed `-4%` so the delivery is low and flat rather than chirpy.
  Override the voices with `TTS_VOICE_ID` / `TTS_VOICE_EN` and the prosody with `TTS_PITCH` /
  `TTS_RATE` (SSML units, e.g. `TTS_PITCH=-24Hz TTS_RATE=-10% npm run web`; `+0Hz` for neutral).
  Edge's neural voices cannot do a true vocoder effect, so "robotic" here means deep and even,
  not a ring-modulated robot.
- **Changing any of that re-synthesises the cache:** the clip key includes voice, pitch and rate,
  so old clips are ignored and the first play after a change needs internet again.
- Like the interaction log, this endpoint exists in the dev server and `vite preview`, not in a
  static build.

## Privacy

Visitor questions are logged **on the laptop only**, to `logs/interactions.jsonl`
(git-ignored). The Pi never stores typed text.
