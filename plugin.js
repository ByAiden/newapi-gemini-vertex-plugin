export const meta = {
  apiVersion: 1,
  key: "byaiden_gemini_vertex",
  name: "Veo 3.1 & Gemini Omni (Vertex AI)",
  icon: "VertexAI.Color",
  description: {
    en: "Veo 3.1 and Gemini Omni Flash video generation (text-to-video and image-to-video) on Vertex AI with a service account",
    zh: "Veo 3.1 与 Gemini Omni Flash 视频生成（文生视频、图生视频），Vertex AI 服务账号版本",
  },
  version: "1.1.0",
  author: { name: "ByAiden", url: "https://github.com/ByAiden" },
  website: "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/veo/3-1-generate",
  baseUrl: "https://aiplatform.googleapis.com",
  models: ["veo-3.1-generate-001", "veo-3.1-fast-generate-001", "veo-3.1-lite-generate-001", "gemini-omni-1.2-flash"],
  fetchMode: "per_task",
  auth: { type: "vertex_oauth" },
  upstreams: ["vendor", "new_api"],
  // Veo 3.1 runs on the us-central1 host; Gemini Omni on the global one.
  allowedHosts: ["us-central1-aiplatform.googleapis.com"],
  keyHint: { en: "Service account key JSON", zh: "服务账号密钥 JSON" },
  // Veo is billed per second of video, priced by resolution and audio.
  usageSchema: {
    seconds: {
      type: "number",
      unit: "second",
      description: { en: "Video generation unit price", zh: "视频生成单价" },
    },
    resolution: {
      enum: ["720p", "1080p", "4k"],
      enumLabels: { "720p": { en: "720p", zh: "720p" }, "1080p": { en: "1080p", zh: "1080p" }, "4k": { en: "4k", zh: "4k" } },
      description: { en: "Output video resolution", zh: "输出视频分辨率" },
    },
    generate_audio: {
      type: "boolean",
      description: { en: "Whether audio is generated", zh: "是否生成音频" },
    },
  },
  usageExamples: [
    { label: "8s 720p audio", facts: { seconds: 8, resolution: "720p", generate_audio: true } },
    { label: "8s 720p muted", facts: { seconds: 8, resolution: "720p", generate_audio: false } },
    { label: "8s 1080p audio", facts: { seconds: 8, resolution: "1080p", generate_audio: true } },
    { label: "8s 4k audio", facts: { seconds: 8, resolution: "4k", generate_audio: true } },
  ],
  // Gemini Omni bills tokens: input, text output (with thinking) and video
  // output (with audio).
  usageProfiles: [
    {
      models: ["gemini-omni-1.2-flash"],
      schema: {
        input_tokens: {
          type: "number",
          unit: "token",
          description: { en: "Input token unit price", zh: "输入 token 单价" },
        },
        output_tokens: {
          type: "number",
          unit: "token",
          description: { en: "Text output token unit price", zh: "文本输出 token 单价" },
        },
        video_tokens: {
          type: "number",
          unit: "token",
          description: { en: "Video output token unit price", zh: "视频输出 token 单价" },
        },
      },
      examples: [
        { label: "3s 360p", facts: { input_tokens: 0, output_tokens: 0, video_tokens: 5793 } },
        { label: "8s 720p", facts: { input_tokens: 0, output_tokens: 0, video_tokens: 46336 } },
        { label: "8s 1080p", facts: { input_tokens: 0, output_tokens: 0, video_tokens: 69504 } },
        { label: "10s 4k", facts: { input_tokens: 0, output_tokens: 0, video_tokens: 173760 } },
      ],
    },
  ],
  protocols: [
    { name: "openai_responses", supports: ["stream", "sync", "background"] },
    "openai_video",
  ],
};

