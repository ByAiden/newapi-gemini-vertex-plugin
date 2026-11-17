---
changelogVersion: 1
plugin: byaiden_gemini_vertex
version: 1.2.0
locale: "en"
translations:
  zh-CN: CHANGELOG.zh-CN.md
---

# Changelog

## [1.2.0]

### Added

- Gemini Omni works through another New API gateway, like Veo.
- A finished Gemini Omni video object (`GET /v1/videos/{task_id}`) now carries `usage` with the billed `input_tokens`, `output_tokens` and `video_tokens`, so a gateway in front settles on the same usage.

### Fixed

- Veo through another New API gateway: the plugin called Vertex AI paths under `/byaiden_gemini_vertex` that the other gateway does not serve, so every request failed. On a New API channel (type 60) requests now go to that gateway's `POST /v1/videos` with its token as a Bearer key, are polled at `GET /v1/videos/{id}`, and download from `GET /v1/videos/{id}/content`. Only the other gateway needs the service account key.
