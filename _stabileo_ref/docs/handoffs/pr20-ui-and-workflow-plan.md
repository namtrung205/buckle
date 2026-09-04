# PR20 — UI and workflow: a plan, and the merge arithmetic behind it

**Status:** plan only. No PR20 code exists. Nothing in this document has been implemented, and
PR19 must be reviewed, taken out of draft and merged before any of it starts.

**Written from:** PR19 at `6e6bc95c` (branch `pr/19-rc-cad-constructibility`), and PR125
(`feat/pro-visual-system`) as it stood when this was written — 36 files, +1 204 / −1 204, draft,
targeting `feat/app-visual-system` (#124) rather than `main`.

**Revised at PR19 `1c5ef3b9`**, the beam top-steel pass. It added two UI surfaces and one new
distinction that a visual pass can silently flatten; both are folded into §2, §3 and §5.2 below
rather than appended, so a reader working through the plan cannot miss them by reading it in
order.

---

## 1. What PR125 actually is

Two things in one draft, and they carry very different risk.

**A palette migration that is mechanical.** Eight of the nine files PR125 shares with PR19 are
`+N/−N` with N identical on both sides — a line-for-line substitution of colour literals for
tokens. Nothing moves; each edited line is replaced in place.

**A shell proposal that is structural, and explicitly open to argument.** Its own description
says so: a grouped tab rail inside the panel, a pipeline strip under the command row, a
quick-access block, a resizable panel. Only the palette slice is described as testable today.

The distinction matters because it decides the order of work: the first half can be absorbed
almost mechanically, the second half is a design conversation that has not happened yet.

## 2. The merge arithmetic

Nine files are touched by both. Measured, not estimated — PR19 against its merge base
`4a8e6b5e`, PR125 from the GitHub API:

| File | PR19 | PR125 | Shape of the risk |
|---|---|---|---|
| `App.svelte` | +76 / −13 | +44 / −10 | **The only structural clash.** Both sides add and remove. |
| `pro/ProPanel.svelte` | +7 / −0 | +62 / −62 | Additive vs substitution — low |
| `pro/ProDesignTab.svelte` | +44 / −1 | +9 / −9 | Low |
| `pro/ProAutoLoadsDialog.svelte` | +4 / −1 | +38 / −38 | Low |
| `design/DesignToolbar.svelte` | +22 / −0 | +30 / −30 | Low, but see §3 |
| `design/DetailingWorkflow.svelte` | +32 / −0 | +18 / −18 | Low |
| `design/FoundationsPanel.svelte` | +50 / −5 | +7 / −7 | Low |
| `design/FootingMatPanel.svelte` | +26 / −18 | +7 / −7 | Medium — both sides delete |
| `design/FloorFamiliesPanel.svelte` | +15 / −6 | +10 / −10 | Low |

PR19 also ships components PR125 has never seen — `RebarWorkspace`, `RebarViewport3D`,
`RebarLayersPanel`, `RebarStatusPanel`, `SelectionDetails`, `ProvisionalBanner`,
`TorsionBanner`. They carry **hard-coded hex colours** and will not be tokenised by PR125's
sweep, because that sweep ran before they existed. That is the largest *silent* integration
gap: not a conflict, a divergence. After PR125 lands, the 3-D workspace would be the only
surface in PRO still speaking the old palette.

### Colours PR19 introduced that need a token, with their meaning

These are load-bearing: each already means one thing across several surfaces, and the migration
must preserve the mapping rather than pick the nearest hue.

| Hex | Meaning | Where it appears |
|---|---|---|
| `#a066d3` | provisional proposal | 3-D bar colour, workspace banner, status dot, `summary-count-provisional` chip |
| `#d4762a` | unreinforced / refused | unreinforced concrete, status dot, torsion banner border |
| `#ff2d55` | conflict marker | 3-D marker instances |
| `#e0444a` | conflicted bar | 3-D bar colour, `failed` status dot |
| `#ffd400` | selection | highlight ring, selected member row |
| `#4caf72` | modelled | status dot |

One later addition belongs in the same table by exception rather than by inclusion. The
top-steel chip in `RebarStatusPanel` (`.hanger-chip`, `border #6c6c6c` / `text #b9b9b9`) is
**deliberately neutral** and must NOT be nearest-matched onto a state token. It marks a fact
that is orthogonal to the seven states — see §5.2 — and giving it a state's colour would make it
read as an eighth state, which is precisely the reading the field was built to avoid.

## 3. What PR19 changed under PR125's feet

Two edits landed in files PR125 rewrites, and both are additive markup rather than restyling:

- `DesignToolbar.svelte` gained a `summary-count-provisional` chip (`◐ N provisional`,
  `.c-prov { color: #a066d3 }`). PR125 rewrites every colour declaration in that file, so the
  new rule must be migrated with the rest and not left behind as the one literal in a tokenised
  stylesheet.
- `DetailingWorkflow.svelte`, `FoundationsPanel.svelte` and `ProDesignTab.svelte` gained
  controls and panels around the RC workflow.
- `DetailingWorkflow.svelte` later gained a **`Función` column** in the bar schedule table
  (`Resistente` / `Armado (25.7.1.2)`), which changed the table's column count and its `tfoot`
  colspan. A layout pass that rebuilds this table must carry the column: it is the only place on
  the schedule where a reader can tell steel that resists a moment from steel that holds a
  stirrup.
- `RebarStatusPanel.svelte` gained an aggregate row and a per-element chip for the same
  distinction. See §2's note on its deliberately neutral colour.

None of it should produce a semantic conflict. All of it will produce a textual one if the
branches are merged in the wrong order.

## 4. Recommended integration strategy

**Order.** `#124` → `#125` → PR19 → PR20. PR125 already targets #124; PR19 is the larger and
more finished branch, and rebasing a 36-file colour substitution onto it is far cheaper than
rebasing PR19's engine and detailing work onto a moving shell.

**A caveat on that order.** It means PR125 pays the conflict cost. The alternative — PR19 first
onto main, then PR125 rebased — is the same total work and puts it on the branch better able to
absorb it, because a colour substitution can be re-derived by re-running the sweep. If PR125's
author still has the generator (`web/.pro-audit.mjs` is in its file list), **re-running the
sweep after PR19 lands is strictly better than merging it**: it picks up PR19's new components
for free and eliminates every conflict in the table above.

That is the single most valuable thing to establish before starting PR20: *is the palette
migration reproducible, or is it a hand-edited diff?* If reproducible, §2's whole table stops
being a risk.

**Split PR125 in two before integrating.** The palette slice can land behind a review that is
mostly mechanical. The shell proposal (tab rail, pipeline strip, quick access, resizable panel)
should be its own PR with its own argument, because it changes navigation for every PRO user
and PR19 has just added a full-window overlay that interacts with it (see §5).

## 5. PR20's own work, in order

### 5.1 Navigation and layout

PR125 proposes moving PRO's 13 tabs out of the command row and into a rail inside the panel.
PR19 adds a **full-window 3-D overlay** (`RebarWorkspace`, `z-index: 900`, `position: fixed`)
reached from the detailing panel. The two need one decision: is the workspace a fourteenth
destination in the rail, or an overlay that escapes the shell entirely? It is currently the
latter, deliberately — the sidebar's fixed pixel width is what made the old in-panel viewer
unusable — and the rail proposal must not quietly re-nest it.

The pipeline strip (`MODEL ✓ · SOLVED ✓ · DEMANDS ✓ · CODE CHECK ⚠ · DESIGN — · DETAILING —`)
is the highest-value item in PR125's proposal and the one PR19 makes most useful: the RC
pipeline now has real, distinguishable states at every stage.

### 5.2 Accessibility

Not audited in PR19 and not free. Ordered by how badly it fails a keyboard user.

**1. The 3-D workspace has no focus management at all.** It is
`role="dialog" aria-modal="true"`, `position: fixed`, `z-index: 900`, and:

- **no focus trap.** Tab from inside the overlay walks straight into the page behind it, which
  `aria-modal` has just told a screen reader does not exist. The user is then typing into
  controls they cannot see, and the reading order and the visual order disagree completely.
- **no initial focus.** Opening it leaves focus on the button that opened it — a button now
  underneath a full-window overlay — so the first Tab lands somewhere arbitrary.
- **no focus restore on close.** Escape closes the overlay and focus goes to `<body>`. The user
  is returned to the top of the document rather than to the control they left.
- Escape is the only keyboard affordance the overlay has.

The fix is the standard one and it is small: remember `document.activeElement` on open, move
focus to the dialog, cycle Tab/Shift+Tab within it, restore on close. It is listed first
because it is the only item here that makes the feature *unusable* rather than *degraded*, and
because `aria-modal="true"` on a dialog that does not trap focus is worse than no ARIA at all —
it actively lies to the assistive technology.

**2. No keyboard route to selection.** Every inspection gesture in the viewport is pointer-only:
picking a bar, picking a solid, picking a conflict marker. The member list beside the canvas IS
keyboard-reachable and selects and focuses the camera, so the *capability* exists — what is
missing is a route to the things that are only in the picture, chiefly the conflict markers.
Cheapest honest answer: make the conflict list in the detailing panel selectable the way the
member list is, so every clickable thing in the 3-D view has a keyboard twin outside it. That is
a smaller job than making the canvas itself focusable and it satisfies the same requirement.

**3. The rail has no landmark and no heading structure.** The layer switches are real checkboxes
with real labels, which is the part that usually goes wrong and here does not. But the rail is a
bare `<aside>` with `<h4>`s and no accessible name, so a screen-reader user cannot jump to
"layers" or "model status"; they arrive by walking.

**4. The canvas has no text alternative.** Not "add alt text" — the honest fix is the rule
below.

**5. Colour is the only carrier of several distinctions IN THE GEOMETRY.** Provisional violet,
conflict red, unreinforced orange, selection yellow. Every one of them is also stated as text
somewhere — the banners, the tally, the status rows, the inspector — but not in the picture.

That last one is a real WCAG 1.4.1 exposure and the fix is not a palette change. It is a design
rule worth writing down before someone removes the thing that satisfies it:

> **Anything the 3-D view says with colour, the panel beside it must also say in words.**

Today that holds — the tally counts each family, the status panel names each state, the banners
name each warning, the inspector names the selected member's state. It holds by accident of good
design rather than by contract, and a PR20 that tidies panels could break it without noticing.

**Consistency of provisional states across the shell (PR19 finished this, PR20 must not undo
it).** `PROVISIONAL` is now expressible on every status channel: the design `DisplayStatus`, the
detailing `ElementStatus`, the summary bar, the row badge, the row filter, the 3-D bar colour and
the workspace banner. All of them are violet `#a066d3` and all of them carry a glyph and text as
well as the colour. Two invariants to preserve through the token migration:

- the violet must survive as ONE token, not be nearest-matched onto the failure red or a generic
  accent — the whole point of the state is that it is neither a pass nor a failure;
- `OutcomeBadge` renders glyph + text + `sr-only` text for every state. A visual pass that
  reduces a badge to a coloured dot removes the only non-colour carrier on the design surface.

**A second axis the shell must keep separate from the first (added at `1c5ef3b9`).** A beam's
top steel can be the constructive pair §25.7.1.2 asks for rather than reinforcement designed
against a moment. That is **orthogonal to the seven states**: 62 of the 63 members carrying it
are proposals and one is verified, so it lives in its own field (`ElementStatusEntry.topSteel`,
`ElementStatusReport.hangerTopMembers`) and its own chip, never in the state column.

The temptation a panel tidy-up will feel is to merge the chip into the state badge, because on
screen they sit next to each other and look like variants of one idea. They are not: a field
that can hold only one of the two facts has to drop the other, and dropping either produces a
sentence that is false. Two invariants:

- the state column keeps saying what the DESIGN concluded; the chip keeps saying what the top
  steel IS. Neither may be derived from the other.
- the chip is not decoration. Together with the schedule's `Función` column, the sheet note and
  the report section, it is how a reader learns that a diameter on the drawing is this app's
  choice and not the regulation's. Removing any one of the four leaves that unsaid on the
  surface somebody happens to be holding.

`docs/handoffs/pr19-beam-top-steel.md` §8 is the table of which surface says what.

### 5.3 Design workflow

The inconsistency this section used to carry — a proposal displaying as `fail` in the summary
bar — **was fixed in PR19** once it was explicitly authorised. `DisplayStatus` gained a
`provisional` value, applied under the same narrow predicate the detailing status uses. Nothing
is left open here; what remains is the instruction in §5.2 not to undo it.

One smaller thing does remain, and it is a wording call rather than a defect: the three status
channels use three phrasings for the same state — `design.status.provisional`
("Propuesta provisional"), `design.counts.provisional` ("provisorio") and
`detailing.scene.status.PROVISIONAL` ("Propuesta provisional"). Worth unifying in a copy pass.

### 5.4 Viewer

PR19 leaves the viewer functional and measured. What PR20 should pick up:

- **A family switch costs seconds on the E2E runner** — about 4 s on the 7-storey building with
  39 240 conflict markers visible, about 0,8 s with them off. That is fill rate, not
  tessellation, and the file's own benchmark says so. It is inside the range already measured
  for a working toggle, and it is the cost of the switches actually working. Any further gain
  needs a decision that PR19 was told not to take (marker tessellation, incremental GPU upload).
- `rebar-viewport-cost.spec.ts` now takes 12,3 min instead of 6,6 because the switches do real
  work. Every test passes; two of them starve when the whole file runs on a loaded machine. The
  fix is to stop paying for five full 7-storey setups in one file, not to loosen a budget.
- The rail is a scrolling sidebar whose sections keep their own height (fixed in PR19 after a
  section was crushed to zero). Any new banner above the body eats rail height; the invariant is
  now guarded by a test, but the header is the thing to watch.

### 5.5 Panels and visual consistency

After PR125, run one audit pass over the RC surfaces it never saw (§2 table) and migrate them
with the meanings intact. The six colours listed there are the contract; the hexes are not.

## 5.6 Integrating PR125 AFTER PR19 — the specific risks

Stated separately from §6 because this is the ordering the plan recommends, and it is worth
being explicit about what that ordering costs.

1. **PR125's sweep predates seven RC components and one status state.** Re-running it (if it can
   be re-run) picks them up; merging its diff does not. If it is merged rather than re-run, the
   3-D workspace, both banners, the layers rail, the status panel, the selection details and the
   new provisional badge stay on literal hexes while everything around them moves to tokens.
