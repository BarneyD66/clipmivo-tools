# Clipmivo Film 0.3 — Developer Preview

用同一个 ClipmivoAI Key，让支持本地执行的 AI 助手组织剧本、生成角色参考图与视频分镜，再通过本地 Shotcut 剪辑导出 MP4、MLT 和字幕。

## 安装

下载附件 `clipmivo-film-preview-0.3.zip`，解压完整的 `clipmivo-film` 文件夹。Codex 默认放入 `~/.codex/skills/`；Claude Code 可放入项目的 `.claude/skills/`；WorkBuddy 通过技能导入入口安装。后两者尚未完成本包运行实测，豆包工作台兼容性未确认。

需要 Node.js 22+、Python 3.10+、Shotcut/MLT、ffmpeg/ffprobe 和 CLI-Anything Shotcut 适配器。完整步骤在包内 `references/install.md`。将同一个 Key 放入 `CLIPMIVO_API_KEY` 环境变量，按需授予视频和图片读写权限，不要粘贴进聊天或项目文件。

## 本版能力

- 按实时模型能力和报价筛选分镜模型，可指定模型偏好。
- 先生成角色参考图，再绑定网站素材 ID 报价视频。
- 图片、视频和历史尝试共用累计预算。
- 保存原始请求和幂等键，支持中断恢复及指定镜头修订。
- 控制请求频率和进行中的任务数。
- 本地剪辑、静态字幕、已有音轨，以及可编辑工程导出。

## 验证与限制

21 项自动测试通过；安装包解压后再次测试通过。Windows 本地 HTTP 模拟接口到实际 Shotcut 导出已复测，得到带字幕与音轨的 8.021 秒 1080p 色卡测试片。另有 75 镜头、300.01 秒的本地剪辑测试。

这些验证没有调用真实付费生成，不证明人物一致性或模型画质。真实付费制作和 Claude Code/WorkBuddy 运行验收仍待完成。没有云端剪辑、自动配音或经评测的最佳画质排名。请按开发者预览版使用；本版不会替换现有 CLI/MCP 的稳定版本。

校验下载包请使用附件 `SHA256SUMS.txt`。安装不会自动购买或充值 Credits。
