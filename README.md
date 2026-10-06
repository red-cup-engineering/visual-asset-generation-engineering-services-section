# Visual Asset Generation Services Section

Red Cup Engineering's reusable visual-asset compiler.

The service does **not** define a customer's brand. It consumes a typed scene graph supplied by a science/design authority and turns it into:

1. reusable component-generation requests;
2. provider-routing candidates;
3. deterministic assembled SVG surfaces;
4. ni-addressed manifests suitable for operations/provenance.

## Why components, not posters

Image generators are treated as rendering peripherals.

Generated assets should normally be:

- one semantic object or field;
- transparent when possible;
- free of publication text and logos;
- reusable across multiple layouts;
- independently replaceable when a provider changes.

The assembler owns wordmarks, labels, crops, safe areas, z-order, final brand marks, and output dimensions.

## Current provider request compilers

### Google Nano Banana

Builds credential-blind requests for the Gemini Interactions API at:

`POST https://generativelanguage.googleapis.com/v1beta/interactions`

Default model: `gemini-3.1-flash-image`.

Authentication is intentionally absent from the request descriptor. The consuming capability adds `x-goog-api-key`.

### Ideogram

Builds credential-blind JSON requests for:

`POST https://api.ideogram.ai/v2/image/generate/ideogram-4-5`

Authentication is intentionally absent. The consuming capability adds `Api-Key`.

## Deterministic assembly

`assembleSvg()` composes admitted component references into an SVG. It never asks a generator to render:

- Koios marks;
- headlines;
- metadata;
- section labels;
- crop/safe-area rules.

Those remain deterministic.

## Customer boundary

Koios.News is the first consumer. This section is reusable by other 561 Group publications and services.
