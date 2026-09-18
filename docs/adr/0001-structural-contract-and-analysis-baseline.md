# ADR 0001: Structural transport contract and analysis baseline

- Status: Accepted
- Date: 2026-09-08
- Contract version: 1.0

## Decision

`backend/schemas/structural_analysis.py` is the authoritative transport model.
`backend/scripts/export_schema.py` generates the committed `input_schema.json`; a
contract test rejects drift. API, examples, MCP scene reads, and analysis all validate
against that model.

The transport frame is right-handed engineering **Z-up**. Three.js remains Y-up and
converts only at import/export and WebSocket mutation boundaries. DOF labels (`dx` …
`rz`) are semantic and are never axis-swapped.

Units at the transport boundary are:

| Quantity | Unit |
| --- | --- |
| Node coordinates, shell thickness | m |
| Section dimensions | mm |
| Elastic modulus and strength | Pa |
| Nodal load | kN |
| Line load | kN/m |
| Pressure | kN/m² |
| UI/transport angles | degree |

OpenSees uses metre-newton-second internally. Section dimensions are converted from
mm to m in `compute_section_properties`; load adapters convert kN-based values to N.
Radians may be used only inside computation code.

Validation failures use HTTP 422 with stable fields `path`, `code`, `expected`, and
`received`. Version 1 requires `schemaVersion: "1.0"`. A future breaking contract
must add an explicit `vN -> vN+1` migration before changing the default writer; silent
reinterpretation of axes or units is prohibited.

## Accuracy and rounding

The Euler–Bernoulli simply-supported beam is the certified v1 golden case. Acceptance
tolerances are 2% for displacement, 2% for support reaction, and 6% for interpolated
mid-span moment. Force/displacement calculations retain full floating-point precision;
serialized displacements use nine decimal places. Presentation rounding belongs to the
UI and must not feed back into analysis.

Other 3D frame, release, inclined-member, shell-pressure, and mixed beam-shell cases
are regression coverage until independently verified reference solutions are recorded.
They must not be advertised as code-design certification. Nonlinear, buckling, seismic,
fire, staged-construction, and design-code checks are outside the certified v1 scope.

## Consequences

- Denormalized member endpoint coordinates remain in v1 for compatibility, but must
  match canonical nodes within `1e-9 m`.
- MCP member creation uses normalized node IDs; scene export uses the versioned model.
- Contract, benchmark, and test reports are retained by CI for each commit.