// Veo 3.1 on Vertex AI: https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/veo/3-1-generate
// The GA models run in us-central1, take 4, 6 or 8 seconds, and only the
// standard model renders 4k.
const VEO_RESOLUTIONS = {
  "veo-3.1-generate-001": ["720p", "1080p", "4k"],
  "veo-3.1-fast-generate-001": ["720p", "1080p"],
  "veo-3.1-lite-generate-001": ["720p", "1080p"],
};
const VEO_SECONDS = [4, 6, 8];
// Veo parameters a client may set; the plugin owns the rest.
const VEO_PARAMETERS = ["aspectRatio", "resolution", "generateAudio", "negativePrompt", "personGeneration", "seed"];
// Gemini Omni output video tokens per second of video, by resolution.
const OMNI_VIDEO_TOKENS_PER_SECOND = { "360p": 1931, "720p": 5792, "1080p": 8688, "4k": 17376 };
const OMNI_RESOLUTIONS = Object.keys(OMNI_VIDEO_TOKENS_PER_SECOND);
const IMAGE_TYPES = ["image/jpeg", "image/png"];
const MAX_OMNI_IMAGES = 6;
const DEFAULT_SECONDS = 8;
const DEFAULT_BASE = "https://aiplatform.googleapis.com";
// Vertex names the operation field this way in fetchPredictOperation.
const OPERATION_FIELD = "operation" + "N" + "ame";

function trimmed(value) {
  return String(value === undefined || value === null ? "" : value).trim();
}

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function modelOf(ctx) {
  return trimmed(ctx.upstreamModel || ctx.model);
}

function omniModel(ctx) {
  return modelOf(ctx).startsWith("gemini-omni-");
}

// On a New API channel the same plugin answers on another gateway, which
// serves this plugin's addresses under its key and takes a Bearer token.
function viaGateway(ctx) {
  return Boolean(ctx.upstream && ctx.upstream.kind === "new_api");
}

function projectId(ctx) {
  const project = trimmed(ctx.auth && ctx.auth.projectId);
  if (!project) throw new Error("the channel key must be a service account key JSON with project_id");
  return project;
}

function requestHeaders(ctx) {
  if (ctx.authError) throw new Error(ctx.authError);
  const headers = { "Content-Type": "application/json", Accept: "application/json", Authorization: ctx.authHeader };
  if (!viaGateway(ctx)) headers["x-goog-user-project"] = projectId(ctx);
  return headers;
}

function baseUrl(ctx) {
  return trimmed(ctx.baseUrl).replace(/\/+$/, "") || DEFAULT_BASE;
}

// Vertex offers Veo 3.1 in us-central1 only.
function region() {
  return "us-central1";
}

function sizeParts(size) {
  const parts = String(size || "")
    .toLowerCase()
    .split("x");
  return parts.length === 2 ? [Number(parts[0]), Number(parts[1])] : null;
}

function sizeResolution(size) {
  const parts = sizeParts(size);
  if (!parts) return "720p";
  const max = Math.max(parts[0], parts[1]);
  return max >= 3840 ? "4k" : max >= 1920 ? "1080p" : "720p";
}

function aspect(size) {
  const parts = sizeParts(size);
  return !parts || parts[0] <= 0 || parts[1] <= 0 ? "16:9" : parts[1] > parts[0] ? "9:16" : "16:9";
}

function images(req) {
  return Array.isArray(req.images) ? req.images : [];
}

// An input image's media type and base64 bytes: an uploaded file placeholder,
// a data URL or bare base64.
function inputImage(ctx, image) {
  let mime = "";
  let data = image;
  if (plainObject(image) && image.__fileRef) {
    mime = String(image.mimeType || "").toLowerCase();
    if (!IMAGE_TYPES.includes(mime)) {
      for (const file of ctx.files || []) {
        if (file.ref === image.__fileRef || file.field === "input_reference") {
          mime = String(file.mimeType || "").toLowerCase();
          break;
        }
      }
    }
  } else {
    const text = trimmed(image);
    const comma = text.indexOf(",");
    data = text;
    if (text.startsWith("data:") && comma > 0) {
      mime = text.slice(5, comma).split(";")[0].toLowerCase();
      data = text.slice(comma + 1);
    } else if (text.startsWith("iVBORw0KGgo")) mime = "image/png";
    else if (text.startsWith("/9j/")) mime = "image/jpeg";
  }
  if (!IMAGE_TYPES.includes(mime)) throw new Error("input image must be image/jpeg or image/png");
  if (!data) throw new Error("input image is empty");
  return { mime: mime, data: data };
}

