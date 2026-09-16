# Install and run the preview

Copy the entire `clipmivo-film` folder into the agent's skill directory. In Codex the default is `~/.codex/skills/clipmivo-film`. Reload skills. Other agents need filesystem access and local command execution; a plain chat or a remote MCP-only client is insufficient for local rendering. Never promise every Claude/Doubao interface supports this.

Platform status (2026-09-16):

| Client | Installation and verification status |
| --- | --- |
| Codex local | Copy to `~/.codex/skills/clipmivo-film`. Local Windows fixture pipeline and actual Shotcut rendering tested. Production paid generation is not yet accepted. |
| Claude Code local / Desktop Code local session | Copy to the project's `.claude/skills/clipmivo-film`; install the same local dependencies. Official [skills documentation](https://code.claude.com/docs/en/skills) describes this format. This package has not been tested in Claude Code. |
| WorkBuddy | Import the complete skill folder/package through its [Skills interface](https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Skills-Market). Local script/API support is documented; this package and rendering dependencies still require platform testing. |
| Doubao workbench | Custom skill/API/local execution support for the specific product version is unverified. Do not advertise this package as tested or give invented installation paths. |

An ordinary web chat's ability to read SKILL.md does not establish permission to run local Node/Python/Shotcut. Keep the same core package and provide client-specific installation; no provider-specific keys are required beyond the one Clipmivo key.

Dependencies:

- Node.js 22+ (API helper uses built-in fetch; no npm dependencies).
- Python 3.10+ and the CLI-Anything Shotcut adapter. Upstream source: https://github.com/HKUDS/CLI-Anything/tree/main/shotcut . Follow the upstream installation instructions for the platform; the adapter package is separate from the Shotcut application.
- Shotcut/MLT rendering runtime, ffmpeg and ffprobe. Install from the respective official projects. `python -m cli_anything.shotcut.shotcut_cli --help` must work. For non-PATH ffprobe set `FFPROBE_PATH` to its executable. The Shotcut adapter must also locate its rendering dependencies.
- A ClipmivoAI scoped API key with video:read and video:write for video generation, plus image:read and image:write when generating reference images. Existing CLI uploads require files:write. Set `CLIPMIVO_API_KEY` in environment/secret settings, not in skill files.

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

Images and videos use the same `CLIPMIVO_API_KEY`. For a manifest with generated character images, the first plan/run handles references. Once it reports references_ready, re-run plan with the same manifest and project, inspect the video quote, then run the video stage. Both stages share the manifest's cumulative budget. Cloud editing remains unavailable; rendering uses the local runtime above.