2. **The provisional violet is now load-bearing in six places** and three of them are new since
   PR125 was written (`summary-count-provisional`, `.badge-provisional`, `TorsionBanner`'s amber
   sibling). A nearest-colour rule that has never seen them will map them by hue alone.
3. **`App.svelte` is the one structural clash** and PR19 grew it further this pass. Resolve by
   hand with both suites green either side; do not accept a mechanical merge.
4. **PR125's shell proposal interacts with the overlay.** The tab rail assumes the panel owns
   navigation; the 3-D workspace deliberately escapes the panel because the panel's fixed pixel
   width is what made the old in-panel viewer unusable. Decide this before building, not during.
5. **PR125 targets #124, not `main`.** Anything that lands before #124 changes what PR125 has to
   rebase onto. PR19 landing first is therefore a decision about #124's queue too, not only
   about these two branches.

## 6. Risks, ranked

1. **PR125 is a hand-edited diff rather than a re-runnable sweep.** Turns a mechanical
   integration into 36 files of manual conflict resolution and leaves PR19's components
   untokenised. *Establish this first — it changes the whole plan.*
2. **`App.svelte` structural conflict.** The one file where both sides add and remove. Resolve
   by hand, with both branches' tests green before and after.
3. **The tab rail re-nesting the 3-D workspace.** Would undo the reason the overlay exists.
4. **Palette migration flattening a meaning.** Violet-for-proposal and orange-for-unreinforced
   are used across four surfaces each; a nearest-colour rule that maps them onto one token
   destroys a distinction the whole honest-status effort exists to make.
5. **Accessibility treated as a styling pass.** The keyboard and focus gaps in the overlay are
   structural and will not be fixed by tokens.

## 7. Explicitly out of scope for PR20

Carried forward from PR19's constraints and unchanged: the Fundaciones/Dados switch
relationship, the biaxial threshold, the crosstie rule, torsion authority, the 40 065
collisions, marker tessellation, incremental GPU upload, Rust, Cargo, WASM, the solver, Landing,
Basic/Education, V1 and the golden fixtures.
