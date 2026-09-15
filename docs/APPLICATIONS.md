# Connect your application

Use the ClipmivoAI API from your server with a scoped key created at https://clipmivoai.com/?section=api . The account needs enough Credits for the quote; installing the CLI, MCP or Skill does not fund the account.

1. Discover supported models and settings.
2. Upload customer-selected references to the authenticated account when needed.
3. Request a quote and show `credits_to_hold` directly as Credits.
4. Respect the customer's approved spending limit. Submit the exact quoted settings with `quoted_credits` and a unique idempotency key.
5. Persist the task ID and customer association in your application. Query that task until terminal; do not recreate it after a timeout.
6. Deliver successful results only to the customer entitled to them.

## Account boundaries and reselling

Server-to-server integration can support your own customer experience. Your server must enforce customer authentication, task ownership, quotas and downstream billing. Never expose your ClipmivoAI key to a browser, mobile app bundle, customer prompt or public repository.

Multiple keys belonging to one ClipmivoAI account share its balance and account-level resources. A separate key does not create a separate customer account or isolate assets and videos. Current usage reports are not reseller customer bills. Dedicated reseller subaccounts, automatic revenue sharing and isolated per-customer balances are not implemented by these tools. Check the current website terms for commercial-use conditions.

## Let an AI assistant make videos

Install the CLI or local MCP server and configure your key securely, then use the repository's [agent Skill](../skills/clipmivo-video/SKILL.md). Example:

> Make a cinematic video of a paper boat on a pond using ClipmivoAI. Maximum spend: 25 Credits. Check the quote first, stay within that budget, and download the completed video.

The budget is an upper limit, not a fixed model price. If the quote exceeds it, adjust settings or obtain a new limit.

The v0.1.1 release includes these Credit-first instructions in the downloadable CLI, MCP and Skill packages. Website deployment status is independent of this repository.
