# Canonical Section Migration Guide

This document describes how saved models migrate to the canonical section
engine introduced in PR #124.

## What changed

Sections now carry an optional `canonical` field: a solver-ready cache of the
section's geometry-backed state (outline, properties, digest). This is derived
from the section's own dimensions, never trusted as stored.

## Migration path for saved models

### Automatic (on load)

When a model is loaded, `restoreCanonicalSections()` re-derives the canonical
state from each section's dimensions:

- **Catalogue profiles** (IPE, HEA, HEB, etc.): resolve to geometry-backed if
  all required dimensions are present, properties-only otherwise.
- **Parametric sections** (rect, circle, etc.): resolve to geometry-backed if
  dimensions are complete.
- **Custom polygons**: resolve to geometry-backed if the polygon is valid.
- **Properties-only sections** (A/I/J only, no geometry): stay properties-only.

No user action is required. The migration is lossless: the declared A/I/J are
always preserved, and the solver path is unchanged.

### Manual refresh

If a model was loaded before the WASM engine was ready (cold start), sections
may report properties-only even when they should be geometry-backed. Call
`modelStore.refreshCanonicalSections()` to re-resolve.

## Rollback

The canonical section engine is behind the `canonical-sections` feature flag
(default: on). To disable it in the field:

```js
localStorage.setItem('stabileo-feature-canonical-sections', '0');
```

With the flag off, sections resolve to properties-only regardless of WASM
availability, and the solver path is identical to the pre-PR behaviour.

## What does NOT change

- The solver input (`buildSolverInput2D/3D`) reads the same A/I/J either way.
- Saved files do not store the canonical cache — it is re-derived on load.
- The undo stack does not carry canonical state.

## Compatibility

- **WASM builds without `build_section_geometry`**: the engine resolves to
  properties-only and the solver path is unaffected. Tests that exercise the
  canonical geometry skip themselves in this case (and fail CI).
- **Old saved files**: load normally; canonical state is derived on load.
