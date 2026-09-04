# PR19 — readiness for review

**Branch:** `pr/19-rc-cad-constructibility` · **PR:** #90, **ready for review** · **not merged**,
and nothing in this document changes that. The manual QA below has been done and passed; merging
remains a separate decision after review.

**Head:** `1c5ef3b9`, signed, pushed fast-forward to `origin/pr/19-rc-cad-constructibility`.

## 0. Manual QA — done, and what it found

Bauti ran the 3-D workspace on the 7-storey building against the checklist in §7 and reports:

- the beams **show reinforcement**;
- they no longer appear as **cages of stirrups with no longitudinal bars** — which was the whole
  of the original report;
- elements **197, 199, 201, 203, 198, 163, 140, 143, 146 and 89** all have visible steel;
- the **3-D visualisation works**;
- the current solution is **acceptable as a provisional proposal**.

That last clause is the one to carry forward: it is an acceptance OF A PROPOSAL, not a finding
that the design is complete. Every limitation in §3 and §4 stands unchanged, and §12 states the
five of them that a reader must not be able to miss.

The distinction the automated suite cannot make — whether a person reading a real sheet can tell
an assembly bar from a hogging bar — is the one the manual pass was for. It passed.

**Scope:** RC detailing made constructible and honest — the design outcome, the document it
produces, and the four projections of that document.

---

## 1. Features finished

| Area | What is done |
|---|---|
| Autosave | IndexedDB with revisions, structural fingerprint, unfinished-write marker, retention window, localStorage fallback reported as degraded rather than used silently. Written after every expensive operation, not only on the 30 s timer. |
| Restore | Banner, restore, re-solve, restore twice. The stored project contains the design. |
| Global design | Design-all across families; per-member outcomes; run summary. |
| Floor families | Slabs, walls, footings designed and detailed as families. |
| Provisional proposals | `PROVISIONAL_BIAXIAL`: the primary axis designed and verified by the ordinary search, the secondary axis declared unevaluated. Never certified, never counted as verified, never hidden. |
| 3-D viewer | Full-window workspace; columns, beams, slabs, walls, footings and pedestals; geometry batched per family × colour; selection of bars, solids and conflict markers; section plane; isolation; status filter; per-family tally. |
| Toggles | Six family switches plus reinforcement, concrete, conflict markers and hide-unreinforced. A switch is a visibility flag, never a rebuild. |
| Conflicts | 40 065 detected on the 7-storey building, classified, marked in 3-D, clickable, and carried into report, DXF and schedule. |
| Drawings | General plans, per-level plans, sections and column details. |
| Reconciliation | One document, four projections, cross-examined against each other rather than against a fixture. |
| Torsion warning | Beams carrying torsion no check evaluates are named on every surface that shows their steel. |
| Honest states | Seven element states with one shared not-for-construction list. |
| Top assembly steel | A beam whose envelope never hogs gets the two top bars §25.7.1.2 requires in the stirrup's bends, marked `stirrupHanger` on every surface and never presented as capacity. 63 of 119 beams on the 7-storey building had no main steel at all before it; none has now. See `pr19-beam-top-steel.md`. |

## 2. Gates

Run at `HEAD` of this branch:

| Gate | Result |
|---|---|
| `npm run typecheck` | 490/490, no new errors |
| `npm run test:unit` | 279 files, 5496 tests, 0 failures |
| `npm run test:build` | 2 files, 8 tests |
| `npm run build` | clean |
| `E2E_PORT=4293 npx playwright test` | **199 passed, 4 skipped, 0 failed**, 27,8 min, exit 0 |

Run at `1c5ef3b9` on a clean tree, with the machine otherwise idle and one suite at a time. The
preview was verified to belong to THIS worktree before the result was trusted — `vite preview` on
4293 with `cwd = stabileo-pr19-cad/web`, built fresh because the port was free and
`reuseExistingServer` had nothing to adopt.

**No flaky failure appeared in this run**, which is worth stating precisely rather than
celebrating: §9's load-dependent starvation is unfixed and unexplained, and one green run does
not retire it. Expect it back on a loaded machine. Nothing was loosened to obtain this result —
no timeout raised, no spec disabled, no budget widened.

The journeys named in the review brief, and where each ran (all inside the run above):

| Journey | Specs | Tests |
|---|---|---|
| Restoration | `project-restore`, `pro-project-files` | 6 |
| Global family design | `design-families`, `rc-design`, `rc-design-visual` | 26 |
| Floor design | `floor-design`, `foundations`, `floor-families-document` | 32 |
| Viewer | `rebar-3d`, `rebar-toggles`, `rebar-viewport-cost`, `rebar-workspace-open` | 53 |
| Drawings and reconciliation | `documents`, `rc-cad-handoff`, `rc-cad-production-download`, `detailing` | 44 |

