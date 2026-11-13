---
locale: en
translations:
  zh-CN: README.zh-CN.md
---

# Veo 3.1 & Gemini Omni (Vertex AI)

**English** | [简体中文](README.zh-CN.md)

Serves Google's Veo 3.1 and Gemini Omni Flash video generation on Vertex AI through new-api with a Google Cloud service account: text to video and image to video on the OpenAI video and Responses endpoints. Veo is billed per second by resolution and audio; Gemini Omni is billed on the token usage Vertex reports.

Requires new-api v1.0.0-rc.50 or later.

## Channel setup

1. In Google Cloud, enable the Vertex AI API on a project, create a service account with the Vertex AI User role, and download its key JSON.
2. Install the plugin, then add a channel of type Task Plugin and bind it to `byaiden_gemini_vertex`.
3. Key: paste the whole service account key JSON. The gateway signs in with it and caches the access token; requests run in the key's `project_id`.
4. Base URL: leave empty for `https://aiplatform.googleapis.com`. Veo runs in `us-central1`, the only region Vertex offers Veo 3.1 in; Gemini Omni runs in `global`.
5. Models: `veo-3.1-generate-001`, `veo-3.1-fast-generate-001`, `veo-3.1-lite-generate-001` and `gemini-omni-1.2-flash`, as you offer them. A model appears on the pricing pages only after an enabled channel lists it.
6. To use another New API gateway as the upstream, add a New API channel with that gateway's address and token and bind this plugin; that gateway needs the plugin too. Only Veo works this way.

## Models and endpoints

| Endpoint | What it does | Models |
| --- | --- | --- |
| `POST /v1/videos` | Creates a video from a prompt and images. Upload an image as the `input_reference` file in a multipart request, or send it in `input_reference` or `images` in JSON. | All models |
| `POST /v1/responses` | Creates a video through the Responses API, as a stream, a blocking call or a background call. | All models |

Clients poll `GET /v1/videos/{task_id}` and download the file from `GET /v1/videos/{task_id}/content`. A finished Responses result contains a gateway link to the video; background responses are read with `GET /v1/responses/{response_id}`.

Requests take `prompt`, `seconds`, `resolution` and `size`. A `size` taller than it is wide gives a 9:16 video, other sizes 16:9; without `resolution` it is derived from `size`, otherwise `720p`. The default duration is 8 seconds.

| Model | Seconds | Resolutions | Images |
| --- | --- | --- | --- |
| `veo-3.1-generate-001` | 4, 6, 8 | `720p`, `1080p`, `4k` | 1 first frame, or 2 for first and last frame |
| `veo-3.1-fast-generate-001` | 4, 6, 8 | `720p`, `1080p` | 1 first frame, or 2 for first and last frame |
| `veo-3.1-lite-generate-001` | 4, 6, 8 | `720p`, `1080p` | 1 first frame, or 2 for first and last frame |
| `gemini-omni-1.2-flash` | 3 to 15 (10 with two frames) | `360p`, `720p`, `1080p`, `4k` | up to 6: first frame, first and last frame, or subject references |

Veo also takes these options in `metadata`: `generateAudio` (default `true`), `negativePrompt`, `personGeneration`, `seed` and `aspectRatio`.

## Billing

Veo has three price fields: "Video generation unit price" per second, "Output video resolution" and "Whether audio is generated". The charge follows the request: duration, resolution and `generateAudio`. At Google's list prices:

`veo-3.1-generate-001`:

```
u("generate_audio") == true && u("resolution") == "4k" ? tier("4k audio", u("seconds") * 0.6) : u("generate_audio") == true && u("resolution") == "1080p" ? tier("1080p audio", u("seconds") * 0.4) : u("generate_audio") == true && u("resolution") == "720p" ? tier("720p audio", u("seconds") * 0.4) : u("generate_audio") == false && u("resolution") == "4k" ? tier("4k muted", u("seconds") * 0.4) : u("generate_audio") == false && u("resolution") == "1080p" ? tier("1080p muted", u("seconds") * 0.2) : tier("720p muted", u("seconds") * 0.2)
```

`veo-3.1-fast-generate-001`:

```
u("generate_audio") == true && u("resolution") == "1080p" ? tier("1080p audio", u("seconds") * 0.12) : u("generate_audio") == true && u("resolution") == "720p" ? tier("720p audio", u("seconds") * 0.1) : u("generate_audio") == false && u("resolution") == "1080p" ? tier("1080p muted", u("seconds") * 0.1) : tier("720p muted", u("seconds") * 0.08)
```

`veo-3.1-lite-generate-001`:

```
u("generate_audio") == true && u("resolution") == "1080p" ? tier("1080p audio", u("seconds") * 0.08) : u("generate_audio") == true && u("resolution") == "720p" ? tier("720p audio", u("seconds") * 0.05) : u("generate_audio") == false && u("resolution") == "1080p" ? tier("1080p muted", u("seconds") * 0.05) : tier("720p muted", u("seconds") * 0.03)
```

Gemini Omni has three price fields: "Input token unit price", "Text output token unit price" (thinking included) and "Video output token unit price" (video with audio). When the request arrives the gateway reserves the video tokens for the requested duration and resolution: 1,931 per second at 360p, 5,792 at 720p, 8,688 at 1080p and 17,376 at 4k. When the video is done it settles all three on the usage Vertex reports. At Google's list prices:

```
tier("base", u("input_tokens") * 1.5 / 1000000 + u("output_tokens") * 9 / 1000000 + u("video_tokens") * 12 / 1000000)
```

Multiply the prices by your margin. Rejected requests and failed generations are not billed.

## Example

```bash
curl https://your-gateway.example.com/v1/videos \
  -H "Authorization: Bearer $NEWAPI_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model": "veo-3.1-fast-generate-001", "prompt": "Waves rolling onto a black sand beach at sunset", "seconds": 8, "resolution": "1080p", "metadata": {"generateAudio": true}}'
```

Poll the task with the `id` from the reply, then download the video:

```bash
curl https://your-gateway.example.com/v1/videos/{task_id} \
  -H "Authorization: Bearer $NEWAPI_TOKEN"

curl -o video.mp4 https://your-gateway.example.com/v1/videos/{task_id}/content \
  -H "Authorization: Bearer $NEWAPI_TOKEN"
```

## Limits

- Each request returns one video. Input images are JPEG or PNG, as a data URL or base64; an uploaded file is at most 20 MiB.
- Videos are returned inline by Vertex rather than written to Cloud Storage; downloads fetch them from Vertex again. Raise `MAX_FILE_DOWNLOAD_MB` on the gateway if long high-resolution downloads fail.
- Veo reference images, video extension and Cloud Storage output are not offered; nor editing, extending or multi-turn conversations of Gemini Omni.
- `veo-3.1-lite-generate-001` is a Preview model on Vertex AI.
- Gemini Decision 1 is not on Vertex AI yet; it is served on the Gemini API by the `gemini` plugin.
