import test from "node:test";
import assert from "node:assert/strict";
import {
  admitScene,
  assetManifest,
  assembleSvg,
  buildGeminiRequest,
  buildIdeogramRequest,
  buildOpenAIImageRequest,
  buildRecraftRequest,
  compileComponentPrompt,
  executeProviderRequest,
  fiveBladeApertureGeometry,
  koiosApertureSvg,
  materializeProviderAsset,
  niBytes,
  niDigest,
  providerCandidates,
} from "../src/index.mjs";

const sceneInput = {
  version: "koios.visual-scene/v3",
  consumer: "koios.news",
  use: "article-hero",
  canvas: { aspectRatio: "16:9", safeArea: .06 },
  projection: { kind: "isometric", axisAngleDeg: 30, parallel: true },
  palette: { paper: "#fbfaf7", ink: "#171a21", signal: "#000088", "signal-secondary": "#5366c4", fog: "#b9c1da" },
  layers: [
    { id: "world", role: "world", generatorPolicy: "reuse-first", primitiveHints: ["circle","horizon"], paletteRoles: ["paper","ink","signal"], transparent: false, z: 1, layout: { x: 0, y: 0, width: .68, height: 1, anchor: "west", fit: "cover", opacity: 1, rotation: 0, clip: true, blend: "normal" }, semanticPrompt: "a bounded world under institutional pressure" },
    { id: "agent", role: "actor", generatorPolicy: "generate", primitiveHints: ["silhouette","aperture"], paletteRoles: ["ink","signal"], transparent: true, z: 2, layout: { x: .58, y: .16, width: .34, height: .72, anchor: "south-east", fit: "contain", opacity: 1, rotation: 0, clip: false, blend: "normal" }, semanticPrompt: "one nonhuman economic actor treated as ordinary" },
  ],
  assembly: { apertureMark: true, wordmark: false, textMode: "deterministic-overlay", cropStrategy: "subject-aware", compositionMode: "normalized-scene" },
};

test("scene admission is deterministic and canonical", () => {
  const scene = admitScene(sceneInput);
  assert.match(scene.id,/^ni:\/\/\/sha-256;/u);
  assert.equal(scene.id,admitScene(sceneInput).id);
  assert.equal(scene.layers[0].id,"world");
});

test("component prompt bans faux print defects and text", () => {
  const scene = admitScene(sceneInput);
  const prompt = compileComponentPrompt(scene,"agent");
  assert.match(prompt.prompt,/No text/u);
  assert.match(prompt.prompt,/faux paper grain/u);
  assert.match(prompt.prompt,/transparent/u);
});

test("provider request compilers are credential-blind", () => {
  const prompt = compileComponentPrompt(admitScene(sceneInput),"agent");
  const gemini = buildGeminiRequest({ prompt: prompt.prompt, aspectRatio:"16:9" });
  assert.equal(gemini.url,"https://generativelanguage.googleapis.com/v1beta/interactions");
  assert.equal("x-goog-api-key" in gemini.headers,false);
  const ideogram = buildIdeogramRequest({ prompt: prompt.prompt, aspectRatio:"16:9", seed:42 });
  assert.equal(ideogram.url,"https://api.ideogram.ai/v2/image/generate/ideogram-4-5");
  assert.equal("Api-Key" in ideogram.headers,false);
  assert.equal(ideogram.body.seed,42);
});

test("transparent components prefer Ideogram but remain provider-diverse", () => {
  const scene = admitScene(sceneInput);
  assert.deepEqual(providerCandidates(scene.layers.find(x=>x.id==="agent")),["ideogram-4-5","gpt-image-2","gemini-3-pro-image","gemini-3.1-flash-image","recraftv4_1_vector"]);
});

