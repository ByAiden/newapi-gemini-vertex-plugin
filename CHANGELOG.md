---
changelogVersion: 1
plugin: gemini-vertex
version: 1.0.0
locale: "en"
translations:
  zh-CN: CHANGELOG.zh-CN.md
---

# Changelog

## [1.0.0]

### Added

- Veo 3.1 video generation on Vertex AI (`veo-3.1-generate-001`, `veo-3.1-fast-generate-001`, `veo-3.1-lite-generate-001`) on `POST /v1/videos` and `POST /v1/responses`: text to video, first-frame and first-and-last-frame image to video, 4, 6 or 8 seconds, with or without audio, in `us-central1`.
- Gemini Omni Flash video generation on Vertex AI (`gemini-omni-1.2-flash`): text to video and image to video with up to 6 images, 3 to 15 seconds at `360p`, `720p`, `1080p` or `4k`, run as a background interaction on the global endpoint.
- Sign-in with a Google Cloud service account key JSON on a Task Plugin channel.
- Veo billing per second by resolution and audio, and Gemini Omni token billing reserved from the requested duration and resolution and settled on the usage Vertex reports.
