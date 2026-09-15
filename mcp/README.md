# ClipmivoAI MCP

`list_assets` accepts optional `limit` (1–200) and `cursor`. Use the returned
`data.next_cursor` to request the next page until null. Omitting parameters keeps
the default list behavior. Requires `video:read`; no generation or charge occurs.

`list_assets` 支持可选 `limit`（1–200）和 `cursor`；使用返回的
`data.next_cursor` 查询下一页，直到 null。不传参数保持默认行为。
需要 `video:read` 权限，不创建生成任务或扣费。

`get_upload` reads an owned upload's status with `video:read`. When an upload
response is lost, `upload_asset` errors preserve `upload_id` and identify
`get_upload` as the recovery tool. No automatic upload retry occurs; use the
completed asset returned by the status endpoint. Upload credentials are never
included in this error metadata.

`get_upload` 使用 `video:read` 查询本账户上传状态。上传响应丢失时，
错误保留 `upload_id` 和恢复工具名称；不会自动重复上传。查询已完成时复用
返回素材，错误信息不包含上传凭证。

Local stdio MCP server for clients that launch an MCP command, including desktop
coding assistants. It uses the same scoped API key and validated CLI as the
website. This package is not a hosted HTTP/OAuth connector URL.

## Install and connect

Requires Node.js 22 or newer and npm:

```sh
npm install -g https://github.com/BarneyD66/clipmivo-tools/releases/download/v0.1.1/clipmivo-mcp-0.1.8.tgz
clipmivo-mcp --version
```

Create a scoped key in the website API / CLI (Developer) workspace. Read tools need video:read;
quote_video and generation/callback changes need video:write; uploads need files:write.
A quote does not charge credits, but it uses the write-scoped quote endpoint. Store the
key using your MCP client's secret settings. Do not place real keys in Git or
share configuration files containing them.

Example client configuration (replace placeholders; adapt to your client's format):

```json
{
  "mcpServers": {
    "clipmivo": {
      "command": "clipmivo-mcp",
      "env": {
        "CLIPMIVO_API_KEY": "YOUR_SCOPED_API_KEY",
        "CLIPMIVO_FILES_DIR": "/absolute/path/to/your/video-files"
      }
    }
  }
}
```

On Windows, use an existing directory such as `C:/Users/you/Videos/Clipmivo`.
If the client cannot resolve npm command shims, configure `node` with the absolute
installed `@clipmivo/mcp/bin/clipmivo-mcp.mjs` path as its argument.
`CLIPMIVO_API_URL` optionally selects a trusted HTTPS deployment (HTTP loopback
is accepted for local tests). The server never accepts keys or API origins as
tool arguments. No files directory means upload/download tools stay disabled.

## Workflow and spending

1. List models and read credit_balance.
2. Call quote_video with a supported request. For example: model
   `seedance-2.0-mini-text-to-video`, duration 4, quality 480p, aspect_ratio 16:9,
   generate_audio false and an English prompt.
3. Review the returned credits with the user. Call create_video only with the
   approved `accepted_credits` and a unique `idempotency_key`.
4. Poll get_video or wait_video. Download only when the task succeeds.

The confirmed amount is passed as quoted_credits; the server rejects changed
prices. There is no automatic paid retry. After an uncertain response, reuse the
same request, accepted credits and idempotency key. A timeout/cancellation is not
proof that a paid submission failed. Inspect tasks and preserve the original key.
All videos for the ClipmivoAI showcase are intended for English-speaking audiences.

## Tools

| Area | Tools |
|---|---|
| Capabilities and pricing | list_models, credit_balance, quote_video |
| Generation | create_video, get_video, list_videos, wait_video |
| Files | upload_asset, download_video |
| Callbacks | list_callbacks, create_callback, verify_callback, disable_callback, callback_deliveries, retry_callback |

Uploads are restricted to real paths under CLIPMIVO_FILES_DIR, including symlink
resolution. Downloads accept only new .mp4 filenames in that directory and do
not overwrite files. After an interrupted download, inspect any local partial
files before removal; use a new filename to retry. Video/audio upload duration
is declared metadata, not a server-attested probe.

Callback hosts must already be approved and endpoints verified. create_callback
returns its signing secret once: place it in your receiver's secret manager.
Signed notifications can be repeated, so receivers must deduplicate event IDs.
The service supports at most four concurrent local CLI operations. wait_video
waits up to 55 seconds; continue querying the same task after wait_timeout.
Uploads allow up to 160 seconds for reservation and transfer; client cancellation
still stops the local operation immediately. There is no automatic upload retry.

## 中文说明

这是供桌面 MCP 客户端启动的本地 stdio 服务，不是可直接粘贴到云端应用的
HTTP/OAuth 地址。安装后配置网站创建的专用 API 密钥；读操作需要 video:read，
报价、生成及回调配置需要 video:write，上传需要 files:write。报价不扣点数，
但报价接口仍需写权限。上传最多等待 160 秒，支持取消，不会自动重试。
不要将实际密钥提交到 Git。

先调用 quote_video，确认用户接受点数后，才调用 create_video，并提供
accepted_credits 与唯一 idempotency_key。提交响应不明时保持原请求、原点数、
原幂等键；超时或取消不等于任务失败，也不能据此换键再次生成。
使用 get_video/wait_video 查询同一任务，成功后再下载。展示视频使用英文内容。

文件工具必须配置已有的 CLIPMIVO_FILES_DIR，只能上传该目录内的文件；符号
链接不能逃出目录。下载仅接受新的 mp4 文件名，不覆盖已有文件。回调需已获准的
域名和已验证地址，接收端需持久化去重。回调签名密钥仅返回一次，存入接收端的
密钥管理器。账户隔离、余额、限流和权限检查仍由线上 API 执行。

## Reference assets / 参考素材

`list_assets` and `get_asset` read your private reference library. `download_asset` saves an original media file inside `CLIPMIVO_FILES_DIR`, using a new filename with a supported media extension. `delete_asset` requires explicit user intent and `files:write`; active generations can block deletion. These tools do not submit paid generations.

`list_assets`、`get_asset` 查看本人素材，`download_asset` 将原文件保存到配置目录中的新文件名；`delete_asset` 仅在用户明确要求时删除素材，且需要 `files:write`。正在进行的生成任务可能阻止删除。这组工具不会发起付费生成。

## Usage summary / 用量汇总

MCP 0.1.6 adds the read-only `get_usage` tool (21 tools total). Optional integer `from`/`to` values select a creation-time window in Unix seconds, maximum 31 days, default last 30 days. Task counts and settled credits are account-wide and exclude drafts/deleted tasks; current-key calls are lifetime totals. This is not a per-key billing report. Requires `video:read` and uses CLI 0.2.6.

MCP 0.1.6 新增只读工具 `get_usage`，共21个工具。可选整数参数 `from`/`to` 按 Unix 秒指定任务创建时间区间，最多31天，默认最近30天。任务数量和已结算积分是账号汇总，排除草稿及已删除任务；当前密钥调用次数是累计值，不是密钥账单。需 `video:read` 权限，依赖 CLI 0.2.6。