test("deterministic assembler keeps generator output below publication chrome", () => {
  const scene = admitScene(sceneInput);
  const assembly = assembleSvg({
    scene,
    width:1600,
    height:900,
    label:"Watching the future take shape",
    components:{
      world:{href:"data:image/png;base64,AAAA",provider:"gemini-3.1-flash-image"},
      agent:{href:"data:image/png;base64,BBBB",provider:"ideogram-4-5"},
    },
  });
  assert.match(assembly.svg,/id="koios-aperture"/u);
  assert.match(assembly.svg,/Watching the future take shape/u);
  assert.match(assembly.svg,/data-layer="agent"/u);
  assert.match(assembly.svg,/x="928"/u);
  assert.match(assembly.svg,/width="544"/u);
  assert.match(assembly.svg,/xMaxYMax meet/u);
  const manifest = assetManifest({
    scene,
    components:{world:{assetId:niDigest("world"),provider:"gemini-3.1-flash-image"},agent:{assetId:niDigest("agent"),provider:"ideogram-4-5"}},
    assembly,
  });
  assert.match(manifest.id,/^ni:\/\/\/sha-256;/u);
  assert.equal(manifest.components.length,2);
});


test("provider execution is credential-blind and normalizes Ideogram assets", async () => {
  const descriptor=buildIdeogramRequest({prompt:"clean symbolic component",aspectRatio:"16:9",seed:7});
  let seen;
  const result=await executeProviderRequest({
    descriptor,
    authorizedFetch:async (url,init)=>{
      seen={url,init};
      return new Response(JSON.stringify({data:[{url:"https://example.invalid/asset.png",seed:7,resolution:"1920x1088",is_image_safe:true}]}),{status:200,headers:{"content-type":"application/json"}});
    },
  });
  assert.equal(seen.url,"https://api.ideogram.ai/v2/image/generate/ideogram-4-5");
  assert.equal("Api-Key" in seen.init.headers,false);
  assert.equal(result.status,"completed");
  assert.equal(result.assets[0].kind,"url");
});

test("provider execution normalizes Gemini inline image data", async () => {
  const descriptor=buildGeminiRequest({prompt:"clean symbolic component",aspectRatio:"1:1"});
  const result=await executeProviderRequest({
    descriptor,
    authorizedFetch:async () => new Response(JSON.stringify({id:"interaction-1",output_image:{mime_type:"image/png",data:"AAECAw=="}}),{status:200}),
  });
  assert.equal(result.provider,"google-gemini");
  assert.equal(result.assets[0].mediaType,"image/png");
  assert.equal(result.assets[0].data,"AAECAw==");
});


test("Recraft vector request carries Koios palette controls without credentials", () => {
  const descriptor=buildRecraftRequest({
    prompt:"clean institutional threshold component, no text",
    size:"16:9",
    seed:11,
  });
  assert.equal(descriptor.provider,"recraft");
  assert.equal(descriptor.url,"https://external.api.recraft.ai/v1/images/generations");
  assert.equal(descriptor.body.model,"recraftv4_1_vector");
  assert.equal(descriptor.body.response_format,"url");
  assert.deepEqual(descriptor.body.controls.colors[2],{rgb:[0,0,136]});
  assert.equal("authorization" in descriptor.headers,false);
});

test("Recraft execution normalizes native asset URLs", async () => {
  const descriptor=buildRecraftRequest({prompt:"clean vector system symbol"});
  const result=await executeProviderRequest({
    descriptor,
    authorizedFetch:async () => new Response(JSON.stringify({
      created:1780000000,
      credits:80,
      data:[{image_id:"img_koios_1",url:"https://cdn.example.invalid/koios.svg"}],
    }),{status:200,headers:{"content-type":"application/json"}}),
  });
  assert.equal(result.provider,"recraft");
  assert.equal(result.credits,80);
  assert.equal(result.assets[0].imageId,"img_koios_1");
  assert.match(result.assets[0].url,/\.svg$/u);
});

test("OpenAI GPT Image request and response stay credential-blind", async () => {
  const descriptor=buildOpenAIImageRequest({
    prompt:"one clean assemblable symbolic actor, no text",
    model:"gpt-image-2",
    size:"1536x1024",
    background:"transparent",
  });
  assert.equal(descriptor.provider,"openai-image");
  assert.equal(descriptor.url,"https://api.openai.com/v1/images/generations");
  assert.equal("authorization" in descriptor.headers,false);
  const result=await executeProviderRequest({
    descriptor,
    authorizedFetch:async () => new Response(JSON.stringify({
      created:1780000000,
      background:"transparent",
      output_format:"png",
      quality:"high",
      size:"1536x1024",
      data:[{b64_json:"AAECAwQ="}],
      usage:{total_tokens:42},
    }),{status:200,headers:{"content-type":"application/json"}}),
  });
  assert.equal(result.provider,"openai-image");
  assert.equal(result.assets[0].mediaType,"image/png");
  assert.equal(result.assets[0].data,"AAECAwQ=");
});

