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
| `characters` | Optional `{id, description, asset_url}` for existing owned images, or `{id, description, image}` for generated references; do not supply both |
| `shots` | 1–120 shots, each with unique `id`, `prompt`, integer `duration`, `mode` |
| Per-shot options | `model` pins exact model; `character_ids`, `image_urls`, `generate_audio`, `caption`, `revision` |

Modes are `text-to-video`, `image-to-video`, `reference-to-video`. Reference URLs must point to the configured Clipmivo origin's owned asset file routes. Use existing CLI `upload` or the website's upload tool; sharing a character ID alone does not create a reference image. Character and shot identifiers are local to this project in the preview, not cloud project IDs.

For a generated reference, use `"image":{"prompt":"Character portrait description","ratio":"1:1","resolution":"1K","quality":"standard"}`. Settings must match a currently available image profile; no implicit quality or resolution substitutions occur. Optional `model` pins a model; `preferred_models` supplies an ordered choice, otherwise the least expensive compatible live quote wins. Optional `asset_ids` supplies existing owned image references only if the catalog advertises that reference profile. An `image.revision` change requests a new attempt while retaining previous reservations.

The initial reference-stage plan covers image costs only, not the final video quote. After `run --submit` and subsequent polling report references_ready, inspect the images in the website's library, then re-run plan with the original manifest. The script binds their owned asset IDs and quotes videos. Image and video historical submissions share one cumulative budget; if the remaining budget cannot cover the video plan, no video is submitted. Increasing the ceiling requires user authorization. Do not delete image history or copy only the asset URLs into a new project to evade that ledger.

Discovery filters workflows, reference capacity, quality-specific duration, aspect ratio, prompt length and audio control. Then it quotes each compatible candidate. A catalog entry is not proof that its price/model is enabled; unquotable candidates are recorded and excluded. There are no invented benchmark scores or hardcoded vendor prices. Explicit quality preferences require an ordered model list; otherwise selection is price-based.

`project.json` stores the original request, quote, idempotency key, task ID and conservative reservation ledger. It contains prompts/private asset references; keep it private. `.film.lock` prevents two local processes writing the same state. If a process crashes, verify its PID stopped before manually removing the lock. Never run multiple copies of a project against the same account concurrently.

`run` without `--submit` only queries existing task IDs. With `--submit`, it starts unsubmitted jobs; it stops on failures/review states. After uncertain submission, explicitly repeat the saved request via `--recover-uncertain`. Accepted tasks do not receive new requests. A final refund does not automatically lower this conservative local budget: use a new explicitly authorized cumulative ceiling if necessary.

The HTTP client spaces writes by at least 6.1 seconds and reads by 1.1 seconds per media/scope, and honors an exhausted response bucket's reset time. This is per process, not an account-wide scheduler: other clients sharing the key can still consume the server quota. A run refreshes outstanding historical tasks before submitting and admits at most three locally active video jobs. Re-run after completion to admit remaining shots. An explicit rate/concurrency rejection of a new submission pauses with `paused_reason`, preserving its request/key for the next run. A rejection while recovering an earlier uncertain submission does not clear that earlier reservation. No command automatically retries a paid request.

If a definite rejection such as `quote_changed` requires a new payload, first establish that no task was accepted, change that shot's revision and re-plan. The old uncertain reservation stays in the ledger. Do not resolve uncertainty by deleting state. There is no automatic paid retry or model fallback after submission.

Downloaded `timeline.json` has `{version:1, aspect_ratio, clips:[{id,file,duration,caption}]}`. Paths can be absolute or relative to the timeline. Optional `in` selects the source offset. Output is 1080p at 30000/1001 fps; boundaries are quantized cumulatively to avoid per-clip drift. Original source audio is retained unless `mute_source_audio:true`. Static captions are burned in and also exported as SRT. Set `font_family` to an installed font with the required language glyphs.

Optional audio: `"audio":[{"file":"/absolute/narration.wav","role":"Narration","at":0,"duration":12,"volume":1},{"file":"/absolute/music.wav","role":"Music","at":0,"duration":12,"volume":0.15}]`. These are existing user-supplied/generated files, not automatic TTS. Tracks must fit the timeline; no implicit looping, ducking or cut extension. Keep all sources alongside the MLT when moving a project, or relink them in Shotcut.
