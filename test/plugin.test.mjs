// Runs the hooks the way new-api calls them: node --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

globalThis.utils = {
  base64URL: (s) => Buffer.from(String(s)).toString("base64url"),
  base64URLDecode: (s) => Buffer.from(String(s), "base64url").toString(),
};

const plugin = await import("../plugin.js");
const { meta, protocols, buildSubmitRequest, parseSubmitResponse, extractUsage, extractUsageOnComplete, buildQueryRequest, parseTaskResult, listArtifacts, buildContentRequest } =
  plugin;

const BASE = "https://aiplatform.googleapis.com";
const OP_FIELD = "operation" + "N" + "ame";
const PNG = "data:image/png;base64,iVBORw0KGgoAAAA";
const JPEG = "/9j/4AAQSkZJRg";

function deepFreeze(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function decode(value, model) {
  return protocols.openai_video.decodeRequest({ model: model || value.model, body: { kind: "json", value: value } });
}

function ctxFor(intent, extra) {
  return Object.assign(
    {
      requestBody: intent.requestBody,
      action: intent.action,
      model: intent.model,
      upstreamModel: intent.model,
      baseUrl: BASE,
      apiKey: "{}",
      authHeader: "Bearer ya29.test",
      auth: { projectId: "proj-1" },
      upstream: { kind: "vendor" },
      config: { region: "us-central1" },
      files: [],
      publicTaskId: "task_1",
    },
    extra || {},
  );
}

test("meta is a plain JSON literal with a neutral key", () => {
  const source = readFileSync(new URL("../plugin.js", import.meta.url), "utf8");
  const block = source.match(/export const meta = (\{[\s\S]*?\n\});/);
  assert.ok(block);
  const json = block[1].replace(/^\s*\/\/[^\n]*\n/gm, "").replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":').replace(/,(\s*[}\]])/g, "$1");
  assert.deepEqual(JSON.parse(json), meta);
  assert.equal(meta.key, "byaiden_gemini_vertex");
  assert.ok(readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8").includes("\nversion: " + meta.version + "\n"));
  assert.deepEqual(meta.upstreams, ["vendor", "new_api"]);
  assert.equal(meta.channelTypes, undefined);
  assert.equal(meta.baseUrl, BASE);
  assert.equal(meta.author.url, "https://github.com/" + meta.author.name);
  assert.deepEqual(meta.models, ["veo-3.1-generate-001", "veo-3.1-fast-generate-001", "veo-3.1-lite-generate-001", "gemini-omni-1.2-flash"]);
});

test("usage examples equal the reservation they describe", () => {
  for (const example of meta.usageExamples) {
    const [seconds, resolution, audio] = [example.facts.seconds, example.facts.resolution, example.facts.generate_audio];
    const intent = decode({ model: "veo-3.1-generate-001", prompt: "x", seconds, resolution, metadata: { generateAudio: audio } });
    assert.deepEqual(extractUsage(ctxFor(intent)), example.facts, example.label);
  }
  const specs = { "3s 360p": [3, "360p"], "8s 720p": [8, "720p"], "8s 1080p": [8, "1080p"], "10s 4k": [10, "4k"] };
  for (const example of meta.usageProfiles[0].examples) {
    const [seconds, resolution] = specs[example.label];
    assert.deepEqual(extractUsage(ctxFor(decode({ model: "gemini-omni-1.2-flash", prompt: "x", seconds, resolution }))), example.facts, example.label);
  }
});

test("a Veo request runs submit, poll and download like the gateway", () => {
  const intent = decode({ model: "veo-3.1-generate-001", prompt: "A boat", seconds: 6, size: "1080x1920", metadata: { generateAudio: false, seed: 7 } });
  const ctx = deepFreeze(ctxFor(intent));
  assert.deepEqual(extractUsage(ctx), { seconds: 6, resolution: "1080p", generate_audio: false });
  const request = buildSubmitRequest(ctx);
  assert.equal(request.url, "https://us-central1-aiplatform.googleapis.com/v1/projects/proj-1/locations/us-central1/publishers/google/models/veo-3.1-generate-001:predictLongRunning");
  assert.equal(request.headers.Authorization, "Bearer ya29.test");
  assert.equal(request.headers["x-goog-user-project"], "proj-1");
  assert.deepEqual(request.body, {
    instances: [{ prompt: "A boat" }],
    parameters: { seed: 7, generateAudio: false, durationSeconds: 6, resolution: "1080p", aspectRatio: "9:16", sampleCount: 1 },
  });
  assert.equal(request.action, "text_to_video");

  const opName = "projects/proj-1/locations/us-central1/publishers/google/models/veo-3.1-generate-001/operations/op-9";
  const parsed = parseSubmitResponse(ctx, deepFreeze({ statusCode: 200, body: { name: opName } }));
  assert.equal(utils.base64URLDecode(parsed.taskId), opName);

  const query = { taskId: parsed.taskId, model: "veo-3.1-generate-001", upstreamModel: "veo-3.1-generate-001", baseUrl: BASE, authHeader: "Bearer t", auth: { projectId: "proj-1" }, upstream: { kind: "vendor" }, config: {} };
  const poll = buildQueryRequest(query);
  assert.equal(poll.url, "https://us-central1-aiplatform.googleapis.com/v1/projects/proj-1/locations/us-central1/publishers/google/models/veo-3.1-generate-001:fetchPredictOperation");
  assert.equal(poll.body[OP_FIELD], opName);
  assert.equal(parseTaskResult(query, { name: opName }).status, "IN_PROGRESS");
  const done = { name: opName, done: true, response: { videos: [{ bytesBase64Encoded: "AAAA", mimeType: "video/mp4" }] } };
  assert.deepEqual(parseTaskResult(query, done), { status: "SUCCESS", progress: "100%" });
  assert.equal(extractUsageOnComplete(query, {}, done), null);

  const stored = { name: opName, done: true, response: { videos: [{ mimeType: "video/mp4" }] } };
  assert.deepEqual(listArtifacts({ status: "SUCCESS", data: stored }), [{ key: "video", type: "video", mimeType: "video/mp4" }]);
  const content = buildContentRequest(Object.assign({}, query, { artifactKey: "video", data: stored, upstreamTaskId: parsed.taskId, clientRequest: { method: "GET" } }));
  assert.equal(content.url, poll.url);
  assert.deepEqual(content.contentPath, ["response", "videos", 0, "bytesBase64Encoded"]);
});

test("Veo defaults are 8 seconds at 720p with audio, landscape, sent explicitly", () => {
  const ctx = ctxFor(decode({ model: "veo-3.1-fast-generate-001", prompt: "x" }));
  assert.deepEqual(extractUsage(ctx), { seconds: 8, resolution: "720p", generate_audio: true });
  assert.deepEqual(buildSubmitRequest(ctx).body.parameters, { durationSeconds: 8, resolution: "720p", generateAudio: true, aspectRatio: "16:9", sampleCount: 1 });
});

test("Veo images become the first and last frame", () => {
  const one = buildSubmitRequest(ctxFor(decode({ model: "veo-3.1-generate-001", prompt: "go", input_reference: PNG })));
  assert.deepEqual(one.body.instances[0].image, { bytesBase64Encoded: "iVBORw0KGgoAAAA", mimeType: "image/png" });
  assert.equal(one.action, "image_to_video");
  const two = buildSubmitRequest(ctxFor(decode({ model: "veo-3.1-generate-001", prompt: "morph", images: [PNG, JPEG] })));
  assert.deepEqual(two.body.instances[0].lastFrame, { bytesBase64Encoded: JPEG, mimeType: "image/jpeg" });
  assert.throws(() => buildSubmitRequest(ctxFor(decode({ model: "veo-3.1-generate-001", prompt: "x", images: [PNG, JPEG, PNG + "A"] }))), /at most 2/);
});

test("Veo limits follow the model", () => {
  assert.throws(() => extractUsage(ctxFor(decode({ model: "veo-3.1-generate-001", prompt: "x", seconds: 5 }))), /4, 6, or 8/);
  assert.throws(() => extractUsage(ctxFor(decode({ model: "veo-3.1-fast-generate-001", prompt: "x", resolution: "4k" }))), /720p, 1080p for veo-3.1-fast/);
  assert.throws(() => extractUsage(ctxFor(decode({ model: "veo-3.1-lite-generate-001", prompt: "x", size: "3840x2160" }))), /720p, 1080p/);
  assert.equal(extractUsage(ctxFor(decode({ model: "veo-3.1-generate-001", prompt: "x", resolution: "4K" }))).resolution, "4k");
  assert.throws(() => extractUsage(ctxFor(decode({ model: "veo-3.1-generate-001", prompt: "x", metadata: { storageUri: "gs://b/" } }))), /metadata.storageUri is not supported/);
  assert.throws(() => extractUsage(ctxFor(decode({ model: "veo-3.1-generate-001", prompt: "x", metadata: { generateAudio: "no" } }))), /true or false/);
});

test("Veo runs on the us-central1 host, which meta allows", () => {
  const request = buildSubmitRequest(ctxFor(decode({ model: "veo-3.1-generate-001", prompt: "x" })));
  assert.match(request.url, /^https:\/\/us-central1-aiplatform\.googleapis\.com\/v1\/projects\/proj-1\/locations\/us-central1\//);
  assert.ok(meta.allowedHosts.includes(new URL(request.url).host));
  assert.equal(meta.channelConfig, undefined);
});

test("Veo safety blocks and missing videos fail the task", () => {
  const name = "projects/p/locations/us-central1/publishers/google/models/m/operations/o";
  assert.deepEqual(parseTaskResult({ model: "veo-3.1-generate-001" }, { name, done: true, response: { raiMediaFilteredCount: 1, raiMediaFilteredReasons: ["child"] } }), {
    status: "FAILURE",
    progress: "100%",
    reason: "child",
  });
  assert.equal(parseTaskResult({ model: "veo-3.1-generate-001" }, { name, done: true, response: {} }).status, "FAILURE");
  assert.equal(parseTaskResult({ model: "veo-3.1-generate-001" }, { name, error: { message: "quota" } }).reason, "quota");
  assert.equal(parseTaskResult({ model: "veo-3.1-generate-001" }, {}).status, "UNKNOWN");
});

const DONE = {
  id: "int_1",
  object: "interaction",
  status: "completed",
  usage: { total_input_tokens: 14, output_tokens_by_modality: [{ modality: "video", tokens: 5793 }], total_thought_tokens: 535 },
  steps: [
    { type: "user_input", content: [{ type: "text", text: "x" }] },
    { type: "model_output", content: [{ type: "video", mime_type: "video/mp4", data: "AAAA" }] },
  ],
};

test("an Omni request runs on the global Interactions endpoint and settles on usage", () => {
  const intent = decode({ model: "gemini-omni-1.2-flash", prompt: "A boat", seconds: 3, resolution: "360p" });
  const ctx = deepFreeze(ctxFor(intent, { config: { region: "europe-west4" } }));
  assert.deepEqual(extractUsage(ctx), { input_tokens: 0, output_tokens: 0, video_tokens: 5793 });
  const request = buildSubmitRequest(ctx);
  assert.equal(request.url, BASE + "/v1beta1/projects/proj-1/locations/global/interactions");
  assert.deepEqual(request.body, {
    model: "gemini-omni-1.2-flash",
    input: [{ type: "text", text: "A boat" }],
    response_format: { type: "video", aspect_ratio: "16:9", resolution: "360p", duration: "3s" },
    background: true,
    store: true,
    generation_config: { video_config: { task: "text_to_video" } },
  });
  assert.equal(parseSubmitResponse(ctx, { statusCode: 200, body: { id: "int_1", object: "interaction", status: "in_progress" } }).taskId, "int_1");
  const query = Object.assign({}, ctx, { taskId: "int_1" });
  assert.equal(buildQueryRequest(query).url, BASE + "/v1beta1/projects/proj-1/locations/global/interactions/int_1");
  assert.deepEqual(parseTaskResult(query, DONE), { status: "SUCCESS", progress: "100%" });
  assert.deepEqual(extractUsageOnComplete(query, {}, DONE), { input_tokens: 14, output_tokens: 535, video_tokens: 5793 });
  assert.deepEqual(listArtifacts({ status: "SUCCESS", data: DONE }), [{ key: "video", type: "video", mimeType: "video/mp4" }]);
  const content = buildContentRequest(Object.assign({}, query, { artifactKey: "video", data: DONE, upstreamTaskId: "int_1" }));
  assert.deepEqual(content.contentPath, ["steps", 1, "content", 0, "data"]);
});

test("Omni limits: 3 to 15 seconds, 10 with two frames, at most 6 images", () => {
  assert.throws(() => extractUsage(ctxFor(decode({ model: "gemini-omni-1.2-flash", prompt: "x", seconds: 16 }))), /3 to 15/);
  assert.throws(() => extractUsage(ctxFor(decode({ model: "gemini-omni-1.2-flash", prompt: "x", images: [PNG, JPEG], seconds: 12 }))), /3 to 10/);
  const many = Array.from({ length: 7 }, (_, i) => PNG + "A".repeat(i));
  assert.throws(() => buildSubmitRequest(ctxFor(decode({ model: "gemini-omni-1.2-flash", prompt: "x", images: many }))), /at most 6/);
  assert.throws(() => extractUsage(ctxFor(decode({ model: "gemini-omni-1.2-flash", prompt: "x", resolution: "480p" }))), /360p, 720p/);
});

test("a multipart upload is the first frame", () => {
  const intent = protocols.openai_video.decodeRequest({
    model: "veo-3.1-generate-001",
    body: { kind: "multipart", fields: { prompt: ["go"], seconds: ["4"] }, files: [{ field: "input_reference", mimeType: "image/jpeg", ref: "request_file:input_reference" }] },
  });
  const ctx = ctxFor(intent, { files: [{ field: "input_reference", mimeType: "image/jpeg", ref: "request_file:input_reference" }] });
  const image = buildSubmitRequest(ctx).body.instances[0].image;
  assert.equal(image.mimeType, "image/jpeg");
  assert.equal(image.bytesBase64Encoded.__fileRef, "request_file:input_reference");
  assert.throws(
    () => protocols.openai_video.decodeRequest({ model: "m", body: { kind: "multipart", fields: {}, files: [{ field: "input_reference", mimeType: "image/gif" }] } }),
    /image\/jpeg or image\/png/,
  );
});

test("the Responses protocol decodes text and images", () => {
  const intent = protocols.openai_responses.decodeRequest({
    body: { kind: "json", value: { model: "veo-3.1-generate-001", input: [{ role: "user", content: [{ type: "input_text", text: "A cat" }, { type: "input_image", image_url: PNG }] }], seconds: 4 } },
  });
  assert.equal(intent.action, "image_to_video");
  const body = buildSubmitRequest(ctxFor(intent)).body;
  assert.equal(body.parameters.durationSeconds, 4);
  assert.equal(body.instances[0].prompt, "A cat");
  const final = protocols.openai_responses.renderFinal({ artifacts: { video: { url: "https://gw.example/v.mp4?a=1&b=2" } } }, {});
  assert.match(final.output[0].content[0].text, /a=1&amp;b=2/);
});

test("credentials: auth errors and missing projects stop the submit", () => {
  const intent = decode({ model: "veo-3.1-generate-001", prompt: "x" });
  assert.throws(() => buildSubmitRequest(ctxFor(intent, { authError: "invalid service account" })), /invalid service account/);
  assert.throws(() => buildSubmitRequest(ctxFor(intent, { auth: {} })), /project_id/);
  assert.throws(() => buildSubmitRequest(ctxFor(intent, { auth: {}, authError: "token exchange failed" })), /token exchange failed/);
  assert.throws(() => decode({ model: "veo-3.1-generate-001", prompt: "x", seconds: -1 }), /positive/);
});

test("through another New API gateway Veo goes to its OpenAI video endpoint with a Bearer token", () => {
  const gw = { baseUrl: "https://up.example", apiKey: "sk-up", authHeader: "Bearer sk-up", upstream: { kind: "new_api" }, auth: {} };
  const ctx = deepFreeze(ctxFor(decode({ model: "veo-3.1-generate-001", prompt: "x", seconds: 4, size: "1920x1080", metadata: { generateAudio: false, negativePrompt: "rain" } }), gw));
  const veo = buildSubmitRequest(ctx);
  assert.equal(veo.url, "https://up.example/v1/videos");
  assert.deepEqual(veo.headers, { "Content-Type": "application/json", Accept: "application/json", Authorization: "Bearer sk-up" });
  // Every price fact goes out explicitly, so both gateways bill the same video.
  assert.deepEqual(veo.body, { model: "veo-3.1-generate-001", seconds: 4, resolution: "1080p", metadata: { negativePrompt: "rain", generateAudio: false }, prompt: "x", size: "1920x1080" });
  assert.deepEqual(extractUsage(ctx), { seconds: 4, resolution: "1080p", generate_audio: false });
  const again = decode(veo.body);
  assert.deepEqual(extractUsage(ctxFor(again)), extractUsage(ctx));

  const created = { id: "task_up1", object: "video", model: "veo-3.1-generate-001", status: "queued", progress: 0 };
  assert.deepEqual(parseSubmitResponse(ctx, deepFreeze({ statusCode: 200, body: created })), { taskId: "task_up1", taskData: created });
  const query = deepFreeze({ taskId: "task_up1", model: "veo-3.1-generate-001", upstreamModel: "veo-3.1-generate-001", baseUrl: "https://up.example", apiKey: "sk-up", authHeader: "Bearer sk-up", auth: {}, upstream: { kind: "new_api" } });
  assert.deepEqual(buildQueryRequest(query), { url: "https://up.example/v1/videos/task_up1", method: "GET", headers: { Accept: "application/json", Authorization: "Bearer sk-up" } });
  assert.deepEqual(parseTaskResult(query, { ...created, status: "in_progress", progress: 50 }), { status: "IN_PROGRESS", progress: "50%" });
  assert.deepEqual(parseTaskResult(query, { ...created, status: "failed", error: { message: "blocked" } }), { status: "FAILURE", progress: "100%", reason: "blocked" });
  const finished = deepFreeze({ ...created, status: "completed", progress: 100 });
  assert.deepEqual(parseTaskResult(query, finished), { status: "SUCCESS", progress: "100%" });
  // Veo is charged as requested on both gateways.
  assert.equal(extractUsageOnComplete(query, {}, finished), null);
  assert.deepEqual(listArtifacts({ status: "SUCCESS", data: finished }), [{ key: "video", type: "video", mimeType: "video/mp4" }]);
  assert.deepEqual(buildContentRequest(Object.assign({}, query, { artifactKey: "video", data: finished, upstreamTaskId: "task_up1", clientRequest: { method: "GET" } })), {
    url: "https://up.example/v1/videos/task_up1/content",
    method: "GET",
    headers: { Authorization: "Bearer sk-up" },
  });
});

test("through another New API gateway the service account is not used and the project is not needed", () => {
  const gw = { baseUrl: "https://up.example", apiKey: "sk-up", authHeader: "Bearer sk-up", upstream: { kind: "new_api" }, auth: {} };
  const veo = buildSubmitRequest(ctxFor(decode({ model: "veo-3.1-fast-generate-001", prompt: "x", input_reference: PNG }), gw));
  assert.equal(veo.headers["x-goog-user-project"], undefined);
  assert.equal(veo.headers.Authorization, "Bearer sk-up");
  assert.deepEqual(veo.body.images, [PNG]);
  assert.equal(veo.action, "image_to_video");
  assert.equal(veo.body.metadata.generateAudio, true);
  assert.throws(() => buildSubmitRequest(ctxFor(decode({ model: "veo-3.1-fast-generate-001", prompt: "x", resolution: "4k" }), gw)), /720p, 1080p/);
  assert.throws(() => buildSubmitRequest(ctxFor(decode({ model: "veo-3.1-generate-001", prompt: "x", images: [PNG, JPEG, PNG + "A"] }), gw)), /at most 2 images/);
});

test("through another New API gateway Omni settles on the usage that gateway billed", () => {
  const gw = { baseUrl: "https://up.example", apiKey: "sk-up", authHeader: "Bearer sk-up", upstream: { kind: "new_api" }, auth: {} };
  const files = [{ field: "input_reference", mimeType: "image/jpeg", ref: "request_file:input_reference" }];
  const intent = protocols.openai_video.decodeRequest({
    model: "gemini-omni-1.2-flash",
    body: { kind: "multipart", fields: { prompt: ["animate"], seconds: ["5"], size: ["720x1280"] }, files: files },
  });
  const request = buildSubmitRequest(ctxFor(intent, Object.assign({ files: files }, gw)));
  assert.equal(request.url, "https://up.example/v1/videos");
  assert.equal(request.body.images[0].__fileRef, "request_file:input_reference");
  assert.equal(request.body.seconds, 5);
  assert.equal(request.body.resolution, "720p");
  const query = { taskId: "task_up2", model: "gemini-omni-1.2-flash", upstreamModel: "gemini-omni-1.2-flash", baseUrl: "https://up.example", apiKey: "sk-up", upstream: { kind: "new_api" } };
  const finished = { id: "task_up2", object: "video", status: "completed", progress: 100, usage: { input_tokens: 14, output_tokens: 535, video_tokens: 5793 } };
  assert.deepEqual(parseTaskResult(query, finished), { status: "SUCCESS", progress: "100%" });
  assert.deepEqual(extractUsageOnComplete(query, {}, finished), { input_tokens: 14, output_tokens: 535, video_tokens: 5793 });
  assert.equal(extractUsageOnComplete(query, {}, { id: "task_up2", object: "video", status: "completed" }), null);
  const view = { task_id: "task_pub", status: "SUCCESS", progress: "100%", data: DONE, properties: { origin_model_name: "gemini-omni-1.2-flash" } };
  assert.deepEqual(Object.keys(protocols.openai_video.render({}, view).usage).sort(), ["input_tokens", "output_tokens", "video_tokens"]);
  assert.deepEqual(protocols.openai_video.render({}, view).usage, extractUsageOnComplete({ model: "gemini-omni-1.2-flash" }, {}, DONE));
});

test("a mapped alias sends the upstream model name", () => {
  const intent = decode({ model: "video", prompt: "x" }, "video");
  const request = buildSubmitRequest(ctxFor(intent, { model: "video", upstreamModel: "veo-3.1-lite-generate-001" }));
  assert.match(request.url, /models\/veo-3\.1-lite-generate-001:predictLongRunning$/);
});

test("code never references meta, so the gateway can read it statically", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../plugin.js", import.meta.url), "utf8");
  const rest = src.slice(src.indexOf("\n};\n", src.indexOf("export const meta = {")));
  assert.doesNotMatch(rest, /(^|[^A-Za-z0-9_$.])meta([^A-Za-z0-9_$]|$)/m);
  assert.ok(rest.includes(JSON.stringify(meta.models)));
});