Reconciliation is also asserted below the E2E layer, over one document rather than one screen:
`projections-agree`, `provisional-projections`, `top-steel-projections`, `documents-semantic`,
`document-render`, `drawings` and `fixture-journey`, all inside the unit pass.

Re-run at the top-steel commit. One caveat learned the hard way and worth writing down: two
overlapping runs of this suite share the `E2E_PORT` preview server, and when the first finishes it
tears the server down under the second — 83 tests in, every remaining test fails with
`ERR_CONNECTION_REFUSED`. It reads exactly like a regression and is not one. One run at a time.

`E2E_PORT=4293` is not optional locally: port 4173 is reused by another worktree's `vite preview`
and Playwright will silently adopt it, testing the wrong bundle. It has cost two debugging
sessions.

## 3. Limitations, stated

These are things the app does NOT do. Each is visible to the user rather than silent.

- **Torsion is not verified.** The CIRSOC 201 adapter declares `beams.torsion: false`. Beams
  with torsion above 0,1 kN·m are named in the viewer, the sheets, the report and the schedule
  with "TORSIÓN NO EVALUADA — función en desarrollo … se corregirá en PR21".
- **A beam's secondary bending axis is not verified.** Above a 10 % ratio the member becomes a
  proposal rather than a certified design.
- **Beams have no side-face bars** in the schema, the generator, the geometry, the drawings or
  the schedule, which is why a weak-axis check that failed would have no knob to turn. See
  `docs/audits/biaxial-beam-design.md`.
- **The DIAMETER of a beam's top assembly bars is not a regulation number.** §25.7.1.2 fixes the
  count and no clause fixes the size, so the app chooses the smallest bar that fits two per row
  and is not thinner than the stirrup, and says so on every surface that shows it. §9.6.1.2 is
  deliberately NOT quoted there: §9.6.1.1 scopes it to sections where the analysis requires
  tension steel, and that face is not one.
- **A support that hogs with no designed top steel produces no bars at all.** The design's top
  knobs only exist when the seed is non-zero, so this remains open on the design side; the
  detailing reports it with the moment in the message rather than filling the face with assembly
  bars. See §5 of `pr19-beam-top-steel.md`.
- **Top assembly bars are one bar per member and are never lapped.** §9.7.7.5(b) and §9.7.7.6
  (splice near midspan, class B or mechanical) are not applied to them, and a run over 12 m is
  reported by the schedule as needing a splice rather than given one.
- **Columns' torsion is out of scope** of the warning: their transverse steel is detailed for
  confinement and their verification is a different unfinished story.
- **The 7-storey example has no footings.** The switch says "sin elementos en este modelo"
  rather than looking like a working switch that hides nothing.
- **Two nested scrollers are not allowed in the rail**; the member list does not scroll on its
  own, the rail does.

## 4. Provisional states — what a reader sees

| Surface | What it says |
|---|---|
| Design summary bar | `◐ N provisional`, beside `✗ fail` and never inside it |
| Design table row | violet `◐` badge with text, and its own row filter |
| Detailing sidebar / status panel | `PROVISIONAL` state row, violet dot |
| 3-D workspace | violet bars, a permanent banner while the model holds one |
| 3-D inspector | the member's state, plus the design's own sentence |
| Drawing sheets | first note: "PROPUESTA PROVISIONAL — NO APTO PARA EMISIÓN CONSTRUCTIVA" |
| Schedule | sheet-level line plus a per-row status beside the mark |
| Report | banner above the fold and a section naming every member |

Top assembly reinforcement rides ALONGSIDE this rather than inside it — a member carrying the
§25.7.1.2 pair is still whatever the design made it, and 62 of the 63 are proposals. Its own
banner, its own report section, its own sheet note, its own `Función` column on the schedule and
its own chip in the status panel.

The exception that produces this state is one predicate, `isKnownBiaxialLimitation`, with two
callers. It applies only when EVERY failing check is the biaxial one: a proposal that also fails
on flexure or shear stays FAILED.

## 5. Warnings carried

- provisional proposal (secondary axis unverified)
- torsion not evaluated
- top reinforcement that answers to a stirrup bend rather than to a moment
- unresolved conflicts, with counts by severity and a bounded worst-N list
- unreinforced members (concrete the app could not design), drawn in their own colour
- readiness / draft watermark on every export
- stale baseline, stale context
- autosave degraded to localStorage
- families present in the switch list but absent from the model

## 6. Decisions pending — for Bauti

1. **Fundaciones vs Dados.** Two separate switches, one per family, like everything else. The
   PR19 brief asked for "apagar Fundaciones oculta … dados". Merging them would make the Dados
   switch a dead control. Unchanged pending a decision.
2. **`design.counts.provisional` wording** — currently "provisorio"/"provisional". The 3-D
   surfaces say "Propuesta provisional".