function validImageInput(value) {
  value = trimmed(value);
  if (!value) return false;
  if (value.startsWith("data:")) {
    const comma = value.indexOf(",");
    return comma >= 0 && Boolean(value.slice(comma + 1));
  }
  return /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

// ---- Veo ----

function veoParameters(req) {
  const metadata = plainObject(req.metadata) || {};
  const params = {};
  for (const key of Object.keys(metadata)) {
    if (!VEO_PARAMETERS.includes(key)) throw new Error("metadata." + key + " is not supported");
    params[key] = metadata[key];
  }
  if (req.resolution !== undefined && req.resolution !== "") params.resolution = req.resolution;
  return params;
}

function veoSeconds(req) {
  const value = req.duration === undefined || req.duration === null || req.duration === "" ? DEFAULT_SECONDS : Number(req.duration);
  if (!VEO_SECONDS.includes(value)) throw new Error("seconds must be one of 4, 6, or 8");
  return value;
}

function veoResolution(ctx, req) {
  const params = veoParameters(req);
  const value = String(params.resolution !== undefined && params.resolution !== "" ? params.resolution : sizeResolution(req.size)).toLowerCase();
  const allowed = VEO_RESOLUTIONS[modelOf(ctx)] || VEO_RESOLUTIONS["veo-3.1-generate-001"];
  if (!allowed.includes(value)) throw new Error("resolution must be one of " + allowed.join(", ") + " for " + modelOf(ctx));
  return value;
}

function veoAudio(req) {
  const value = veoParameters(req).generateAudio;
  if (value !== undefined && typeof value !== "boolean") throw new Error("metadata.generateAudio must be true or false");
  return value !== false;
}

function modelURL(ctx, project, location, model, method) {
  let base = baseUrl(ctx) + (viaGateway(ctx) ? "/" + meta.key : "");
  if (!viaGateway(ctx) && base === DEFAULT_BASE && location !== "global") base = "https://" + location + "-aiplatform.googleapis.com";
  return base + "/v1/projects/" + project + "/locations/" + location + "/publishers/google/models/" + model + ":" + method;
}

// Images keep the client's order: one is the first frame, two are the first
// and last frame.
function veoSubmitRequest(ctx) {
  const req = ctx.requestBody || {};
  const list = images(req);
  if (list.length > 2) throw new Error("Veo takes at most 2 images: the first and last frame");
  if (!trimmed(req.prompt) && !list.length) throw new Error("prompt is required");
  const params = veoParameters(req);
  params.durationSeconds = veoSeconds(req);
  params.resolution = veoResolution(ctx, req);
  params.generateAudio = veoAudio(req);
  if (!params.aspectRatio) params.aspectRatio = aspect(req.size);
  params.sampleCount = 1;
  const instance = {};
  if (trimmed(req.prompt)) instance.prompt = req.prompt;
  if (list.length) {
    const first = inputImage(ctx, list[0]);
    instance.image = { bytesBase64Encoded: first.data, mimeType: first.mime };
  }
  if (list.length === 2) {
    const last = inputImage(ctx, list[1]);
    instance.lastFrame = { bytesBase64Encoded: last.data, mimeType: last.mime };
  }
  // Credentials are checked after the request, so a bad request says why.
  const headers = requestHeaders(ctx);
  // A gateway runs the request in its own project, so the path names none.
  const project = viaGateway(ctx) ? "-" : projectId(ctx);
  return {
    url: modelURL(ctx, project, region(ctx), modelOf(ctx), "predictLongRunning"),
    method: "POST",
    headers: headers,
    body: { instances: [instance], parameters: params },
    action: list.length ? "image_to_video" : "text_to_video",
  };
}

function operationPart(operation, marker) {
  const start = operation.indexOf(marker);
  return start < 0 ? "" : operation.slice(start + marker.length).split("/")[0];
}

function fetchOperation(ctx, operation) {
  const project = operationPart(operation, "projects/");
  const location = operationPart(operation, "locations/") || region(ctx);
  const model = operationPart(operation, "models/");
  if (!project || !model) throw new Error("cannot read the project or model from the operation");
  const body = {};
  body[OPERATION_FIELD] = operation;
  return { url: modelURL(ctx, project, location, model, "fetchPredictOperation"), method: "POST", headers: requestHeaders(ctx), body: body };
}

function firstVideo(operation) {
  const response = plainObject(plainObject(operation) && operation.response) || {};
  return plainObject((Array.isArray(response.videos) ? response.videos : [])[0]) || {};
}

function veoTaskResult(body) {
  body = plainObject(body) || {};
  if (plainObject(body.error) && body.error.message) return { status: "FAILURE", progress: "100%", reason: body.error.message };
  // Long-running operations omit done while running.
  if (!trimmed(body.name)) return { status: "UNKNOWN", reason: "unrecognized operation state" };
  if (body.done !== true) return { status: "IN_PROGRESS", progress: "50%" };
  const response = plainObject(body.response) || {};
  if (Number(response.raiMediaFilteredCount) > 0 && !Object.keys(firstVideo(body)).length) {
    const reasons = Array.isArray(response.raiMediaFilteredReasons) ? response.raiMediaFilteredReasons.join("; ") : "";
    return { status: "FAILURE", progress: "100%", reason: reasons || "the video was blocked by safety filters" };
  }
  const video = firstVideo(body);
  if (!Object.keys(video).length) return { status: "FAILURE", progress: "100%", reason: "operation finished without a video" };
  const result = { status: "SUCCESS", progress: "100%" };
  if (trimmed(video.gcsUri)) result.remoteUrl = trimmed(video.gcsUri);
  return result;
}

// ---- Gemini Omni ----

// Omni runs through the Interactions API on the global endpoint and returns
// the video inline in the interaction.
function interactionsURL(ctx, interactionId) {
  if (viaGateway(ctx)) throw new Error("Gemini Omni is not available through a New API gateway");
  const url = baseUrl(ctx) + "/v1beta1/projects/" + projectId(ctx) + "/locations/global/interactions";
  return interactionId ? url + "/" + encodeURIComponent(interactionId) : url;
}

function omniResolution(req) {
  const metadata = plainObject(req.metadata) || {};
  const given = req.resolution !== undefined && req.resolution !== "" ? req.resolution : metadata.resolution;
  const value = String(given !== undefined && given !== "" ? given : sizeResolution(req.size)).toLowerCase();
  if (!OMNI_RESOLUTIONS.includes(value)) throw new Error("resolution must be one of " + OMNI_RESOLUTIONS.join(", "));
  return value;
}

// 3 to 15 seconds; first-and-last-frame videos stop at 10.
function omniSeconds(req) {
  const value = req.duration === undefined || req.duration === null || req.duration === "" ? DEFAULT_SECONDS : Number(req.duration);
  const max = images(req).length === 2 ? 10 : 15;
  if (!Number.isInteger(value) || value < 3 || value > max) throw new Error("seconds must be a whole number from 3 to " + max);
  return value;
}

function omniSubmitRequest(ctx) {
  const req = ctx.requestBody || {};
  const list = images(req);
  if (list.length > MAX_OMNI_IMAGES) throw new Error("Gemini Omni takes at most " + MAX_OMNI_IMAGES + " images");
  const input = list.map(function (image) {
    const frame = inputImage(ctx, image);
    return { type: "image", mime_type: frame.mime, data: frame.data };
  });
  if (trimmed(req.prompt)) input.push({ type: "text", text: req.prompt });
  if (!input.length) throw new Error("prompt is required");
  const task = list.length ? "image_to_video" : "text_to_video";
  const body = {
    model: modelOf(ctx),
    input: input,
    response_format: { type: "video", aspect_ratio: aspect(req.size), resolution: omniResolution(req), duration: omniSeconds(req) + "s" },
    background: true,
    store: true,
  };
  // The task hint limits the image count, so it is only sent for the
  // text-only and single-image forms.
  if (list.length < 2) body.generation_config = { video_config: { task: task } };
  const headers = requestHeaders(ctx);
  return { url: interactionsURL(ctx), method: "POST", headers: headers, body: body, action: task };
}

function isInteraction(body) {
  return plainObject(body) !== null && (body.object === "interaction" || Array.isArray(body.steps));
}

function omniVideo(body) {
  const steps = Array.isArray(body.steps) ? body.steps : [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!plainObject(step) || step.type !== "model_output" || !Array.isArray(step.content)) continue;
    for (let j = 0; j < step.content.length; j++) {
      const part = step.content[j];
      if (!plainObject(part) || part.type !== "video") continue;
      return { path: ["steps", i, "content", j, "data"], mimeType: trimmed(part.mime_type) || "video/mp4" };
    }
  }
  return null;
}

