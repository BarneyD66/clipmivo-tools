# ClipmivoAI 开发者工具

通过 API、CLI、MCP 或 Skill 创建视频，统一调用 `https://clipmivoai.com/api/v1`，使用同一个 ClipmivoAI 账户余额。

1. 登录 [ClipmivoAI](https://clipmivoai.com/?section=api)，在 API / CLI（Developer）工作台创建 API 密钥，并在网站充值。
2. 安装 CLI 或 MCP；也可以直接调用 REST API。
3. 查询当前模型和参数，获取报价，在预算内确认后提交生成。
4. 查询任务状态，成功后下载视频。

## 安装 CLI 与 MCP

需要 Node.js 22 或更新版本：

```sh
npm install -g https://github.com/BarneyD66/clipmivo-tools/releases/download/v0.1.0/clipmivo-cli-0.2.6.tgz
npm install -g https://github.com/BarneyD66/clipmivo-tools/releases/download/v0.1.0/clipmivo-mcp-0.1.7.tgz
```

通过环境变量或客户端密钥设置提供 `CLIPMIVO_API_KEY`。不要把真实密钥提交到 GitHub。

```sh
clipmivo models --json
clipmivo balance --json
clipmivo quote --file examples/request.json --json
```

按 [CLI 文档](../cli/README.md#confirm-a-quote-before-submission) 确认报价，将 `quoted_credits` 写入独立请求文件后，再提交：

```sh
clipmivo generate --file quoted-request.json --idempotency-key my-first-shot-001 --wait --json
clipmivo download TASK_ID --output result.mp4 --json
```

网络超时不代表任务失败。提交响应丢失时保留原请求和同一个幂等键；已返回任务编号时继续查询，不要重新下单。

## Credit 消耗与应用接入

报价的 `credits_to_hold` 就是 Credit 数量，直接展示，不要再乘以 100。生成前预留，适用的模型完成后按实际用量结算，未使用的预留额度返还余额。参考换算为 100 Credits = 1 美元，充值通过网站完成。

接入自己的应用时，把我们的 API Key 保存在服务端。同一账户下的 Key 共用余额和账户资源，不是独立的经销商子账户。下游客户隔离、限额和账单由你的应用负责；平台暂未提供独立 reseller 子账户和分账功能。详见 [应用接入说明](APPLICATIONS.md)。

## MCP 和 Skill

[MCP 配置](../mcp/README.md) 使用本地 stdio 连接，支持查询模型、余额、素材、询价、创建视频与下载。它不是远程 OAuth 连接器。

将 `skills/clipmivo-video` 复制到支持 Agent Skills 的客户端目录。Codex 使用 `~/.codex/skills/clipmivo-video`。重新加载后可说：

> 使用 $clipmivo-video 帮我生成池塘里的纸船视频，最多消耗 25 Credits。

Skill 会沿用已授权预算，按实际报价决定能否提交。API、CLI 和 MCP 创建的是视频任务；充值通过网站完成。

[REST API 示例](API.md) · [OpenAPI 定义](openapi.json) · [English](../README.md)