3. **Whether the 7-storey example should ship with footings**, so the foundations switch has
   something to govern in the flagship demo.

## 7. Manual QA

Nothing here is covered by an assertion that a human would not repeat. The checked items were
run by Bauti and passed (§0); the unchecked ones remain owed and are **not** blockers for review
— they are polish and ergonomics, not correctness claims.

- [x] **Done, passed (§0)** — the workspace and its controls answer on a real GPU. The counts
      are asserted; how it FEELS at ~4 s per family switch is what the hand pass covered.
- [ ] Click a conflict marker, confirm the inspector names both bars and both members, and that
      "go back" walks the selection history.
- [ ] Cut a section on each axis and flip it.
- [ ] Read one drawing sheet, one schedule and the report end to end, looking for a sentence
      that reads wrong rather than one that is missing.
- [ ] Confirm the provisional violet and the unreinforced orange are distinguishable on your
      monitor.
- [ ] Reload mid-work and restore; confirm the banner text and that the layers come back at
      their defaults (documented policy, not a bug).
- [ ] Resize the window down to a laptop screen with both banners up.
- [x] **Done, passed (§0).** Beams **197, 199, 201, 203, 198, 163, 140, 143, 146, 89** on the 7-storey building. For
      each: bottom bars present, the two top assembly bars present, the beam's OWN stirrups
      present (not only the columns' joint ties, which claim the beam ids too), each bar's role
      readable, the provisional warning still there, and the same steel visible in 3-D, on the
      sheets and on the schedule. `beam-emptiness-diagnostic.test.ts` asserts the counts; whether
      a reader can TELL an assembly bar from a hogging bar on a real sheet is not asserted and is
      the point of the check. See `pr19-beam-top-steel.md`.

## 8. Merge risk

Nine files are shared with PR125; eight are line-for-line colour substitutions and
`App.svelte` is a genuine structural clash. Seven RC components PR125 has never seen carry six
load-bearing colours that need tokens with their meanings intact. Full arithmetic and the
recommended order in `pr20-ui-and-workflow-plan.md`.

## 9. Known non-blocking issues

**A 7-storey setup solve can starve under accumulated load.** Five occurrences across four full
suite runs, never the same test twice, always `page.evaluate(solve)` on `pro-edificio-7p`,
always passing in isolation seconds later — the same test takes 37 s alone.

The suspected cause was the parallel solve falling back to solving every load case on the main
thread when the worker pool cannot be brought up. **That is now disproven.** The fixture records
the fallback warning and the setup solve has a deadline of its own, and the occurrence it caught
reported: solve unfinished, *parallel solve fell back to sequential: **no***. The worker pool was
up. The solve was simply that slow on a machine that had spent the previous ten minutes on the
cost spec.

So it is environmental saturation, not a product fault and not a fallback — and the evidence for
that statement now exists rather than being inferred.

**A second worktree was a contributing factor, not the cause.** One run coincided with
`stabileo-landing/web` running its own Playwright suite — its `vite preview` started at 16:16:43,
this branch's run at 16:20:10, two browser suites each `workers: 1` and each rendering through
SwiftShader. That looked like the answer and it is not: a later run on a demonstrably quiet
machine failed the same way. Recorded because a concurrent suite certainly makes it worse and is
worth avoiding, but it does not explain the failure on its own.

(Not the port hazard recorded elsewhere either: landing was on 4197, 4173 and 4293 were free, so
no run adopted the wrong bundle. Any interference was CPU, not the artifact under test.)

**What IS established, measured rather than inferred:**

- the parallel solve does **not** fall back — reported twice by the deadline's own diagnostic,
  on two different tests, on two different runs;
- it is **not** a specific test: five occurrences, five different tests, never twice the same;
- it is **not** the spec: `rebar-viewport-cost.spec.ts` passes 10/10 standalone in 12,3 min, and
  contributes a failure inside the 29-minute full suite;
- it is **not** the model in isolation: the same test passes alone in 37 s against a 240 s budget;
- the solve exceeded **480 s** on a quiet machine, against 20–40 s healthy — a 12–20× slowdown
  with the worker pool up.

The pattern that survives all of that is cumulative: it appears late in long runs, on the
heaviest model, whichever test happens to be there. Thermal throttling on a laptop after half an
hour of software rasterisation, or memory pressure accumulated across ~200 browser contexts,
both fit; neither has been separated from the other, and doing so needs instrumentation this
branch has no reason to add.

What can be said with confidence is what it is NOT: not a product regression, not the solver, not
PR19. Nothing in this branch touches the solve path, and every occurrence is green on re-run. The deadline is calibrated at 480 s: below
the 900 s these specs allow themselves, so a genuine hang fails in half the time and says why,
and above the measured worst case so it does not fire on load alone.

One nuance the last run exposed: the 480 s deadline only ever fires for specs that grant
themselves 900 s. `rebar-3d.spec.ts`'s heavy tests set `test.setTimeout(240_000)`, so on a
saturated machine THEIR budget runs out first and the failure reads "Test timeout of 240000ms
exceeded" with no diagnostic attached. Raising that test's timeout would be loosening a gate to
hide the problem, so it was not done.

**Nothing was loosened to reach a green run.** The measurement budgets are untouched, no spec is
disabled and no click is forced. A full local run currently ends 198 passed / 1 failed, and the
one is load-dependent: a different test each time, never the same twice, always green when run
on its own. The remaining fix is structural: the suite performs about
thirteen full 7-storey chains (load → solve → design → detail → floor-design), five of them in
`rebar-viewport-cost.spec.ts` alone. Cutting that means reusing prepared state across tests,
which risks both coverage and inter-test independence, so it is a pass of its own rather than
something to improvise. Until then, expect roughly one load-dependent failure per full local
run, always reproducible-green in isolation.

Structural fix, deliberately not attempted here: the suite runs ~13 full 7-storey chains. Cutting
that is a spec refactor with a real risk of reducing coverage, and belongs to its own pass.

## 10. Not-for-construction behaviour

The app never presents unverified work as finished. Concretely: a proposal cannot hold a
certificate or be counted as verified; a member the design refused is drawn in its own colour
rather than omitted; a conflicted floor still exports, because the conflicts are the thing the
reviewer needs to see; every export carries its readiness; and `NOT_FOR_CONSTRUCTION_STATUSES`
is one list read by the viewport legend, the sheets, the schedule and the report, so the claim
cannot be true on one projection and forgotten on another.

## 11. Explicitly out of scope

**PR20** — PR125 integration, navigation, layout, accessibility, design workflow, viewer polish,
results, panels, visual consistency.

**PR21** — real biaxial design, conflict audit and resolution, torsion, crossties, remaining
engineering.

**Never touched in PR19** — Rust, Cargo, WASM, the solver, global analysis, load generation, the
biaxial threshold, the crosstie rule, torsion authority, the collision set, marker tessellation,
incremental GPU upload, V1, the golden fixtures, Landing and Basic/Education.

## 12. The five things this document may never stop saying

Everything above is detail. These five are the claims a reader must not be able to leave without,
and they are restated here in one block because a reviewer who reads nothing else will read this.
The manual QA in §0 passed; **none of it changes any of the following.**

**1. PR19 does not implement full biaxial design.** The verifier evaluates one flexural axis for
a beam. Beams have no side-face bars in the schema, the generator, the geometry, the drawings or
the schedule, so a weak-axis check that failed would have no knob to turn. Real biaxial design is
PR21. `docs/audits/biaxial-beam-design.md`.

**2. The biaxial proposals are PROVISIONAL, and provisional is not a weak pass.** Above a 10 %
secondary/primary moment ratio a member becomes `PROVISIONAL_BIAXIAL`: the primary axis was
designed and verified by the ordinary search with no threshold relaxed and no capacity assumed
for the axis nobody checked. It carries **no certificate**, is **never counted as verified**,
cannot satisfy the constructibility gate, and is named on every surface that draws its steel.
117 of the 119 beams on the 7-storey building are in this state.

**3. Torsion is NOT evaluated, and is not an authority in this branch.** The CIRSOC 201 adapter
declares `beams.torsion: false`. Beams carrying torsion above 0,1 kN·m are named in the viewer,
the sheets, the schedule and the report with "TORSIÓN NO EVALUADA — función en desarrollo". The
reinforcement shown resolves flexure and shear and does **not** account for torsion; verify it
outside this application before issuing. Nothing in this pass moved that authority — in
particular the top assembly bars added at `1c5ef3b9` are **not** §9.7.5 longitudinal torsion
steel and are not sized as such.

**4. The conflicts are not hidden.** 40 065 physical conflicts are detected on the 7-storey
building, classified by severity, marked in 3-D, selectable, and carried into the report, the DXF
and the schedule. A conflicted floor still exports, deliberately: the conflicts are the thing the
reviewer needs to see. None was suppressed, none was reclassified to reach a green run, and the
sheet note states the count and the worst of them by name rather than a bounded list pretending
to be the whole.

**5. Nothing here is final construction documentation.** `NOT_FOR_CONSTRUCTION_STATUSES` is one
list read by the viewport legend, the sheets, the schedule and the report, so the claim cannot be
true on one projection and forgotten on another. On top of it: every export carries its
readiness; a proposal cannot hold a certificate; a refused member is drawn in its own colour
rather than omitted; and the top assembly bars carry a diameter **this application chose**,
because no CIRSOC clause fixes one for a face the analysis does not tension. Read the design as a
reviewable proposal, not as a despiece to build from.
