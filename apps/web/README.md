# apps/web

Game UI for the pet (React + Tailwind + zustand + pixi.js). Runs on the laptop and talks to
`pi-service` through the Vite proxy (`/v1/*`). Start it from the repo root with `npm run web`
(see the root README for `PI_URL` and `scripts/run.sh`).

## Screen

Bubble above the character, benchmark panel top-right, and one bottom dock holding the care
buttons + draggable treat, the text input, and the rotating question chips under it.

## Skins

`game/skin.ts` reads `?skin=` once and hands `PetCanvas` a scene class. The orb
(`game/orbScene.ts`, navy + gold, dark overlays) is the default; `?skin=pet` selects the
original `game/scene.ts` with its mint page and light panels. `strings.ts` keeps a
byte-identical `BASE` and merges orb-only wording when `isOrb`, and `index.css` scopes all
dark theming to `.skin-orb`.

## Game rules

Two stats, `energy` and `happiness` (0 to 100). All numbers are in `src/game/rules.ts`.

- A visitor message costs energy and adds happiness. Over time happiness decays; after
  `restAfterSec` of quiet the pet rests and energy recovers.
- `applyCare` (Feed / Play / Sleep) and `applyTouch` (poke / treat) change the stats instantly.
- The pet's expression comes from the stats (`emotionFor`), not from the LLM. `Sleep` overrides
  it to sleepy for `sleepSec`.
- `buildStyleHint` turns the stats into extra system-prompt text, for example
  `"You are a bit tired. Keep your answers short."` (empty in a normal mood). `pi-service`
  accepts it but does not use it yet, to keep the prompt prefix byte-identical for the KV cache.

## Booth interactions

Nothing here calls the model, so reactions are instant even while a Pi reply is pending.
State lives in `src/game/store.ts`; animation cues are `Reaction` values with a growing `id`,
which `PetScene` watches once per frame.

| Thing | Where |
|---|---|
| Question chips | `components/QuestionChips.tsx`, `game/chips.ts` |
| Care buttons + treat drag | `components/CareBar.tsx`; hit test published by `game/petTarget.ts` |
| Poke / wiggle / yawn / wave | `components/PetCanvas.tsx`, `game/scene.ts` |
| Attract mode | `tick()` in `game/store.ts`; fires after `attractAfterSec`, repeats every `attractRepeatSec` |

**Chip guarantee:** every question in `game/chips.ts` is also in `data/eval/questions.json` with
the same `expect` fact id. `cargo test -p pet-core facts_eval` proves retrieval returns that
fact; `game/chips.test.ts` proves the fact is public. Adding a chip means adding it to the eval
set first.

Canned lines (`src/strings.ts`) rotate and go through `speak('...', 'id')`. `voice.play` stops
the previous clip so a canned line never talks over a reply. Browsers need one tap before any
audio plays.

## Minigame

`components/Minigame.tsx` replaces the whole screen while it is open; `App` unmounts the pet
and pauses its clock. Rules are a pure seeded simulation in `game/minigame/logic.ts`
(`createGame` / `startGame` / `stepGame`, normalised 0..1 coordinates, 13 tests);
`game/minigame/shooterScene.ts` is the Pixi view and input. Best score lives in
`localStorage['orb-minigame-best']`. Only offered in the orb skin.

## API used

| Call | Notes |
|---|---|
| `GET /v1/health` | polled every 2 s; drives the connected/disconnected state |
| `POST /v1/chat` | `{ "message": "...", "style_hint": "..." }` -> `{ "reply", "source", "fact_id", "lang" }` |
| `GET /__tts` | edge-tts audio from the Vite dev server, browser speech synthesis as fallback |
| `POST /__log` | one JSON line per interaction in `logs/interactions.jsonl` |

`kind` in the log is `chat`, `care` or `touch`. The benchmark panel always shows source, response
time and reply length (measured in the browser); telemetry rows appear only when `/v1/health`
includes the field.

## Tests

`npm test` runs `game/rules.test.ts`, `game/chips.test.ts` and `tts-endpoint.test.ts`.
`npm run typecheck` and `npm run build` are both part of CI.