test("geometry-heavy Koios layers prefer native vector generation", () => {
  const scene=admitScene(sceneInput);
  const institution={...scene.layers[0],role:"institution"};
  assert.equal(providerCandidates(institution)[0],"recraftv4_1_vector");
});


test("scene v3 rejects missing spatial contracts", () => {
  const malformed=structuredClone(sceneInput);
  delete malformed.layers[0].layout;
  assert.throws(()=>admitScene(malformed),/layout is required/u);
});

test("normalized layout cannot escape the canvas", () => {
  const malformed=structuredClone(sceneInput);
  malformed.layers[0].layout={...malformed.layers[0].layout,x:.8,width:.4};
  assert.throws(()=>admitScene(malformed),/escapes the normalized canvas/u);
});


test("inline provider output becomes content-addressed asset bytes", async () => {
  const materialized=await materializeProviderAsset({
    asset:{kind:"inline",mediaType:"image/png",data:Buffer.from([1,2,3,4,5]).toString("base64")},
  });
  assert.equal(materialized.assetId,niBytes(new Uint8Array([1,2,3,4,5])));
  assert.equal(materialized.mediaType,"image/png");
  assert.match(materialized.dataUrl,/^data:image\/png;base64,/u);
});

test("URL provider output is detached from the provider URL", async () => {
  const svg='<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h10v10H0z"/></svg>';
  const materialized=await materializeProviderAsset({
    asset:{kind:"url",url:"https://provider.example.invalid/output.svg"},
    fetchImpl:async () => {
      const response=new Response(svg,{status:200,headers:{"content-type":"image/svg+xml","content-length":String(Buffer.byteLength(svg))}});
      Object.defineProperty(response,"url",{value:"https://cdn.example.invalid/final.svg"});
      return response;
    },
  });
  assert.equal(materialized.mediaType,"image/svg+xml");
  assert.equal(materialized.source.url,"https://cdn.example.invalid/final.svg");
  assert.match(materialized.assetId,/^ni:\/\/\/sha-256;/u);
});

test("active or externally dependent SVG is refused at ingestion", async () => {
  const hostile='<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><image href="https://evil.invalid/x.png"/></svg>';
  await assert.rejects(
    ()=>materializeProviderAsset({asset:{kind:"inline",mediaType:"image/svg+xml",data:Buffer.from(hostile).toString("base64")}}),
    /active or external content/u,
  );
});


test("scene v3 requires canonical isometric projection", () => {
  const malformed=structuredClone(sceneInput);
  malformed.projection={kind:"perspective",axisAngleDeg:30,parallel:false};
  assert.throws(()=>admitScene(malformed),/requires canonical isometric parallel projection/u);
});

test("five-blade aperture chooses one complete southeast signal blade", () => {
  const geometry=fiveBladeApertureGeometry({size:100});
  assert.equal(geometry.blades.length,5);
  const signal=geometry.blades[geometry.signalIndex];
  assert.ok(signal.centroid.x>geometry.cx);
  assert.ok(signal.centroid.y>geometry.cy);
  const svg=koiosApertureSvg({size:100});
  assert.equal((svg.match(/data-signal="true"/gu) ?? []).length,1);
  assert.equal((svg.match(/fill="#000088"/gu) ?? []).length,1);
  assert.equal((svg.match(/fill="#171a21"/gu) ?? []).length,4);
  assert.equal(/circle|ellipse|koios-eye/iu.test(svg),false);
});

test("component prompts require isometric projection and keep aperture nonliteral", () => {
  const scene=admitScene(sceneInput);
  const prompt=compileComponentPrompt(scene,"agent");
  assert.match(prompt.prompt,/isometric \/ axonometric parallel projection/u);
  assert.match(prompt.prompt,/five-blade mechanical aperture/u);
  assert.match(prompt.prompt,/no pupil, iris, almond eye/u);
});
