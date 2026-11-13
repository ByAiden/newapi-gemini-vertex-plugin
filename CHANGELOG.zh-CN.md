---
changelogVersion: 1
plugin: gemini-vertex
version: 1.0.0
locale: "zh-CN"
---

# Changelog

## [1.0.0]

### Added

- 支持 Vertex AI 上的 Veo 3.1 视频生成（`veo-3.1-generate-001`、`veo-3.1-fast-generate-001`、`veo-3.1-lite-generate-001`），走 `POST /v1/videos` 和 `POST /v1/responses`：文生视频、首帧和首尾帧图生视频，时长 4、6 或 8 秒，可选是否生成音频，在 `us-central1` 运行。
- 支持 Vertex AI 上的 Gemini Omni Flash 视频生成（`gemini-omni-1.2-flash`）：文生视频和图生视频，最多 6 张图，时长 3 到 15 秒，分辨率 `360p`、`720p`、`1080p` 或 `4k`，以后台任务方式在 global 端点运行。
- Task Plugin 渠道使用 Google Cloud 服务账号密钥 JSON 登录。
- Veo 按秒计费，价格随分辨率和是否有声变化；Gemini Omni 按请求的时长和分辨率预扣 token，完成后按 Vertex 返回的用量结算。
