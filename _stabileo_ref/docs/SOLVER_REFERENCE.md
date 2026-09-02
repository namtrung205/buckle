# Solver Reference

This is a working reference for how to think about the solver surface. It is intentionally organized by task, not by internal file names.

## 1. Coordinate Contract

Stabileo uses a `Z-up` convention.

The practical consequences are:

- `Z` is vertical
- `XY` is the horizontal ground plane
- common flat 2D models are embedded in the `XZ` plane

Read:

- [ADR 0001: Z-up coordinate system](adr/0001-z-up-coordinate-system.md)

## 2. Core Model Objects

The structured model is built from:

- nodes
- elements
- supports
- materials
- sections
- loads

This same structure shows up across:

- the browser app
- snapshots/history
- AI build/edit flows
- solver input translation

## 3. Solver Outputs

The important result surfaces are:

- displacements
- reactions
- element forces
- solver diagnostics

Depending on mode and element family, that expands into:

- 2D diagrams
- 3D diagrams
- stresses
- deformed shape
- envelopes and combinations

### Reaction and displacement reporting contract

All solver outputs — per-node reactions, displacements, and equilibrium sums — are
reported in GLOBAL axes on the following analysis paths:
- linear
- constrained (prescribed displacements and multi-point constraints)
- cable
- corotational (geometric nonlinearity)
- reduction (Guyan and Craig-Bampton)
- material-nonlinear
- winkler (foundation models)
- staged construction (rejects inclined supports explicitly rather than mis-reporting)

For these paths, the solve itself uses the rotated support frame internally and
back-transforms before reporting. This also holds for the internal iteration of the
geometric/material nonlinear paths (corotational, material nonlinearity): per-iteration
state updates operate on the same consistently back-rotated frame, not the raw mixed-frame
solve vector.

Dynamics paths (modal, spectral, harmonic, time history) do not yet back-rotate
inclined-support DOFs — mode shapes and time-history displacements at such nodes
are reported in the rotated support frame.

Support-local reaction components are not yet exposed; if added, they will be an
additive field, not a change to the global-frame default.

## 4. Diagnostics and Trust

The repo treats trust as a first-class product surface, not a hidden implementation detail.

Use these docs for that layer:

- [VERIFICATION.md](VERIFICATION.md)
- [BENCHMARKS.md](BENCHMARKS.md)
- [SOLVER_ROADMAP.md](roadmap/SOLVER_ROADMAP.md)

## 5. Engine, Web, and AI Seams

If you need implementation-level detail, start with:

- [`engine/README.md`](../engine/README.md)
- [`web/src/lib/engine/`](../web/src/lib/engine)
- [`web/src/lib/ai/client.ts`](../web/src/lib/ai/client.ts)
- [`backend/src/main.rs`](../backend/src/main.rs)

## 6. Recommended Reading Order

If you are new:

1. [Quick start](QUICKSTART.md)
2. [AI modeling workflow](AI_MODELING_WORKFLOW.md)
3. [ADR 0001](adr/0001-z-up-coordinate-system.md)
4. [Verification](VERIFICATION.md)
5. [Engine README](../engine/README.md)
