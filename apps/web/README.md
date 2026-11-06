# apps/web

Game UI for the pet (React + Tailwind + zustand + pixi.js). Runs on the laptop and talks to
`pi-service` through the Vite proxy (`/v1/*`). Start it from the repo root with `npm run web`
(see the root README for `PI_URL` and `scripts/run.sh`).

## Screen

Pet's answer above the character, text input below it, benchmark panel in the top-right corner.

## Game rules

Two stats, `energy` and `happiness` (0 to 100). All numbers are in `src/game/rules.ts`.

- A visitor message costs energy and adds happiness. Over time happiness decays; after
  `restAfterSec` of quiet the pet rests and energy recovers.
- The pet's expression comes from the stats (`emotionFor`), not from the LLM.
- `buildStyleHint` turns the stats into extra system-prompt text, for example
  `"You are a bit tired. Keep your answers short."` (empty in a normal mood).

## API used

| Call | Notes |
|---|---|
| `GET /v1/health` | polled every 2 s; drives the connected/disconnected state |
| `POST /v1/chat` | `{ "message": "...", "style_hint": "..." }` -> `{ "reply", "source" }` |

**`style_hint` is new.** `pi-service` ignores unknown fields today, so nothing breaks, but the
rule-based prompt has no effect until the service uses it. It should append the hint to the system
prompt *after* the static prefix, so llama.cpp can still reuse the cached prefix.

The benchmark panel always shows source, response time and reply length (measured in the browser).
These rows appear only when `/v1/health` includes the field: `model`, `tok_per_sec`,
`cpu_temp_c`, `ram_free_mb`.

Interactions are still logged to `logs/interactions.jsonl` through `/__log`, now with
`style_hint`, `energy` and `happiness` added.

## Text-to-speech (not wired yet)

`src/audio/tts.ts` expects the laptop to serve `GET /__tts?text=...` returning audio (for example
an edge-tts middleware in `vite.config.ts`, next to `/__log`). Until that exists, TTS switches
itself off after the first attempt and the pet only moves its mouth. When audio does play, the
mouth follows its loudness.

## Tests

`npm test` runs the rules tests (`src/game/rules.test.ts`).