function omniTaskResult(body) {
  body = plainObject(body) || {};
  if (plainObject(body.error) && body.error.message) return { status: "FAILURE", progress: "100%", reason: body.error.message };
  const status = trimmed(body.status).toLowerCase();
  if (status === "in_progress" || status === "queued") return { status: "IN_PROGRESS", progress: "50%" };
  if (["failed", "cancelled", "canceled", "expired", "incomplete"].includes(status)) {
    const error = plainObject((Array.isArray(body.errors) ? body.errors : [])[0]) || {};
    const reason = [trimmed(error.code), trimmed(error.message)].filter(Boolean).join(": ");
    return { status: "FAILURE", progress: "100%", reason: reason || status };
  }
  if (status !== "completed") return { status: "UNKNOWN", reason: "unrecognized interaction state" };
  if (!omniVideo(body)) return { status: "FAILURE", progress: "100%", reason: "interaction completed without a video" };
  return { status: "SUCCESS", progress: "100%" };
}

// Thinking counts as text output; video and audio count as video output.
// Facts Vertex does not report are left out so the reservation stands.
function omniSettlement(body) {
  const usage = plainObject(body && body.usage);
  if (!usage) return null;
  const facts = {};
  if (Number.isInteger(usage.total_input_tokens) && usage.total_input_tokens >= 0) facts.input_tokens = usage.total_input_tokens;
  let text = 0;
  let video = 0;
  let sawText = false;
  let sawVideo = false;
  if (Number.isInteger(usage.total_thought_tokens) && usage.total_thought_tokens >= 0) {
    text += usage.total_thought_tokens;
    sawText = true;
  }
  for (const item of Array.isArray(usage.output_tokens_by_modality) ? usage.output_tokens_by_modality : []) {
    const entry = plainObject(item) || {};
    const tokens = Number.isInteger(entry.tokens) && entry.tokens >= 0 ? entry.tokens : 0;
    const modality = trimmed(entry.modality).toLowerCase();
    if (modality === "video" || modality === "audio") {
      video += tokens;
      sawVideo = true;
    } else {
      text += tokens;
      sawText = true;
    }
  }
  if (sawText) facts.output_tokens = text;
  if (sawVideo) facts.video_tokens = video;
  return facts;
}

