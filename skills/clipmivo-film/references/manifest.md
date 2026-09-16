# Project manifest and recovery

See `examples/film.json` for a complete video-only example. Version 1 fields:

| Field | Meaning |
| --- | --- |
| `id`, `title`, `version` | Stable production identifier, display name, schema version 1 |
| `aspect_ratio`, `quality` | `16:9`/`9:16` and exact live video catalog quality |
| `target_seconds` | Optional; must equal the sum of shot durations |
| `budget_credits` | Authorized cumulative generation reservation ceiling; integer API Credits, not dollars |
| `preference` | economy, balanced or quality; see selection limitation below |
| `preferred_models` | Optional ordered public model IDs, used for balanced/quality |
| `characters` | Optional `{id, description, asset_url}` list; asset_url must be an owned Clipmivo image |
| `shots` | 1–120 shots, each with unique `id`, `prompt`, integer `duration`, `mode` |
| Per-shot options | `model` pins exact model; `character_ids`, `image_urls`, `generate_audio`, `caption`, `revision` |

Modes are `text-to-video`, `image-to-video`, `reference-to-video`. Reference URLs must point to the configured Clipmivo origin's owned asset file routes. Use existing CLI `upload` or the website's upload tool; sharing a character ID alone does not create a reference image. Character and shot identifiers are local to this project in the preview, not cloud project IDs.

Discovery filters workflows, reference capacity, quality-specific duration, aspect ratio, prompt length and audio control. Then it quotes each compatible candidate. A catalog entry is not proof that its price/model is enabled; unquotable candidates are recorded and excluded. There are no invented benchmark scores or hardcoded vendor prices. Explicit quality preferences require an ordered model list; otherwise selection is price-based.

`project.json` stores the original request, quote, idempotency key, task ID and conservative reservation ledger. It contains prompts/private asset references; keep it private. `.film.lock` prevents two local processes writing the same state. If a process crashes, verify its PID stopped before manually removing the lock. Never run multiple copies of a project against the same account concurrently.

`run` without `--submit` only queries existing task IDs. With `--submit`, it starts unsubmitted jobs; it stops on failures/review states. After uncertain submission, explicitly repeat the saved request via `--recover-uncertain`. Accepted tasks do not receive new requests. A final refund does not automatically lower this conservative local budget: use a new explicitly authorized cumulative ceiling if necessary.

If a definite rejection such as `quote_changed` requires a new payload, first establish that no task was accepted, change that shot's revision and re-plan. The old uncertain reservation stays in the ledger. Do not resolve uncertainty by deleting state. There is no automatic paid retry or model fallback after submission.

Downloaded `timeline.json` has `{version:1, aspect_ratio, clips:[{id,file,duration,caption}]}`. Paths can be absolute or relative to the timeline. Optional `in` selects the source offset. Output is 1080p at 30000/1001 fps; boundaries are quantized cumulatively to avoid per-clip drift. Original source audio is retained unless `mute_source_audio:true`. Static captions are burned in and also exported as SRT. Set `font_family` to an installed font with the required language glyphs.

Optional audio: `"audio":[{"file":"/absolute/narration.wav","role":"Narration","at":0,"duration":12,"volume":1},{"file":"/absolute/music.wav","role":"Music","at":0,"duration":12,"volume":0.15}]`. These are existing user-supplied/generated files, not automatic TTS. Tracks must fit the timeline; no implicit looping, ducking or cut extension. Keep all sources alongside the MLT when moving a project, or relink them in Shotcut.
