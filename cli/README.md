# ClipmivoAI CLI

Asset pagination: `clipmivo assets --limit 20` returns `data.next_cursor`.
Pass it as `--cursor VALUE` for the next page until it is null. Limit: 1–200,
default 200. Pages are ordered newest first, with stable ordering for equal timestamps.
This is not a snapshot across concurrent changes.

素材分页：`clipmivo assets --limit 20` 返回 `data.next_cursor`，将其作为
`--cursor VALUE` 继续查询，直到返回 null。每页 1–200 条，默认 200 条。
按创建时间倒序，同时间素材顺序稳定；不保证跨并发变更的快照一致性。

Upload recovery: if the final upload response is lost, the CLI returns
`error.upload_id` and `error.recovery_command` without replaying the upload.
Run `clipmivo upload-status UPLOAD_ID` using a key with `video:read`. Reuse the
returned asset when status is `complete`; do not submit another upload while it
is `uploading`. A purged status record does not prove that an asset was deleted.
No upload token is included in recovery errors. This is response recovery, not
resumable byte transfer.

上传响应丢失时，CLI 会返回上传编号和查询命令，不会重传文件。
使用含 `video:read` 权限的密钥执行 `clipmivo upload-status UPLOAD_ID`；
complete 时复用返回的素材，uploading 时不要重复上传。状态记录被清理并不
意味着素材被删除。错误信息不会包含上传凭证；这不是断点续传。

Requires Node.js 22 or newer. Install the published package:

```sh
npm install -g https://github.com/BarneyD66/clipmivo-tools/releases/download/v0.1.0/clipmivo-cli-0.2.6.tgz
clipmivo --help
clipmivo --version
```

Set `CLIPMIVO_API_KEY` in your shell/secret manager. Obtain a scoped key in the
website's Developer area after signing in. Never put the key in a request JSON,
Git, screenshots or support messages. The CLI never saves it. `config show`
reports only whether a key is present. Availability and pricing depend on the
chosen model/settings; obtain a live quote before creating a task.

```sh
clipmivo config show
clipmivo models --json
clipmivo balance --json
clipmivo upload --file ./product.png --json
clipmivo quote --file ./request.json --json
# Prepare quoted-request.json using the confirmation step below.
clipmivo generate --file ./quoted-request.json --idempotency-key campaign-shot-001 --wait --timeout 600 --json
clipmivo jobs --limit 20 --json
clipmivo get TASK_ID --json
clipmivo wait TASK_ID --timeout 600 --json
clipmivo download TASK_ID --output ./result.mp4 --json
```

Request example (check `models` for current capabilities and `quote` before use):

```json
{
  "model": "seedance-2.0-mini-text-to-video",
  "prompt": "A paper boat drifts across a calm pond in warm morning light.",
  "duration": 4,
  "quality": "480p",
  "aspect_ratio": "16:9",
  "generate_audio": false
}
```

### Confirm a quote before submission

The following Bash/Node.js step chooses a maximum of 7 credits as an example.
Set your own maximum before running it. It stops on a missing, failed or
over-limit quote and writes a new request containing `quoted_credits`. It never
overwrites an existing confirmed request. The API rejects a changed price with
`quote_changed`; review a fresh quote instead of silently accepting a higher one.

```sh
set -euo pipefail
export CLIPMIVO_MAX_CREDITS=7
clipmivo quote --file ./request.json --json > quote.json
node --input-type=module <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
const quote = JSON.parse(readFileSync('quote.json', 'utf8'));
const maximum = Number(process.env.CLIPMIVO_MAX_CREDITS);
const credits = quote.data?.credits_to_hold;
if (!quote.success || !Number.isSafeInteger(maximum) || maximum < 1 ||
    !Number.isSafeInteger(credits) || credits < 1 || credits > maximum)
  throw new Error('Quote unavailable or exceeds your maximum');
const request = JSON.parse(readFileSync('request.json', 'utf8'));
writeFileSync('quoted-request.json', JSON.stringify({ ...request, quoted_credits: credits }, null, 2), { flag: 'wx' });
NODE
clipmivo generate --file ./quoted-request.json --idempotency-key campaign-shot-001 --wait --timeout 600 --json
```

Choose a unique idempotency key for each new task. After a lost submit response,
keep the exact confirmed file and the same key; do not run the quote preparation
again or use a new key. Resume accepted tasks with `get`/`wait` instead.
Local source installation remains supported with `npm install -g ./cli`.

For image/reference workflows, use the same-origin owned media URL returned by
upload in `image_urls`/`video_urls`/`audio_urls`, and a supported model workflow.
Video/audio upload requires `--duration SECONDS`; this is declared metadata,
not a server-attested media probe. Maximum upload: 50 MiB. Images need no duration.