// ---- Driver hooks ----

export function buildSubmitRequest(ctx) {
  if (omniModel(ctx)) return omniSubmitRequest(ctx);
  if (!VEO_RESOLUTIONS[modelOf(ctx)]) throw new Error("unsupported model; use " + meta.models.join(", "));
  return veoSubmitRequest(ctx);
}

export function parseSubmitResponse(ctx, resp) {
  const body = plainObject(resp.body) || {};
  if (omniModel(ctx)) {
    const id = trimmed(body.id);
    if (!id) throw new Error("Gemini Omni response is missing the interaction id");
    return { taskId: id, taskData: body };
  }
  if (!trimmed(body.name)) throw new Error("Veo response is missing the operation name");
  return { taskId: utils.base64URL(body.name), taskData: body };
}

export function extractUsage(ctx) {
  const req = ctx.requestBody || {};
  if (omniModel(ctx)) {
    // Input and text output are only known on completion, which reports them.
    return { input_tokens: 0, output_tokens: 0, video_tokens: omniSeconds(req) * OMNI_VIDEO_TOKENS_PER_SECOND[omniResolution(req)] };
  }
  return { seconds: veoSeconds(req), resolution: veoResolution(ctx, req), generate_audio: veoAudio(req) };
}

// Veo is charged as requested; Omni settles on reported usage.
export function extractUsageOnComplete(task, _result, data) {
  if (omniModel(task) || isInteraction(data)) return omniSettlement(data);
  return null;
}

export function buildQueryRequest(ctx) {
  if (ctx.authError) throw new Error(ctx.authError);
  if (omniModel(ctx)) return { url: interactionsURL(ctx, ctx.taskId), method: "GET", headers: requestHeaders(ctx) };
  return fetchOperation(ctx, utils.base64URLDecode(ctx.taskId));
}

export function parseTaskResult(ctx, body) {
  if (omniModel(ctx) || isInteraction(body)) return omniTaskResult(body);
  return veoTaskResult(body);
}

// Inline videos are too large for the stored task, which keeps only their
// media type, so a download fetches the operation or interaction again.
export function listArtifacts(task) {
  if (task.status !== "SUCCESS") return [];
  if (isInteraction(task.data)) {
    const omni = omniVideo(task.data);
    return omni ? [{ key: "video", type: "video", mimeType: omni.mimeType }] : [];
  }
  const video = firstVideo(task.data);
  if (!Object.keys(video).length || trimmed(video.gcsUri)) return [];
  return [{ key: "video", type: "video", mimeType: trimmed(video.mimeType) || "video/mp4" }];
}

