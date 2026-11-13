---
locale: zh-CN
---

# Veo 3.1 & Gemini Omni (Vertex AI)

[English](README.md) | **简体中文**

用 Google Cloud 服务账号，在 new-api 上提供 Vertex AI 的 Veo 3.1 和 Gemini Omni Flash 视频生成：通过 OpenAI 视频接口和 Responses 接口做文生视频、图生视频。Veo 按秒计费，价格随分辨率和是否有声变化；Gemini Omni 按 Vertex 返回的 token 用量计费。

需要 new-api v1.0.0-rc.50 或更高版本。

## 渠道设置

1. 在 Google Cloud 项目里启用 Vertex AI API，创建一个带 Vertex AI User 角色的服务账号，下载它的密钥 JSON。
2. 安装插件后，新建渠道，类型选 Task Plugin，绑定插件 `byaiden_gemini_vertex`。
3. 密钥：粘贴完整的服务账号密钥 JSON。网关用它登录并缓存访问令牌，请求在密钥里的 `project_id` 项目下执行。
4. Base URL：留空即使用 `https://aiplatform.googleapis.com`。Veo 固定在 `us-central1` 运行（Vertex 只在这个区域提供 Veo 3.1），Gemini Omni 固定在 `global` 运行。
5. 模型：按需填写 `veo-3.1-generate-001`、`veo-3.1-fast-generate-001`、`veo-3.1-lite-generate-001` 和 `gemini-omni-1.2-flash`。模型要被已启用的渠道列出，才会出现在价格页面。
6. 如果上游是另一台 New API 网关，新建 New API 渠道，填该网关的地址和令牌并绑定本插件，上游网关也需要安装本插件。这种方式只支持 Veo。

## 模型与接口

| 接口 | 用途 | 模型 |
| --- | --- | --- |
| `POST /v1/videos` | 根据提示词和图片生成视频。图片可在 multipart 请求里作为 `input_reference` 文件上传，或在 JSON 的 `input_reference` 或 `images` 里传。 | 全部模型 |
| `POST /v1/responses` | 通过 Responses API 生成视频，支持流式、同步等待和后台三种调用方式。 | 全部模型 |

客户端轮询 `GET /v1/videos/{task_id}` 查看状态，完成后从 `GET /v1/videos/{task_id}/content` 下载视频。Responses 的结果里带有网关提供的视频链接；后台调用的结果用 `GET /v1/responses/{response_id}` 查询。

请求支持 `prompt`、`seconds`、`resolution` 和 `size`。`size` 高大于宽时生成 9:16 的视频，其他尺寸生成 16:9；没有 `resolution` 时按 `size` 换算，都没有时按 `720p`。默认时长 8 秒。

| 模型 | 时长（秒） | 分辨率 | 图片 |
| --- | --- | --- | --- |
| `veo-3.1-generate-001` | 4、6、8 | `720p`、`1080p`、`4k` | 1 张作首帧，或 2 张作首尾帧 |
| `veo-3.1-fast-generate-001` | 4、6、8 | `720p`、`1080p` | 1 张作首帧，或 2 张作首尾帧 |
| `veo-3.1-lite-generate-001` | 4、6、8 | `720p`、`1080p` | 1 张作首帧，或 2 张作首尾帧 |
| `gemini-omni-1.2-flash` | 3 到 15（首尾帧最长 10） | `360p`、`720p`、`1080p`、`4k` | 最多 6 张：首帧、首尾帧或主体参考图 |

Veo 还可以在 `metadata` 里传这些选项：`generateAudio`（默认 `true`）、`negativePrompt`、`personGeneration`、`seed` 和 `aspectRatio`。

## 计费

Veo 有三个价格字段：“视频生成单价”（按秒）、“输出视频分辨率”和“是否生成音频”。费用按请求的时长、分辨率和 `generateAudio` 计算。按 Google 官方价：

`veo-3.1-generate-001`：

```
u("generate_audio") == true && u("resolution") == "4k" ? tier("4k audio", u("seconds") * 0.6) : u("generate_audio") == true && u("resolution") == "1080p" ? tier("1080p audio", u("seconds") * 0.4) : u("generate_audio") == true && u("resolution") == "720p" ? tier("720p audio", u("seconds") * 0.4) : u("generate_audio") == false && u("resolution") == "4k" ? tier("4k muted", u("seconds") * 0.4) : u("generate_audio") == false && u("resolution") == "1080p" ? tier("1080p muted", u("seconds") * 0.2) : tier("720p muted", u("seconds") * 0.2)
```

`veo-3.1-fast-generate-001`：

```
u("generate_audio") == true && u("resolution") == "1080p" ? tier("1080p audio", u("seconds") * 0.12) : u("generate_audio") == true && u("resolution") == "720p" ? tier("720p audio", u("seconds") * 0.1) : u("generate_audio") == false && u("resolution") == "1080p" ? tier("1080p muted", u("seconds") * 0.1) : tier("720p muted", u("seconds") * 0.08)
```

`veo-3.1-lite-generate-001`：

```
u("generate_audio") == true && u("resolution") == "1080p" ? tier("1080p audio", u("seconds") * 0.08) : u("generate_audio") == true && u("resolution") == "720p" ? tier("720p audio", u("seconds") * 0.05) : u("generate_audio") == false && u("resolution") == "1080p" ? tier("1080p muted", u("seconds") * 0.05) : tier("720p muted", u("seconds") * 0.03)
```

Gemini Omni 有三个价格字段：“输入 token 单价”、“文本输出 token 单价”（含思考 token）和“视频输出 token 单价”（含音频的视频）。请求到达时，网关按请求的时长和分辨率预扣视频 token：360p 每秒 1,931 个，720p 每秒 5,792 个，1080p 每秒 8,688 个，4k 每秒 17,376 个。视频完成后按 Vertex 返回的用量结算这三项。按 Google 官方价：

```
tier("base", u("input_tokens") * 1.5 / 1000000 + u("output_tokens") * 9 / 1000000 + u("video_tokens") * 12 / 1000000)
```

把价格乘以你的加价倍数即可。被拒绝的请求和生成失败的任务不计费。

## 示例

```bash
curl https://your-gateway.example.com/v1/videos \
  -H "Authorization: Bearer $NEWAPI_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model": "veo-3.1-fast-generate-001", "prompt": "Waves rolling onto a black sand beach at sunset", "seconds": 8, "resolution": "1080p", "metadata": {"generateAudio": true}}'
```

用返回的 `id` 轮询任务，完成后下载视频：

```bash
curl https://your-gateway.example.com/v1/videos/{task_id} \
  -H "Authorization: Bearer $NEWAPI_TOKEN"

curl -o video.mp4 https://your-gateway.example.com/v1/videos/{task_id}/content \
  -H "Authorization: Bearer $NEWAPI_TOKEN"
```

## 限制

- 每次请求生成一个视频。输入图片为 JPEG 或 PNG，格式为 data URL 或 base64；上传的文件不超过 20 MiB。
- Vertex 以内联方式返回视频，不写入 Cloud Storage；下载时网关会重新向 Vertex 获取。长视频高分辨率下载失败时，请调大网关的 `MAX_FILE_DOWNLOAD_MB`。
- 不提供 Veo 的参考图生成、视频续写和 Cloud Storage 输出，也不提供 Gemini Omni 的编辑、续写和多轮对话。
- `veo-3.1-lite-generate-001` 在 Vertex AI 上还是 Preview 模型。
- Gemini Decision 1 目前还没有上 Vertex AI，可以用 `gemini` 插件通过 Gemini API 调用。
