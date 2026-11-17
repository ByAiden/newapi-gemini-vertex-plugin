---
changelogVersion: 1
plugin: byaiden_gemini_vertex
version: 1.2.0
locale: "zh-CN"
---

# Changelog

## [1.2.0]

### Added

- Gemini Omni 与 Veo 一样支持经由另一个 New API 网关调用。
- 完成的 Gemini Omni 视频对象（`GET /v1/videos/{task_id}`）带上 `usage`，含计费用的 `input_tokens`、`output_tokens` 和 `video_tokens`，前面一层网关据此按相同用量结算。

### Fixed

- 经由另一个 New API 网关调用 Veo：插件请求的是 `/byaiden_gemini_vertex` 下的 Vertex AI 路径，而对方网关并不提供这些路径，所以每个请求都失败。现在在 New API 渠道（类型 60）上，请求发往对方网关的 `POST /v1/videos`（令牌作 Bearer 密钥），在 `GET /v1/videos/{id}` 查询，从 `GET /v1/videos/{id}/content` 下载。只有对方网关需要服务账号密钥。
