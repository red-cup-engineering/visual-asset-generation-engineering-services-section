import { createHash } from "node:crypto";

const ROLES = new Set(["primary-symbol","actor","institution","terrain","world","trajectory","threshold","signal","network","evidence","background-field","ornament"]);
const POLICIES = new Set(["generate","reuse-first","deterministic-only"]);
const USES = new Set(["article-hero","article-inline","homepage-card","social-card","email","video-still","slide","symbol-library"]);
const ASPECTS = new Set(["1:1","4:5","3:2","16:9","21:9"]);

function stableJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

export function niDigest(value) {
  return `ni:///sha-256;${createHash("sha256").update(stableJson(value)).digest("base64url")}`;
}

function nonempty(value, label) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${label} must be nonempty text`);
  return value.trim();
}

function hex(value, label) {
  if (typeof value !== "string" || !/^#[0-9a-fA-F]{6}$/u.test(value)) throw new TypeError(`${label} must be a six-digit hex color`);
  return value.toLowerCase();
}

export function admitScene(input) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) throw new TypeError("scene must be an object");
  if (input.version !== "koios.visual-scene/v1") throw new TypeError("scene version must be koios.visual-scene/v1");
  if (!USES.has(input.use)) throw new TypeError("scene use is not admitted");
  if (input.canvas === null || typeof input.canvas !== "object" || !ASPECTS.has(input.canvas.aspectRatio)) throw new TypeError("scene canvas aspect ratio is not admitted");
  if (input.palette === null || typeof input.palette !== "object") throw new TypeError("scene palette is required");
  const palette = Object.freeze(Object.fromEntries(Object.entries(input.palette).map(([key,value]) => [key,hex(value,`palette.${key}`)])));
  if (palette.paper !== "#fbfaf7" || palette.ink !== "#171a21" || palette.signal !== "#000088") throw new TypeError("scene does not carry the canonical Koios core palette");
  if (!Array.isArray(input.layers) || input.layers.length < 1 || input.layers.length > 16) throw new TypeError("scene must contain 1..16 layers");
  const seen = new Set();
  const layers = input.layers.map((raw,index) => {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new TypeError(`layers[${index}] must be an object`);
    const id = nonempty(raw.id,`layers[${index}].id`);
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/u.test(id) || seen.has(id)) throw new TypeError(`layers[${index}].id is invalid or duplicated`);
    seen.add(id);
    if (!ROLES.has(raw.role)) throw new TypeError(`layers[${index}].role is not admitted`);
    if (!POLICIES.has(raw.generatorPolicy)) throw new TypeError(`layers[${index}].generatorPolicy is not admitted`);
    if (!Number.isInteger(raw.z) || raw.z < 0 || raw.z > 99) throw new TypeError(`layers[${index}].z must be 0..99`);
    const prompt = typeof raw.semanticPrompt === "string" ? raw.semanticPrompt.trim() : "";
    return Object.freeze({
      id,
      role: raw.role,
      generatorPolicy: raw.generatorPolicy,
      primitiveHints: Object.freeze(Array.isArray(raw.primitiveHints) ? [...new Set(raw.primitiveHints.map(String))] : []),
      paletteRoles: Object.freeze(Array.isArray(raw.paletteRoles) ? [...new Set(raw.paletteRoles.map(String))] : []),
      transparent: raw.transparent === true,
      z: raw.z,
      semanticPrompt: prompt,
      avoid: Object.freeze(Array.isArray(raw.avoid) ? raw.avoid.map(String) : []),
    });
  }).sort((a,b) => a.z - b.z || a.id.localeCompare(b.id));
  const scene = Object.freeze({
    version: input.version,
    consumer: nonempty(input.consumer,"consumer"),
    use: input.use,
    canvas: Object.freeze({ aspectRatio: input.canvas.aspectRatio, safeArea: Number.isFinite(input.canvas.safeArea) ? Math.max(0,Math.min(.25,input.canvas.safeArea)) : .06 }),
    palette,
    layers: Object.freeze(layers),
    assembly: Object.freeze({
      eyeMark: input.assembly?.eyeMark !== false,
      wordmark: input.assembly?.wordmark === true,
      textMode: input.assembly?.textMode === "none" ? "none" : "deterministic-overlay",
      cropStrategy: ["cover","contain","subject-aware"].includes(input.assembly?.cropStrategy) ? input.assembly.cropStrategy : "subject-aware",
    }),
  });
  return Object.freeze({ id: niDigest(scene), ...scene });
}

export function compileComponentPrompt(sceneInput, layerId) {
  const scene = sceneInput.id ? sceneInput : admitScene(sceneInput);
  const layer = scene.layers.find((candidate) => candidate.id === layerId);
  if (!layer) throw new TypeError(`scene contains no layer ${layerId}`);
  if (layer.generatorPolicy === "deterministic-only") throw new TypeError(`layer ${layerId} is deterministic-only and must not be sent to an image generator`);
  const allowedColors = layer.paletteRoles.map((role) => scene.palette[role]).filter(Boolean);
  const prompt = [
    "Create ONE assemblable editorial illustration component, not a finished poster.",
    `Semantic role: ${layer.role}.`,
    layer.primitiveHints.length ? `Preferred geometry: ${layer.primitiveHints.join(", ")}.` : "",
    layer.semanticPrompt ? `Meaning: ${layer.semanticPrompt}` : "",
    `Visual language: clean modernist symbolic editorial illustration; Bauhaus/Swiss/linocut ancestry without vintage print defects; crisp vector-like silhouettes; large intentional flat fields; restrained 2.5D depth from overlap and scale.`,
    `Palette: ${allowedColors.length ? allowedColors.join(", ") : Object.values(scene.palette).join(", ")}. Do not introduce unrelated brand colors.`,
    layer.transparent ? "Background must be transparent/alpha where supported; isolate the component cleanly with generous edge clearance." : "Use a simple clean field that can be masked or cropped deterministically.",
    "No text, letters, numbers, logos, wordmarks, watermarks, faux paper grain, halftone damage, ink bleed, distressed edges, registration error, neon cyberpunk, glitch effects, SCP styling, or decorative UI.",
    layer.avoid.length ? `Also avoid: ${layer.avoid.join("; ")}.` : "",
    "The result must remain legible as a thumbnail and reusable in multiple publication layouts.",
  ].filter(Boolean).join("\n");
  return Object.freeze({
    id: niDigest({ scene: scene.id, layer: layer.id, prompt }),
    scene: scene.id,
    layer: layer.id,
    prompt,
    transparent: layer.transparent,
  });
}

function requestDescriptor(provider, url, body) {
  const descriptor = Object.freeze({ provider, method: "POST", url, headers: Object.freeze({ "content-type": "application/json", accept: "application/json" }), body: Object.freeze(body) });
  return Object.freeze({ id: niDigest(descriptor), ...descriptor });
}

export function buildGeminiRequest({ prompt, model = "gemini-3.1-flash-image", references = [], aspectRatio = "1:1", imageSize = "2K" } = {}) {
  nonempty(prompt,"prompt");
  if (!["gemini-3.1-flash-lite-image","gemini-3.1-flash-image","gemini-3-pro-image"].includes(model)) throw new TypeError("Gemini image model is not admitted");
  if (!ASPECTS.has(aspectRatio)) throw new TypeError("Gemini aspect ratio is not admitted");
  if (!["1K","2K","4K"].includes(imageSize)) throw new TypeError("Gemini imageSize is not admitted");
  if (!Array.isArray(references) || references.length > 8) throw new TypeError("Gemini references must contain at most eight images");
  const input = [{ type: "text", text: prompt }, ...references.map((ref,index) => {
    if (!ref || typeof ref.data !== "string" || !["image/png","image/jpeg","image/webp"].includes(ref.mimeType)) throw new TypeError(`Gemini reference ${index} is malformed`);
    return { type: "image", mime_type: ref.mimeType, data: ref.data };
  })];
  return requestDescriptor("google-gemini", "https://generativelanguage.googleapis.com/v1beta/interactions", {
    model,
    input,
    response_format: { type: "image", mime_type: "image/png", aspect_ratio: aspectRatio, image_size: imageSize },
  });
}

export function buildIdeogramRequest({ prompt, model = "ideogram-4-5", seed, aspectRatio = "1:1", numImages = 1, async = false } = {}) {
  nonempty(prompt,"prompt");
  if (!["ideogram-4-5","ideogram-4","p-image-ideogram"].includes(model)) throw new TypeError("Ideogram model is not admitted");
  if (!ASPECTS.has(aspectRatio)) throw new TypeError("Ideogram aspect ratio is not admitted");
  if (!Number.isInteger(numImages) || numImages < 1 || numImages > 8) throw new TypeError("Ideogram numImages must be 1..8");
  if (seed !== undefined && (!Number.isInteger(seed) || seed < 0 || seed > 2147483647)) throw new TypeError("Ideogram seed is invalid");
  return requestDescriptor("ideogram", `https://api.ideogram.ai/v2/image/generate/${model}`, {
    prompt,
    aspect_ratio: aspectRatio.replace(":","x"),
    num_images: numImages,
    enable_copyright_detection: true,
    async,
    ...(seed === undefined ? {} : { seed }),
  });
}

