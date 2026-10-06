import test from "node:test";
import assert from "node:assert/strict";
import {
  admitScene,
  assetManifest,
  assembleSvg,
  buildGeminiRequest,
  buildIdeogramRequest,
  compileComponentPrompt,
  niDigest,
  providerCandidates,
} from "../src/index.mjs";

const sceneInput = {
  version: "koios.visual-scene/v1",
  consumer: "koios.news",
  use: "article-hero",
  canvas: { aspectRatio: "16:9", safeArea: .06 },
  palette: { paper: "#fbfaf7", ink: "#171a21", signal: "#000088", "signal-secondary": "#5366c4", fog: "#b9c1da" },
  layers: [
    { id: "world", role: "world", generatorPolicy: "reuse-first", primitiveHints: ["circle","horizon"], paletteRoles: ["paper","ink","signal"], transparent: false, z: 1, semanticPrompt: "a bounded world under institutional pressure" },
    { id: "agent", role: "actor", generatorPolicy: "generate", primitiveHints: ["silhouette","eye"], paletteRoles: ["ink","signal"], transparent: true, z: 2, semanticPrompt: "one nonhuman economic actor treated as ordinary" },
  ],
  assembly: { eyeMark: true, wordmark: false, textMode: "deterministic-overlay", cropStrategy: "subject-aware" },
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
  assert.deepEqual(providerCandidates(scene.layers.find(x=>x.id==="agent")),["ideogram-4-5","gemini-3-pro-image","gemini-3.1-flash-image"]);
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
  assert.match(assembly.svg,/id="koios-eye"/u);
  assert.match(assembly.svg,/Watching the future take shape/u);
  assert.match(assembly.svg,/data-layer="agent"/u);
  const manifest = assetManifest({
    scene,
    components:{world:{assetId:niDigest("world"),provider:"gemini-3.1-flash-image"},agent:{assetId:niDigest("agent"),provider:"ideogram-4-5"}},
    assembly,
  });
  assert.match(manifest.id,/^ni:\/\/\/sha-256;/u);
  assert.equal(manifest.components.length,2);
});