The default origin is `https://clipmivoai.com`. `--api-url` overrides
`CLIPMIVO_API_URL`, which overrides the saved `config set-url URL` value. Only
HTTPS origins and HTTP loopback development servers are accepted. Set
`CLIPMIVO_CONFIG_DIR` to isolate configurations. Changing an origin changes
where your configured key is sent; use only your trusted Clipmivo deployment.

All command results are JSON on stdout; `--json` is accepted for script clarity.
Errors are JSON on stderr. `generate --wait` writes the accepted task ID and
idempotency key to stderr before waiting, so an interrupted wait can be resumed.
Generation is never automatically resubmitted. For a lost submit response, reuse
the **same** idempotency key and **same** request; do not invent a new key.

| Exit | Meaning                                                       |
| ---- | ------------------------------------------------------------- |
| 0    | Command succeeded                                             |
| 1    | API/network/local operation error                             |
| 2    | Invalid arguments/configuration or output already exists      |
| 3    | Wait deadline reached; task may still be running              |
| 4    | Task failed, expired, was cancelled or requires manual review |

Downloads use authenticated streaming, reject redirects and refuse to overwrite
existing files. No payment command is included. Callback commands require a
deployment with callback dispatch enabled; direct R2 uploads remain incomplete.
Supported commands and parameters are defined by the ClipmivoAI API contract.

## 中文使用说明

安装后在环境变量 `CLIPMIVO_API_KEY` 中设置网站创建的 API 密钥。密钥不写入
配置文件；`config show` 只显示是否配置。`models` 查看模型能力，`upload` 上传
参考素材，`quote` 查询报价，`generate` 提交任务，`wait` 等待，`download` 下载。
可使用 `--api-url` 指定可信部署。所有结果为 JSON，适合脚本和自动化调用。

提交必须带 `--idempotency-key`。遇到网络中断，保留同一键和同一请求，避免重复
扣费；等待超时并不代表任务失败，可用任务 ID 再次 `wait`。下载不会覆盖现有文件。
模型与参数能否使用，以实时报价为准。支付功能不在本次范围。

提交前按上方步骤确认报价：示例最高接受 7 点，可自行设置
`CLIPMIVO_MAX_CREDITS`。脚本检查报价后生成新的 `quoted-request.json`，写入
`quoted_credits`，且不覆盖已有文件；提交时使用这个确认后的文件。价格发生变化
会返回 `quote_changed`，应重新审阅报价。网络中断后保留原文件和原幂等键，
不要重新准备报价或换键；已取得任务 ID 的任务使用 `get` 或 `wait` 继续查询。

Tests: `npm test --prefix cli` exercises the executable against an isolated HTTP
fixture, including uploaded/downloaded bytes, idempotency, redirect rejection,
no automatic paid retry, wait timeout/failure, and secret-safe errors.

## Callbacks (0.2.0)

The server implementation supports endpoint registration, signed ownership
challenges, encrypted secrets and durable retries. Hosted signed callbacks
require an approved hostname and a verified endpoint. Check `callbacks` for
readiness; continue polling if your endpoint is not configured:

```sh
clipmivo callbacks
clipmivo callback-create --url https://your-allowed-host.example.com/events
clipmivo callback-verify ENDPOINT_ID
clipmivo callback-deliveries ENDPOINT_ID
clipmivo callback-retry ENDPOINT_ID DELIVERY_ID
clipmivo callback-disable ENDPOINT_ID
```

Registration returns a dedicated random secret once on stdout. Store it in your
receiver's secret manager. Configure your handler to verify signed requests as
below. For `type: "endpoint.verification"`, return the `challenge` string as the
exact plain response body (2xx) within ten seconds. Verification attempts are
limited to one per 30 seconds. Once verified, add `"callback_url"` with that exact
endpoint URL to your generation request. The URL participates in idempotency;
reuse the same request after a lost submit response.

Normal events are `video.succeeded`, `video.failed` or `video.needs_review`.
Their `data` contains task ID/status/credits/error/metadata. Read the task API for
current status and authenticated downloads. Delivery is at least once: duplicate
events are possible after a crash or a lost acknowledgement. Use durable event
ID deduplication. Retryable HTTP failures and network errors use bounded backoff,
at most eight attempts per retry cycle. Manual retry keeps the same event ID and
body. Disabling an endpoint cancels queued work; an already in-flight HTTP
request may still arrive. Delivery history returns the latest 100 records.

### Webhook receiver verification

The package includes the raw-byte signature verifier used by the server.
Keep task polling available if delivery is delayed or your endpoint is unavailable.