function hexRgb(value) {
  const admitted = hex(value,"color");
  return [
    Number.parseInt(admitted.slice(1,3),16),
    Number.parseInt(admitted.slice(3,5),16),
    Number.parseInt(admitted.slice(5,7),16),
  ];
}

const RECRAFT_MODELS = new Set([
  "recraftv4_1",
  "recraftv4_1_vector",
  "recraftv4_1_pro",
  "recraftv4_1_pro_vector",
  "recraftv4_1_utility",
  "recraftv4_1_utility_vector",
  "recraftv4_1_utility_pro",
  "recraftv4_1_utility_pro_vector",
]);

export function buildRecraftRequest({
  prompt,
  model = "recraftv4_1_vector",
  size = "1:1",
  n = 1,
  seed,
  colors = ["#fbfaf7","#171a21","#000088","#5366c4","#b9c1da"],
  backgroundColor,
  styleReferenceUrls = [],
  styleMatch = "precise",
} = {}) {
  nonempty(prompt,"prompt");
  if (!RECRAFT_MODELS.has(model)) throw new TypeError("Recraft model is not admitted");
  if (!(ASPECTS.has(size) || /^\d{2,5}x\d{2,5}$/u.test(size))) throw new TypeError("Recraft size is not admitted");
  if (!Number.isInteger(n) || n < 1 || n > 6) throw new TypeError("Recraft n must be 1..6");
  if (seed !== undefined && (!Number.isInteger(seed) || seed < 0 || seed > 2147483647)) throw new TypeError("Recraft seed is invalid");
  if (!Array.isArray(colors) || colors.length < 1 || colors.length > 12) throw new TypeError("Recraft colors must contain 1..12 colors");
  if (!Array.isArray(styleReferenceUrls) || styleReferenceUrls.length > 10 || styleReferenceUrls.some((url) => typeof url !== "string" || !/^https:\/\//u.test(url))) {
    throw new TypeError("Recraft style references must contain at most ten HTTPS URLs");
  }
  if (!["flexible","precise"].includes(styleMatch)) throw new TypeError("Recraft styleMatch is not admitted");
  const controls = { colors: colors.map((color) => ({ rgb: hexRgb(color) })) };
  if (backgroundColor !== undefined) controls.background_color = { rgb: hexRgb(backgroundColor) };
  return requestDescriptor("recraft", "https://external.api.recraft.ai/v1/images/generations", {
    prompt,
    model,
    size,
    n,
    response_format: "url",
    controls,
    ...(styleReferenceUrls.length === 0 ? {} : { style_reference_urls: styleReferenceUrls, style_match: styleMatch }),
    ...(seed === undefined ? {} : { random_seed: seed }),
  });
}

const OPENAI_IMAGE_MODELS = new Set([
  "gpt-image-2",
  "gpt-image-2.5-sunburst",
  "gpt-image-2.5-flare",
]);

export function buildOpenAIImageRequest({
  prompt,
  model = "gpt-image-2",
  size = "1024x1024",
  quality = "high",
  background = "transparent",
  outputFormat = "png",
  n = 1,
} = {}) {
  nonempty(prompt,"prompt");
  if (!OPENAI_IMAGE_MODELS.has(model)) throw new TypeError("OpenAI image model is not admitted");
  if (!(size === "auto" || /^\d{2,5}x\d{2,5}$/u.test(size))) throw new TypeError("OpenAI image size is not admitted");
  if (!["low","medium","high","xhigh","max","auto"].includes(quality)) throw new TypeError("OpenAI image quality is not admitted");
  if (!["transparent","opaque","auto"].includes(background)) throw new TypeError("OpenAI image background is not admitted");
  if (!["png","webp","jpeg"].includes(outputFormat)) throw new TypeError("OpenAI image output format is not admitted");
  if (!Number.isInteger(n) || n < 1 || n > 8) throw new TypeError("OpenAI image n must be 1..8");
  return requestDescriptor("openai-image", "https://api.openai.com/v1/images/generations", {
    model,
    prompt,
    size,
    quality,
    background,
    output_format: outputFormat,
    n,
  });
}

export function providerCandidates(layer) {
  if (!layer || layer.generatorPolicy === "deterministic-only") return Object.freeze([]);
  if (["institution","trajectory","evidence","primary-symbol","network","threshold"].includes(layer.role)) {
    return Object.freeze(["recraftv4_1_vector","recraftv4_1_pro_vector","ideogram-4-5","gemini-3.1-flash-image","gpt-image-2"]);
  }
  if (layer.transparent) {
    return Object.freeze(["ideogram-4-5","gpt-image-2","gemini-3-pro-image","gemini-3.1-flash-image","recraftv4_1_vector"]);
  }
  if (layer.role === "background-field" || layer.role === "terrain" || layer.role === "world") {
    return Object.freeze(["gemini-3.1-flash-image","gemini-3-pro-image","gpt-image-2","ideogram-4-5","recraftv4_1"]);
  }
  return Object.freeze(["ideogram-4-5","gpt-image-2","gemini-3.1-flash-image","recraftv4_1_vector","gemini-3-pro-image"]);
}

async function boundedJson(response, label) {
  const raw = await response.text();
  if (Buffer.byteLength(raw) > 4_000_000) throw new TypeError(`${label} response exceeds the bounded JSON limit`);
  if (!response.ok) throw new Error(`${label} ${response.status}: ${raw.slice(0,500)}`);
  try { return JSON.parse(raw); } catch { throw new TypeError(`${label} returned malformed JSON`); }
}

function findGeminiImages(value, found = []) {
  if (Array.isArray(value)) {
    for (const item of value) findGeminiImages(item,found);
    return found;
  }
  if (value === null || typeof value !== "object") return found;
  const mime = value.mime_type ?? value.mimeType;
  const data = value.data;
  if (typeof mime === "string" && mime.startsWith("image/") && typeof data === "string" && data.length > 0) {
    found.push(Object.freeze({ kind:"inline", mediaType:mime, data }));
  }
  if (value.output_image && typeof value.output_image === "object") findGeminiImages(value.output_image,found);
  for (const [key,child] of Object.entries(value)) if (key !== "output_image") findGeminiImages(child,found);
  return found;
}

export function normalizeProviderResponse(provider, payload) {
  if (provider === "ideogram") {
    const data = Array.isArray(payload?.data) ? payload.data : [];
    const assets = data.flatMap((item) => {
      if (!item || typeof item.url !== "string") return [];
      return [Object.freeze({
        kind:"url",
        url:item.url,
        seed:Number.isInteger(item.seed) ? item.seed : null,
        resolution:typeof item.resolution === "string" ? item.resolution : null,
        safe:item.is_image_safe !== false,
      })];
    });
    if (assets.length === 0 && typeof payload?.generation_id === "string") {
      return Object.freeze({ provider, status:"pending", generationId:payload.generation_id, assets:Object.freeze([]), raw:payload });
    }
    if (assets.length === 0) throw new TypeError("Ideogram response contains no image assets");
    return Object.freeze({ provider, status:"completed", generationId:payload?.generation_id ?? null, assets:Object.freeze(assets), raw:payload });
  }
  if (provider === "google-gemini") {
    const assets=findGeminiImages(payload);
    if (assets.length === 0) throw new TypeError("Gemini response contains no image assets");
    return Object.freeze({ provider, status:"completed", generationId:payload?.id ?? null, assets:Object.freeze(assets), raw:payload });
  }
  if (provider === "recraft") {
    const data = Array.isArray(payload?.data) ? payload.data : [];
    const assets = data.flatMap((item) => {
      if (!item || typeof item.url !== "string") return [];
      return [Object.freeze({
        kind:"url",
        url:item.url,
        imageId:typeof item.image_id === "string" ? item.image_id : null,
        safe:true,
      })];
    });
    if (assets.length === 0) throw new TypeError("Recraft response contains no image assets");
    return Object.freeze({ provider, status:"completed", generationId:null, credits:Number.isFinite(payload?.credits) ? payload.credits : null, assets:Object.freeze(assets), raw:payload });
  }
  if (provider === "openai-image") {
    const data = Array.isArray(payload?.data) ? payload.data : [];
    const assets = data.flatMap((item) => typeof item?.b64_json === "string" && item.b64_json.length > 0
      ? [Object.freeze({ kind:"inline", mediaType:`image/${payload?.output_format === "jpeg" ? "jpeg" : payload?.output_format === "webp" ? "webp" : "png"}`, data:item.b64_json })]
      : []);
    if (assets.length === 0) throw new TypeError("OpenAI image response contains no base64 image assets");
    return Object.freeze({ provider, status:"completed", generationId:null, usage:payload?.usage ?? null, assets:Object.freeze(assets), raw:payload });
  }
  throw new TypeError(`unsupported visual provider response: ${provider}`);
}

export async function executeProviderRequest({ authorizedFetch, descriptor } = {}) {
  if (typeof authorizedFetch !== "function") throw new TypeError("provider execution requires an attenuated authorizedFetch capability");
  if (!descriptor || !["google-gemini","ideogram","recraft","openai-image"].includes(descriptor.provider)) throw new TypeError("provider request descriptor is not admitted");
  const headers={...descriptor.headers};
  for(const name of Object.keys(headers)) if (name.toLowerCase()==="authorization" || name.toLowerCase()==="api-key" || name.toLowerCase()==="x-goog-api-key") {
    throw new TypeError("provider credentials must be added by the authorizedFetch capability, not stored in the descriptor");
  }
  const response=await authorizedFetch(descriptor.url,{method:descriptor.method,redirect:"error",headers,body:JSON.stringify(descriptor.body)});
  const payload=await boundedJson(response,descriptor.provider);
  return normalizeProviderResponse(descriptor.provider,payload);
}

function esc(value) {
  return String(value).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll('"',"&quot;");
}

function frameFor(index, total, width, height, safe) {
  const innerX = width * safe, innerY = height * safe;
  const innerW = width * (1 - safe * 2), innerH = height * (1 - safe * 2);
  if (total === 1) return { x: innerX, y: innerY, width: innerW, height: innerH };
  const cols = Math.ceil(Math.sqrt(total));
  const rows = Math.ceil(total / cols);
  const gap = Math.min(width,height) * .018;
  const cellW = (innerW - gap * (cols - 1)) / cols;
  const cellH = (innerH - gap * (rows - 1)) / rows;
  const col = index % cols, row = Math.floor(index / cols);
  return { x: innerX + col * (cellW + gap), y: innerY + row * (cellH + gap), width: cellW, height: cellH };
}

export function assembleSvg({ scene: input, components = {}, width = 1600, height = 900, label } = {}) {
  const scene = input?.id ? input : admitScene(input);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 320 || height < 180 || width > 8192 || height > 8192) throw new TypeError("assembly dimensions are invalid");
  const generated = scene.layers.filter((layer) => layer.generatorPolicy !== "deterministic-only");
  const images = generated.map((layer,index) => {
    const component = components[layer.id];
    if (!component || typeof component.href !== "string" || component.href.trim() === "") throw new TypeError(`assembly is missing component ${layer.id}`);
    const frame = component.frame ?? frameFor(index, generated.length, width, height, scene.canvas.safeArea);
    const fit = component.fit === "contain" ? "xMidYMid meet" : "xMidYMid slice";
    return `<image data-layer="${esc(layer.id)}" href="${esc(component.href)}" x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${frame.height}" preserveAspectRatio="${fit}"/>`;
  }).join("\n");
  const eye = scene.assembly.eyeMark ? `<g id="koios-eye" transform="translate(${width - 96} 72)" fill="none" stroke="${scene.palette.paper}" stroke-width="5"><path d="M-42 0C-22-26 22-26 42 0C22 26-22 26-42 0Z"/><circle cx="0" cy="0" r="12" fill="${scene.palette.paper}" stroke="none"/><circle cx="0" cy="0" r="5" fill="${scene.palette.signal}" stroke="none"/></g>` : "";
  const deterministicLabel = scene.assembly.textMode === "deterministic-overlay" && label ? `<text x="${width * scene.canvas.safeArea}" y="${height - height * scene.canvas.safeArea}" font-family="system-ui,sans-serif" font-size="${Math.max(18,Math.round(height*.035))}" font-weight="650" fill="${scene.palette.ink}">${esc(label)}</text>` : "";
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img">`,
    `<rect width="${width}" height="${height}" fill="${scene.palette.paper}"/>`,
    images,
    `<rect x="0" y="0" width="${Math.max(8,Math.round(width*.008))}" height="${height}" fill="${scene.palette.signal}"/>`,
    eye,
    deterministicLabel,
    "</svg>",
  ].join("\n");
  return Object.freeze({ id: niDigest({ scene: scene.id, width, height, svg }), mediaType: "image/svg+xml", svg });
}

export function assetManifest({ scene, components, assembly, consumerUse } = {}) {
  if (!scene?.id || !assembly?.id) throw new TypeError("asset manifest requires admitted scene and assembly");
  const manifest = Object.freeze({
    type: "VisualAssetManifest",
    version: 1,
    scene: scene.id,
    consumer: scene.consumer,
    use: consumerUse ?? scene.use,
    components: Object.freeze(Object.entries(components).sort(([a],[b]) => a.localeCompare(b)).map(([layer,value]) => Object.freeze({ layer, asset: value.assetId ?? null, provider: value.provider ?? null, reused: value.reused === true }))),
    assembly: assembly.id,
  });
  return Object.freeze({ id: niDigest(manifest), ...manifest });
}
