# Install and run the preview

Copy the entire `clipmivo-film` folder into the agent's skill directory. In Codex the default is `~/.codex/skills/clipmivo-film`. Reload skills. Other agents need filesystem access and local command execution; a plain chat or a remote MCP-only client is insufficient for local rendering. Never promise every Claude/Doubao interface supports this.

Dependencies:

- Node.js 22+ (API helper uses built-in fetch; no npm dependencies).
- Python 3.10+ and the CLI-Anything Shotcut adapter. Upstream source: https://github.com/HKUDS/CLI-Anything/tree/main/shotcut . Follow the upstream installation instructions for the platform; the adapter package is separate from the Shotcut application.
- Shotcut/MLT rendering runtime, ffmpeg and ffprobe. Install from the respective official projects. `python -m cli_anything.shotcut.shotcut_cli --help` must work. For non-PATH ffprobe set `FFPROBE_PATH` to its executable. The Shotcut adapter must also locate its rendering dependencies.
- A ClipmivoAI scoped API key with video:read and video:write for generation. Existing CLI uploads require files:write. Set `CLIPMIVO_API_KEY` in environment/secret settings, not in skill files.

From the installed skill folder (substitute absolute project paths):

```sh
node scripts/film.mjs --help
node scripts/film.mjs plan --manifest /path/film.json --project /path/my-film
node scripts/film.mjs run --project /path/my-film --submit
node scripts/film.mjs run --project /path/my-film
node scripts/film.mjs collect --project /path/my-film
python scripts/edit.py --timeline /path/my-film/timeline.json --output /path/my-film/edit-v1
```

Planning makes read/quote requests but no paid submissions. Run with `--submit` only within the user's authorized budget. Quotes are API Credits, never multiplied by 100. `CLIPMIVO_API_URL` or `--api-url` may specify a trusted alternate deployment origin; an existing project stays pinned to its original origin. Never copy the production key into fixture test processes.

The helper uses `/api/open/v1`, matching the existing CLI's public workflow/model contract. Do not substitute the site's native `/api/v1` request shape.

The public image API and cloud editing are pending. Images and videos will use the same `CLIPMIVO_API_KEY`; no separate image key is planned. Existing owned character images work with video generation today; generating them from the same key is a separate backend integration milestone.
