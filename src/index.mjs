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

export function niBytes(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError("niBytes requires Uint8Array bytes");
  return `ni:///sha-256;${createHash("sha256").update(bytes).digest("base64url")}`;
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
  if (input.version !== "koios.visual-scene/v3") throw new TypeError("scene version must be koios.visual-scene/v3");
  if (!USES.has(input.use)) throw new TypeError("scene use is not admitted");
  if (input.canvas === null || typeof input.canvas !== "object" || !ASPECTS.has(input.canvas.aspectRatio)) throw new TypeError("scene canvas aspect ratio is not admitted");
  if (!input.projection || typeof input.projection !== "object" || Array.isArray(input.projection)
      || input.projection.kind !== "isometric" || input.projection.axisAngleDeg !== 30 || input.projection.parallel !== true) {
    throw new TypeError("Koios scene v3 requires canonical isometric parallel projection at ±30 degrees");
  }
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
    const layout = raw.layout;
    if (!layout || typeof layout !== "object" || Array.isArray(layout)) throw new TypeError(`layers[${index}].layout is required`);
    for (const key of ["x","y","width","height"]) {
      const value = layout[key];
      if (!Number.isFinite(value) || value < 0 || value > 1 || (key === "width" || key === "height") && value === 0) {
        throw new TypeError(`layers[${index}].layout.${key} is outside normalized bounds`);
      }
    }
    if (layout.x + layout.width > 1.000001 || layout.y + layout.height > 1.000001) throw new TypeError(`layers[${index}].layout escapes the normalized canvas`);
    const anchor = layout.anchor ?? "center";
    if (!["center","north","south","east","west","north-east","north-west","south-east","south-west"].includes(anchor)) throw new TypeError(`layers[${index}].layout.anchor is not admitted`);
    const fit = layout.fit ?? "contain";
    if (!["contain","cover"].includes(fit)) throw new TypeError(`layers[${index}].layout.fit is not admitted`);
    const opacity = layout.opacity ?? 1;
    if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) throw new TypeError(`layers[${index}].layout.opacity is not admitted`);
    const rotation = layout.rotation ?? 0;
    if (!Number.isFinite(rotation) || rotation < -180 || rotation > 180) throw new TypeError(`layers[${index}].layout.rotation is not admitted`);
    const blend = layout.blend ?? "normal";
    if (!["normal","multiply","screen"].includes(blend)) throw new TypeError(`layers[${index}].layout.blend is not admitted`);
    const prompt = typeof raw.semanticPrompt === "string" ? raw.semanticPrompt.trim() : "";
    return Object.freeze({
      id,
      role: raw.role,
      generatorPolicy: raw.generatorPolicy,
      primitiveHints: Object.freeze(Array.isArray(raw.primitiveHints) ? [...new Set(raw.primitiveHints.map(String))] : []),
      paletteRoles: Object.freeze(Array.isArray(raw.paletteRoles) ? [...new Set(raw.paletteRoles.map(String))] : []),
      transparent: raw.transparent === true,
      z: raw.z,
      layout: Object.freeze({
        x: layout.x, y: layout.y, width: layout.width, height: layout.height,
        anchor, fit, opacity, rotation, clip: layout.clip !== false, blend,
      }),
      semanticPrompt: prompt,
      avoid: Object.freeze(Array.isArray(raw.avoid) ? raw.avoid.map(String) : []),
    });
  }).sort((a,b) => a.z - b.z || a.id.localeCompare(b.id));
  const scene = Object.freeze({
    version: input.version,
    consumer: nonempty(input.consumer,"consumer"),
    use: input.use,
    canvas: Object.freeze({ aspectRatio: input.canvas.aspectRatio, safeArea: Number.isFinite(input.canvas.safeArea) ? Math.max(0,Math.min(.25,input.canvas.safeArea)) : .06 }),
    projection: Object.freeze({ kind:"isometric", axisAngleDeg:30, parallel:true }),
    palette,
    layers: Object.freeze(layers),
    assembly: Object.freeze({
      apertureMark: input.assembly?.apertureMark !== false,
      wordmark: input.assembly?.wordmark === true,
      textMode: input.assembly?.textMode === "none" ? "none" : "deterministic-overlay",
      cropStrategy: ["cover","contain","subject-aware"].includes(input.assembly?.cropStrategy) ? input.assembly.cropStrategy : "subject-aware",
      compositionMode: "normalized-scene",
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
    `Projection: canonical isometric / axonometric parallel projection; ground-plane axes at ±30 degrees; no converging vanishing point; preserve isometric construction across architecture, bodies, machines, terrain, and symbols.`,
    `Visual language: clean modernist symbolic editorial illustration; Bauhaus/Swiss/linocut ancestry without vintage print defects; crisp vector-like silhouettes and isometric solids; large intentional flat fields; depth from elevation, adjacency, occlusion, and layer relation rather than camera perspective.`,
    layer.primitiveHints.includes("aperture") ? "If an aperture appears, render a subtle five-blade mechanical aperture: central negative pentagonal opening, clockwise whirling tension, no pupil, iris, almond eye, eyelids, or literal eyeball." : "",
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

const ADMITTED_ASSET_TYPES = new Set(["image/png","image/jpeg","image/webp","image/svg+xml"]);
const DEFAULT_MAX_ASSET_BYTES = 16 * 1024 * 1024;

function admittedMediaType(value) {
  const type=String(value ?? "").split(";",1)[0].trim().toLowerCase();
  if (!ADMITTED_ASSET_TYPES.has(type)) throw new TypeError(`visual asset media type is not admitted: ${type || "missing"}`);
  return type;
}

function assertPassiveSvg(bytes) {
  const text=Buffer.from(bytes).toString("utf8");
  const forbidden=[
    /<script\b/iu,
    /<foreignObject\b/iu,
    /\son[a-z]+\s*=/iu,
    /javascript\s*:/iu,
    /(?:href|xlink:href)\s*=\s*["']\s*https?:/iu,
  ];
  if (forbidden.some((pattern)=>pattern.test(text))) throw new TypeError("generated SVG contains active or external content");
}

function materializedAsset(bytes, mediaType, source) {
  if (bytes.byteLength < 1) throw new TypeError("generated visual asset is empty");
  const type=admittedMediaType(mediaType);
  if (type === "image/svg+xml") assertPassiveSvg(bytes);
  const encoded=Buffer.from(bytes).toString("base64");
  return Object.freeze({
    type:"MaterializedVisualAsset",
    version:1,
    assetId:niBytes(bytes),
    mediaType:type,
    bytes:bytes.byteLength,
    data:encoded,
    dataUrl:`data:${type};base64,${encoded}`,
    source:Object.freeze(source),
  });
}

export async function materializeProviderAsset({ asset, fetchImpl = globalThis.fetch, maxBytes = DEFAULT_MAX_ASSET_BYTES } = {}) {
  if (!asset || typeof asset !== "object") throw new TypeError("provider asset is required");
  if (!Number.isInteger(maxBytes) || maxBytes < 1024 || maxBytes > 64 * 1024 * 1024) throw new TypeError("maxBytes is outside the admitted range");
  if (asset.kind === "inline") {
    const type=admittedMediaType(asset.mediaType);
    if (typeof asset.data !== "string" || asset.data.length === 0) throw new TypeError("inline provider asset carries no data");
    const bytes=Buffer.from(asset.data,"base64");
    if (bytes.byteLength > maxBytes) throw new TypeError("inline provider asset exceeds the byte bound");
    return materializedAsset(bytes,type,{kind:"inline"});
  }
  if (asset.kind === "url") {
    if (typeof fetchImpl !== "function") throw new TypeError("URL provider asset materialization requires fetch");
    let source;
    try { source=new URL(asset.url); } catch { throw new TypeError("provider asset URL is malformed"); }
    if (source.protocol !== "https:" || source.username || source.password) throw new TypeError("provider asset URL must be credential-free HTTPS");
    const response=await fetchImpl(source.href,{method:"GET",redirect:"follow",headers:{accept:"image/avif,image/webp,image/png,image/jpeg,image/svg+xml"}});
    if (!response.ok) throw new Error(`provider asset fetch ${response.status}`);
    const finalUrl=new URL(response.url || source.href);
    if (finalUrl.protocol !== "https:" || finalUrl.username || finalUrl.password) throw new TypeError("provider asset redirected outside credential-free HTTPS");
    const length=Number(response.headers.get("content-length"));
    if (Number.isFinite(length) && length > maxBytes) throw new TypeError("provider asset content-length exceeds the byte bound");
    const bytes=new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw new TypeError("provider asset exceeds the byte bound");
    return materializedAsset(bytes,response.headers.get("content-type"),{kind:"url",url:finalUrl.href});
  }
  throw new TypeError("provider asset kind is not admitted");
}

function polarPoint(cx, cy, radius, degrees) {
  const radians=degrees * Math.PI / 180;
  return Object.freeze({x:cx + Math.cos(radians)*radius, y:cy + Math.sin(radians)*radius});
}

function polygonCentroid(points) {
  const sum=points.reduce((acc,point)=>({x:acc.x+point.x,y:acc.y+point.y}),{x:0,y:0});
  return Object.freeze({x:sum.x/points.length,y:sum.y/points.length});
}

export function fiveBladeApertureGeometry({
  size=64,
  outerRadius=size*.46,
  innerRadius=size*.165,
  outerRotationDeg=-90,
  innerRotationDeg=outerRotationDeg+36,
}={}) {
  if (!Number.isFinite(size) || size <= 0) throw new TypeError("aperture size must be positive");
  const cx=size/2, cy=size/2;
  const outer=Object.freeze(Array.from({length:5},(_,i)=>polarPoint(cx,cy,outerRadius,outerRotationDeg+i*72)));
  const inner=Object.freeze(Array.from({length:5},(_,i)=>polarPoint(cx,cy,innerRadius,innerRotationDeg+i*72)));
  const blades=Object.freeze(Array.from({length:5},(_,i)=>{
    const points=Object.freeze([outer[i],outer[(i+1)%5],inner[(i+1)%5],inner[i]]);
    return Object.freeze({index:i,points,centroid:polygonCentroid(points)});
  }));
  const southeast=blades.filter((blade)=>blade.centroid.x>cx && blade.centroid.y>cy);
  const pool=southeast.length ? southeast : blades;
  const signalIndex=pool.reduce((best,blade)=>{
    const score=(blade.centroid.x-cx)+(blade.centroid.y-cy);
    const bestScore=(best.centroid.x-cx)+(best.centroid.y-cy);
    return score>bestScore ? blade : best;
  }).index;
  return Object.freeze({size,cx,cy,outer,inner,blades,signalIndex});
}

function pointsAttribute(points) {
  return points.map((point)=>`${point.x.toFixed(3)},${point.y.toFixed(3)}`).join(" ");
}

export function koiosApertureSvg({
  size=64,
  ink="#171a21",
  signal="#000088",
  className,
  ariaHidden=true,
}={}) {
  const geometry=fiveBladeApertureGeometry({size});
  const blades=geometry.blades.map((blade)=>`<polygon data-blade="${blade.index}" data-signal="${blade.index===geometry.signalIndex ? "true" : "false"}" points="${pointsAttribute(blade.points)}" fill="${blade.index===geometry.signalIndex ? signal : ink}"/>`).join("");
  const attrs=[
    `xmlns="http://www.w3.org/2000/svg"`,
    `viewBox="0 0 ${size} ${size}"`,
    className ? `class="${String(className).replaceAll('"',"&quot;")}"` : "",
    ariaHidden ? `aria-hidden="true"` : `role="img" aria-label="Koios five-blade aperture"`,
  ].filter(Boolean).join(" ");
  return `<svg ${attrs}>${blades}</svg>`;
}

function esc(value) {
  return String(value).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll('"',"&quot;");
}

function anchorAlignment(anchor) {
  switch (anchor) {
    case "north": return "xMidYMin";
    case "south": return "xMidYMax";
    case "east": return "xMaxYMid";
    case "west": return "xMinYMid";
    case "north-east": return "xMaxYMin";
    case "north-west": return "xMinYMin";
    case "south-east": return "xMaxYMax";
    case "south-west": return "xMinYMax";
    default: return "xMidYMid";
  }
}

function pixelFrame(layout, width, height) {
  return Object.freeze({
    x: layout.x * width,
    y: layout.y * height,
    width: layout.width * width,
    height: layout.height * height,
  });
}

export function assembleSvg({ scene: input, components = {}, width = 1600, height = 900, label } = {}) {
  const scene = input?.id ? input : admitScene(input);
  if (scene.version !== "koios.visual-scene/v3" || scene.assembly?.compositionMode !== "normalized-scene") throw new TypeError("assembly requires an admitted Koios scene v3");
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 320 || height < 180 || width > 8192 || height > 8192) throw new TypeError("assembly dimensions are invalid");
  const generated = scene.layers.filter((layer) => layer.generatorPolicy !== "deterministic-only");
  const defs = [];
  const images = generated.map((layer) => {
    const component = components[layer.id];
    if (!component || typeof component.href !== "string" || component.href.trim() === "") throw new TypeError(`assembly is missing component ${layer.id}`);
    const frame = pixelFrame(layer.layout,width,height);
    const align = anchorAlignment(layer.layout.anchor);
    const preserve = `${align} ${layer.layout.fit === "contain" ? "meet" : "slice"}`;
    const clipId = `clip-${layer.id}`;
    if (layer.layout.clip) defs.push(`<clipPath id="${esc(clipId)}"><rect x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${frame.height}"/></clipPath>`);
    const cx = frame.x + frame.width / 2;
    const cy = frame.y + frame.height / 2;
    const transform = layer.layout.rotation === 0 ? "" : ` transform="rotate(${layer.layout.rotation} ${cx} ${cy})"`;
    const clip = layer.layout.clip ? ` clip-path="url(#${esc(clipId)})"` : "";
    const style = layer.layout.blend === "normal" ? "" : ` style="mix-blend-mode:${layer.layout.blend}"`;
    return `<image data-layer="${esc(layer.id)}" data-role="${esc(layer.role)}" href="${esc(component.href)}" x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${frame.height}" preserveAspectRatio="${preserve}" opacity="${layer.layout.opacity}"${transform}${clip}${style}/>`;
  }).join("\n");
  const aperture = scene.assembly.apertureMark
    ? (() => {
        const markSize=Math.max(54,Math.min(92,Math.round(Math.min(width,height)*.085)));
        const geometry=fiveBladeApertureGeometry({size:markSize});
        const blades=geometry.blades.map((blade)=>`<polygon points="${pointsAttribute(blade.points)}" fill="${blade.index===geometry.signalIndex ? scene.palette.signal : scene.palette.ink}"/>`).join("");
        return `<g id="koios-aperture" transform="translate(${width - markSize - width*scene.canvas.safeArea} ${height*scene.canvas.safeArea})">${blades}</g>`;
      })()
    : "";
  const deterministicLabel = scene.assembly.textMode === "deterministic-overlay" && label ? `<text x="${width * scene.canvas.safeArea}" y="${height - height * scene.canvas.safeArea}" font-family="system-ui,sans-serif" font-size="${Math.max(18,Math.round(height*.035))}" font-weight="650" fill="${scene.palette.ink}">${esc(label)}</text>` : "";
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img">`,
    defs.length ? `<defs>${defs.join("")}</defs>` : "",
    `<rect width="${width}" height="${height}" fill="${scene.palette.paper}"/>`,
    images,
    `<rect x="0" y="0" width="${Math.max(8,Math.round(width*.008))}" height="${height}" fill="${scene.palette.signal}"/>`,
    aperture,
    deterministicLabel,
    "</svg>",
  ].filter(Boolean).join("\n");
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
