# REST API quick start

Base URL: `https://clipmivoai.com/api/v1`. Authenticate with `Authorization: Bearer YOUR_SCOPED_API_KEY`. Full request and response schemas: [OpenAPI](openapi.json).

The examples below use Bash, curl and Node.js 22+. Set `CLIPMIVO_API_KEY` securely in your environment first. The API creates video-generation tasks charged to your ClipmivoAI balance; credit purchases take place on the website.

## Discover and quote

```sh
curl --fail-with-body https://clipmivoai.com/api/v1/models \
  -H "Authorization: Bearer $CLIPMIVO_API_KEY"

curl --fail-with-body https://clipmivoai.com/api/v1/credits/balance \
  -H "Authorization: Bearer $CLIPMIVO_API_KEY"

curl --fail-with-body https://clipmivoai.com/api/v1/videos/generations/quote \
  -H "Authorization: Bearer $CLIPMIVO_API_KEY" \
  -H 'Content-Type: application/json' \
  --data-binary @examples/request.json --output quote.json
```

Check `success` and `data.credits_to_hold`. Display this value directly in Credits without multiplying it by 100. This is the amount to reserve; usage-based models settle after generation, and unused reserved credits return to the balance. The reference conversion is 100 Credits = US$1. No task has been created by these calls.

## Confirm a maximum and submit

The following step enforces a sample maximum of 25 Credits (US$0.25 equivalent). Set a limit appropriate to your budget and inspect the quoted settings first. It creates a new confirmed request without overwriting a prior one:

```sh
export CLIPMIVO_MAX_CREDITS=25
node --input-type=module <<'NODE'
import {readFileSync,writeFileSync} from 'node:fs';
const quote=JSON.parse(readFileSync('quote.json','utf8'));
const max=Number(process.env.CLIPMIVO_MAX_CREDITS);
const credits=quote.data?.credits_to_hold;
if(!quote.success || !Number.isSafeInteger(max) || max<1 ||
   !Number.isSafeInteger(credits) || credits<1 || credits>max)
  throw new Error('Quote unavailable or exceeds your budget');
const request=JSON.parse(readFileSync('examples/request.json','utf8'));
writeFileSync('quoted-request.json',JSON.stringify({...request,quoted_credits:credits}),{flag:'wx'});
NODE
```

Use a unique key for each new task. This call creates a paid task:

```sh
curl --fail-with-body https://clipmivoai.com/api/v1/videos/generations \
  -H "Authorization: Bearer $CLIPMIVO_API_KEY" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: my-first-shot-001' \
  --data-binary @quoted-request.json
```

Preserve the returned task ID. A changed quote is rejected; get a new quote and check it against your limit. After a network error with an unknown submission outcome, use the same confirmed body and same idempotency key, not a new order.

## Track and download

```sh
curl --fail-with-body https://clipmivoai.com/api/v1/videos/generations/TASK_ID \
  -H "Authorization: Bearer $CLIPMIVO_API_KEY"
```

Wait until the task reports `succeeded`; use moderate polling intervals and honor rate-limit responses. If it remains processing, continue querying this task rather than resubmitting. `failed` and `needs_review` need inspection before any new charge.

```sh
curl --fail-with-body https://clipmivoai.com/api/v1/videos/generations/TASK_ID/download \
  -H "Authorization: Bearer $CLIPMIVO_API_KEY" --output result.mp4
```

Use a fresh output path: curl can overwrite an existing file. The CLI download command refuses overwrites.

For references and signed callbacks, see the [CLI guide](../cli/README.md). Never disclose keys in GitHub issues. Contact contact@clipmivoai.com for account or billing support.