export function buildContentRequest(ctx) {
  if (ctx.authError) throw new Error(ctx.authError);
  if (ctx.artifactKey !== "video") throw new Error("artifact_not_found");
  if (isInteraction(ctx.data)) {
    const omni = omniVideo(ctx.data);
    if (!omni) throw new Error("artifact_not_found");
    return {
      url: interactionsURL(ctx, ctx.upstreamTaskId),
      method: "GET",
      headers: requestHeaders(ctx),
      responseType: "json",
      contentPath: omni.path,
      mimeType: omni.mimeType,
    };
  }
  // Another gateway serves the video as the artifact of its task, the last
  // segment of the operation.
  if (viaGateway(ctx)) {
    const taskId = utils.base64URLDecode(ctx.upstreamTaskId).split("/").pop();
    return {
      url: baseUrl(ctx) + "/v1/tasks/" + encodeURIComponent(taskId) + "/artifacts/video/content",
      method: ctx.clientRequest.method,
      headers: { Authorization: "Bearer " + ctx.apiKey },
    };
  }
  return Object.assign(fetchOperation(ctx, utils.base64URLDecode(ctx.upstreamTaskId)), {
    responseType: "json",
    contentPath: ["response", "videos", 0, "bytesBase64Encoded"],
    mimeType: trimmed(firstVideo(ctx.data).mimeType) || "video/mp4",
  });
}

// ---- Client protocols ----

function responsesInput(req) {
  const texts = [];
  const found = [];
  const input = req.input;
  if (typeof input === "string") texts.push(input);
  else if (Array.isArray(input)) {
    for (const item of input) {
      if (typeof item === "string") {
        texts.push(item);
        continue;
      }
      if (!plainObject(item)) continue;
      const content = item.content === undefined ? [item] : Array.isArray(item.content) ? item.content : [item.content];
      for (const part of content) {
        if (typeof part === "string") {
          texts.push(part);
          continue;
        }
        if (!plainObject(part)) continue;
        if (["input_text", "text"].includes(part.type) && typeof part.text === "string") texts.push(part.text);
        if (["input_image", "image_url"].includes(part.type)) {
          let image = part.image_url;
          if (plainObject(image)) image = image.url;
          if (trimmed(image)) found.push(trimmed(image));
        }
      }
    }
  }
  return {
    prompt: texts
      .filter(function (text) {
        return trimmed(text);
      })
      .join("\n"),
    images: found,
  };
}

function videoText(ctx) {
  const artifact = ctx && ctx.artifacts && ctx.artifacts.video;
  const url = trimmed(artifact && artifact.url);
  if (!url) throw new Error("video artifact is unavailable");
  const escaped = url.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return '<video controls src="' + escaped + '"></video>';
}

function collectImages(req, extra) {
  const list = [];
  for (const image of [req.image, req.input_reference].concat(Array.isArray(req.images) ? req.images : [], extra || [])) {
    if (trimmed(image) && !list.includes(trimmed(image))) list.push(trimmed(image));
  }
  if (!list.every(validImageInput)) throw new Error("input image must be a data URL or base64 value");
  return list;
}