```js
import { verifyWebhook } from '@clipmivo/cli/webhooks';

// Framework Request: read raw bytes BEFORE any JSON/body-parser middleware.
const raw = new Uint8Array(await request.arrayBuffer());
const verified = await verifyWebhook({
  body: raw,
  headers: request.headers,
  secret: process.env.CLIPMIVO_WEBHOOK_SECRET,
});
const event = JSON.parse(new TextDecoder().decode(verified.body));
// Validate event schema and account context. In a durable transaction, insert
// verified.eventId with a UNIQUE constraint and enqueue work only if inserted.
// Respond 2xx only after that transaction commits; duplicates can receive 2xx.
```

Enforce a 64 KiB request limit at the receiver before buffering. Use a dedicated
random secret with at least 32 bytes, never your API key. Verification signs
`webhook-id + "." + webhook-timestamp + "." + raw_body` with HMAC-SHA256.
The `webhook-signature` header is `v1=` followed by 64 lowercase hex characters.
Event IDs have the form `evt_` followed by 16–100 letters, digits, `_` or `-`.
Timestamp seconds must be within 300 seconds of the receiver clock, including
future skew. Synchronize clocks. An optional `previousSecret` supports rotation;
remove it after the delivery retry window closes. Verification failures use
`WebhookVerificationError` and never include raw bodies or secrets.

Timestamp checks limit replay age; they do **not** prevent duplicate processing
inside that window. Store the authenticated event ID durably. Never fetch URLs
or trust business fields solely because a JSON body contains them; authenticate
first and validate the event schema. Retry deliveries retain event ID and body
but should receive fresh timestamp/signature pairs.

### 中文：回调验签

`@clipmivo/cli/webhooks` 提供接收端验签工具；线上回调需要已获准的域名和
已完成验证的接收地址。使用 `callbacks` 查询状态；尚未配置或通知延迟时继续
轮询任务。CLI 已提供端点注册、验证、记录查询、失败重试和停用
命令。注册密钥仅返回一次，请存入接收端密钥管理器。收到 `endpoint.verification`
消息时，先验签，再于十秒内原样返回 `challenge` 字符串；验证成功后将端点地址
放入生成请求的 `callback_url`。先限制请求大小，再读取原始字节并验签，成功后才解析 JSON。
使用独立随机密钥，不要复用 API Key。验签会检查消息内容、事件 ID 和时间戳，
并拒绝超过前后 300 秒的请求。签名有效不代表没有重复通知：必须使用数据库
唯一约束持久化事件 ID，并在事务内入队，提交后再回复成功，避免重复业务操作。

### Upload errors / 上传错误

CLI 0.2.4 preserves known upload error codes such as `invalid_media_duration`, `upload_size_mismatch`, and `upload_expired`, together with HTTP status and upload ID. Use `upload-status` to inspect the reservation. Correct the file or declared duration before starting a new upload; the CLI never automatically retries the transfer. Unrecognized server errors remain `upload_failed`, and private server messages are not printed.

CLI 0.2.4 会返回明确的时长不符、文件大小不符或上传过期错误，并保留 HTTP 状态和上传编号。可用 `upload-status` 查询；修正文件或时长后再发起新上传。客户端不会自动重传，也不会输出服务端私密错误详情。

## Manage reference assets / 管理参考素材

```sh
clipmivo assets
clipmivo asset-get ASSET_ID
clipmivo asset-download ASSET_ID --output reference.png
clipmivo asset-delete ASSET_ID
```

Listing, metadata and downloads require `video:read`; deletion requires `files:write`. Use the real asset ID returned by upload or listing. Downloads stream the original bytes and refuse overwriting existing files. Deletion removes the reference and queues physical cleanup; active generations may block deletion. It does not delete a generated video.

列表、详情和下载需要 `video:read`，删除需要 `files:write`。使用上传或列表返回的真实素材编号。下载保留原始文件且不会覆盖已有文件；删除会移除素材并排队清理文件，正在生成的任务可能阻止删除。该命令不会删除生成的视频作品。

## Usage summary / 用量汇总

CLI 0.2.6: `clipmivo usage` queries the last 30 days. Optional `--from` and `--to` use Unix seconds, inclusive start and exclusive end, at most 31 days. Account task totals exclude drafts and deleted tasks; settled credits exclude failed and pending tasks. The current key's call count is lifetime usage, not usage in the requested period. Results are not a per-key bill. Requires `video:read`; no generation is submitted.

`clipmivo usage` 默认查询最近30天，可用 `--from` 和 `--to` 指定 Unix 秒，含起点、不含终点，最多31天。账号任务统计排除草稿和已删除任务，已结算积分排除失败及待处理任务。密钥调用次数为累计值，不是所选时段内用量，也不是按密钥计费账单。需 `video:read` 权限，不触发生成。
