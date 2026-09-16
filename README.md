# ClipmivoAI developer tools

Create AI videos through the ClipmivoAI API, CLI, local MCP server or agent Skill. All clients use **https://clipmivoai.com/api/v1**, your scoped API key and your ClipmivoAI account balance.

English · [简体中文](docs/README.zh-CN.md) · [Website](https://clipmivoai.com) · [API guide](docs/API.md) · [OpenAPI](docs/openapi.json)

## Choose your interface

| Interface | Start here |
| --- | --- |
| REST API | [Authentication, quotes and task submission](docs/API.md) |
| CLI | [Install and use the CLI](cli/README.md) |
| MCP | [Connect a local stdio server](mcp/README.md) |
| Agent Skill | [clipmivo-video](skills/clipmivo-video/SKILL.md) |
| Multi-shot film preview | [clipmivo-film](skills/clipmivo-film/SKILL.md) |

Sign in at [ClipmivoAI](https://clipmivoai.com/?section=api), create a scoped key in the API / CLI (Developer) workspace and add credits through the website. Read operations require `video:read`, quotes and generation require `video:write`, and media uploads require `files:write`. API requests create video tasks; they do not purchase credit top-ups.

## Install

Requires Node.js 22+ and npm. Published downloads are hosted in GitHub Releases; these commands do not depend on an npm registry listing:

```sh
npm install -g https://github.com/BarneyD66/clipmivo-tools/releases/download/v0.1.1/clipmivo-cli-0.2.7.tgz
npm install -g https://github.com/BarneyD66/clipmivo-tools/releases/download/v0.1.1/clipmivo-mcp-0.1.8.tgz
clipmivo --version
clipmivo-mcp --version
```

Set `CLIPMIVO_API_KEY` using your shell or secret manager. Never put a real key into this repository. For development:

```sh
git clone https://github.com/BarneyD66/clipmivo-tools.git
cd clipmivo-tools
npm ci
npm test
node cli/bin/clipmivo.mjs models --json
```

## First video

```sh
clipmivo models --json
clipmivo balance --json
clipmivo quote --file examples/request.json --json
```

Review the current quote and confirm your spending limit. Follow the [CLI quote confirmation example](cli/README.md#confirm-a-quote-before-submission) to add `quoted_credits` to a separate request file, then submit:

```sh
clipmivo generate --file quoted-request.json --idempotency-key my-first-shot-001 --wait --timeout 600 --json
clipmivo get TASK_ID --json
clipmivo download TASK_ID --output result.mp4 --json
```

Keep the same confirmed request and idempotency key after an uncertain submission. A wait timeout is not a failed video; resume status queries instead of creating another task. Model options and prices can change: use live model discovery and quotes.

## Credit billing and your application

Show `credits_to_hold` directly as Credits; do not multiply an API credit quote by 100. Credits are reserved before generation, then settled using actual usage where applicable. Unused reserved credits return to the balance. The reference conversion is 100 Credits = US$1; top-ups are purchased separately on the website.

For a customer-facing app, keep the ClipmivoAI key on your server. Keys on one account share its balance and account-level resources; they are not isolated reseller subaccounts. See [application integration](docs/APPLICATIONS.md).

## MCP

Configure a client that supports local stdio MCP:

```json
{
  "mcpServers": {
    "clipmivo": {
      "command": "clipmivo-mcp",
      "env": {
        "CLIPMIVO_API_KEY": "YOUR_SCOPED_API_KEY",
        "CLIPMIVO_FILES_DIR": "/absolute/path/to/video-files"
      }
    }
  }
}
```

Store the real key in your client's secret settings. On Windows use an existing directory such as `C:/Users/you/Videos/Clipmivo`; see the [MCP guide](mcp/README.md) if your client cannot resolve command shims. This is a local server, not a hosted MCP OAuth endpoint.

## Skill

Copy `skills/clipmivo-video` into the skill directory supported by your agent. For Codex, use `~/.codex/skills/clipmivo-video`. Restart or reload skills, then ask:

> Use $clipmivo-video to create a video of a paper boat on a pond. Maximum generation spend: 25 Credits.

The Skill can use the installed MCP or CLI. It preserves existing budget authorization and requires a valid quote before paid submission. Installing the Skill does not create an API key or grant credits.

## Support

Use GitHub issues for reproducible client bugs without credentials or private media. Account, payment and billing questions: **contact@clipmivoai.com**. Service use remains subject to the website's terms and privacy policy.

This repository contains public client tools and documentation, not the website backend.

## Multi-shot film preview

The new [clipmivo-film skill](skills/clipmivo-film/SKILL.md) adds a local script-to-film workflow: live video capability/quote selection, a cumulative Credit budget, resumable per-shot jobs and Shotcut editing. See [installation and commands](skills/clipmivo-film/references/install.md).

Image and video generation use the same customer key with their respective scopes. The preview now plans character images, binds returned owned assets to dependent videos, and tracks both stages in one cumulative budget. It filters live capabilities and quotes; it is not a verified best-quality model recommender. Server-side creative model routing and cloud editing remain unavailable.

Local validation: 21 automated tests; an HTTP fixture covering image jobs, reference handoff, video jobs and authenticated downloads; actual Shotcut rendering of an 8-second labelled synthetic film with captions and audio. The earlier video-only fixture also rendered five minutes. These are technical test artifacts, not model-quality demonstrations. Real paid generation acceptance and Claude Code/WorkBuddy runtime testing remain pending. See the installation guide for platform status.