export const protocols = {
  openai_responses: {
    decodeRequest: function (ctx) {
      if (!ctx.body || ctx.body.kind !== "json") throw new Error("JSON body required");
      const req = plainObject(ctx.body.value);
      if (!req) throw new Error("request body must be an object");
      const model = trimmed(req.model);
      if (!model) throw new Error("model is required");
      if (req.input !== undefined && typeof req.input !== "string" && !Array.isArray(req.input)) throw new Error("input must be a string or array");
      if (req.images !== undefined && !Array.isArray(req.images)) throw new Error("images must be an array");
      if (req.metadata !== undefined && !plainObject(req.metadata)) throw new Error("metadata must be an object");
      const input = responsesInput(req);
      const prompt = input.prompt || trimmed(req.prompt);
      const list = collectImages(req, input.images);
      if (!prompt && !list.length) throw new Error("input is required");
      const requestBody = { model: model, prompt: prompt, metadata: Object.assign({}, req.metadata || {}) };
      if (list.length) requestBody.images = list;
      if (req.resolution !== undefined) requestBody.resolution = req.resolution;
      if (req.seconds !== undefined) requestBody.duration = req.seconds;
      else if (req.duration !== undefined) requestBody.duration = req.duration;
      if (req.size !== undefined) requestBody.size = req.size;
      return { kind: "submit", model: model, action: list.length ? "image_to_video" : "text_to_video", requestBody: requestBody };
    },
    renderEvents: function (ctx, task, previousState) {
      const status = String(task.status || "UNKNOWN").toUpperCase();
      const value = Number(String(task.progress || "").replace("%", ""));
      const progress = Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
      const state = { status: status, progress: progress };
      if (status === "SUCCESS") {
        const events = previousState && previousState.status === status ? [] : [{ type: "output", data: videoText(ctx) }];
        return { events: events, state: state, done: true };
      }
      if (status === "FAILURE")
        return { events: [{ type: "error", code: "task_failed", message: task.fail_reason || "task failed" }], state: state, done: true };
      if (previousState && previousState.status === status && previousState.progress === progress) return { events: [], state: state, done: false };
      const event = { type: "progress", message: status.toLowerCase() };
      if (progress !== null) event.progress = progress;
      return { events: [event], state: state, done: false };
    },
    renderFinal: function (ctx, _task) {
      return {
        output: [
          {
            type: "message",
            status: "completed",
            role: "assistant",
            content: [{ type: "output_text", text: videoText(ctx), annotations: [], logprobs: [] }],
          },
        ],
        metadata: { vendor: "vertex" },
      };
    },
  },
  openai_video: {
    decodeRequest: function (ctx) {
      if (!ctx.body || (ctx.body.kind !== "json" && ctx.body.kind !== "multipart")) throw new Error("JSON or multipart body required");
      let req;
      if (ctx.body.kind === "json") {
        if (!plainObject(ctx.body.value)) throw new Error("JSON object required");
        req = Object.assign({}, ctx.body.value);
        if (req.images !== undefined && !Array.isArray(req.images)) throw new Error("images must be an array");
        const list = collectImages(req);
        delete req.image;
        delete req.input_reference;
        if (list.length) req.images = list;
        else delete req.images;
      } else {
        req = {};
        const fields = ctx.body.fields || {};
        for (const field of Object.keys(fields)) {
          if ((fields[field] || []).length > 1) throw new Error(field + " must be provided once");
          req[field] = fields[field][0];
        }
        let upload = false;
        for (const file of ctx.body.files || []) {
          if (file.field !== "input_reference") throw new Error("unexpected file field: " + file.field);
          if (upload) throw new Error("input_reference must be provided once");
          if (!IMAGE_TYPES.includes(String(file.mimeType || "").toLowerCase())) throw new Error("input_reference must be image/jpeg or image/png");
          upload = true;
        }
        if (req.metadata !== undefined) {
          let parsed;
          try {
            parsed = JSON.parse(req.metadata);
          } catch {
            throw new Error("metadata must be a JSON object string");
          }
          if (!plainObject(parsed)) throw new Error("metadata must be a JSON object string");
          req.metadata = parsed;
        }
        if (upload) req.images = [{ __fileRef: "request_file:input_reference", encoding: "base64", maxBytes: 20971520 }];
      }
      const seconds = req.seconds !== undefined ? req.seconds : req.duration;
      delete req.seconds;
      if (seconds !== undefined && seconds !== "") {
        const n = Number(seconds);
        if (!Number.isFinite(n) || n <= 0) throw new Error("seconds must be a positive number");
        req.duration = n;
      } else delete req.duration;
      // Model-specific limits are checked where the request is priced.
      return {
        kind: "submit",
        model: ctx.model,
        action: req.images ? "image_to_video" : "text_to_video",
        requestBody: Object.assign({}, req, { model: ctx.model }),
      };
    },
    render: function (ctx, task) {
      const statuses = { NOT_START: "queued", SUBMITTED: "queued", QUEUED: "queued", IN_PROGRESS: "in_progress", SUCCESS: "completed", FAILURE: "failed" };
      const output = {
        id: task.task_id,
        object: "video",
        model: (task.properties || {}).origin_model_name || meta.models[0],
        status: statuses[task.status] || "unknown",
        progress: Number(String(task.progress || "0").replace("%", "")),
        created_at: task.created_at,
      };
      if (Number(task.finish_time) > 0) output.completed_at = Number(task.finish_time);
      else if (Number(task.updated_at) > 0) output.completed_at = Number(task.updated_at);
      return output;
    },
  },
};
