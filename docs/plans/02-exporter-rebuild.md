# Plan 02 — Exporter Rebuild

**Phase:** 2 (after the filter/area spine lands)
**Goal:** Turn the overwhelming 1010-line export dialog into a calm, linear 3-step flow that exports exactly what's on screen. Keep every capability (column choice, blank columns, grouped PDF) — just make it legible. Desktop-primary, mobile-ready.

---

## Why

The exporter is the most important feature and currently the most confusing:

- Three accordions (Columns / Blank columns / Options) **all open at once** = a wall of controls.
- A 3-tab sub-panel (CSV / PDF / Grouped) **duplicates** page-size + orientation selectors in two tabs.
- On a phone it's a giant scrolling dialog.
- It re-derives its own area-grouping logic instead of trusting the dashboard selection.

User confirmed: features (column names, blank columns) are important and must stay — the *presentation* is the problem. Exporter is used mostly on desktop but must work on mobile.

## Current state (facts)

- `ExportDialog.tsx` receives `voters` (already the filtered list) + `filters`. Good — it's already WYSIWYG-capable.
- CSV / PDF / grouped-PDF generation logic (jsPDF + autotable) works and should be **preserved**, just reorganized.
- `ClusterView` has its own separate per-cluster CSV/PDF exporters (`exportClusterToCSV` / `exportClusterToPDF`, FieldDashboard.tsx:1318+) — duplicate code to consolidate.

## Target shape — linear 3 steps

Replace accordions + tabs with a single vertical flow (steps, not tabs):

**Step 1 — Columns**
- Same column checklist as today (Name, Phone, Address default-on; rest optional).
- Blank columns control (count, width, optional headers/pattern) folded into a compact "Add blank columns for notes" subsection with a live header preview. Keep all of it — just visually quiet by default (collapsed until "Add blank columns" toggled on).

**Step 2 — Format & layout**
- Pick **one** format up front: three cards → **CSV** · **PDF** · **Grouped PDF (by area)**.
- Shared layout controls (page size, orientation) shown **once**, only when PDF or Grouped is chosen. No duplication.
- Grouped-only options (new page per area, area headers, summary page, sort) appear only when Grouped is chosen.
- PDF meta toggles (title, timestamp, filter summary) live here too.

**Step 3 — Review & export**
- One summary line: "Exporting 142 voters · 4 columns + 2 blank · Grouped PDF · A4 landscape".
- Single primary **Export** button (solid white per Plan 03). Cancel is ghost.

## Changes

1. **Trust the dashboard scope.** Remove the exporter's internal area-selection/grouping decisions; it always exports the `voters` prop. "Grouped" simply groups that same set by `areaCluster`. Drop any logic that re-filters.
2. **Dedupe layout controls.** One page-size + one orientation state, shared across PDF and Grouped. Delete the second copy in the Grouped tab.
3. **Extensible column model.** Keep the `columns` config array as the single source of truth so future joined columns (Plan 04, name+age join) drop in by appending entries — no structural change. Document this in a comment.
4. **Consolidate cluster exports.** Delete `exportClusterToCSV` / `exportClusterToPDF` duplicates in FieldDashboard; the per-area export menu (now in area headers from Plan 01) calls the same export engine with a single-area subset.
5. **Responsive container.** Desktop: centered dialog, comfortable width, single scroll. Mobile: full-screen sheet (`Sheet` side="bottom" or full) instead of a cramped dialog. Steps stack; sticky footer holds Export/Cancel.
6. **Refactor for size.** 1010 lines → split export *engine* (CSV/PDF/grouped builders, pure functions taking `(voters, columnConfig, options)`) into `src/lib/export/` and keep the dialog as thin UI. Makes Plan 04 column-join trivial and the engine testable.

## Risks / watch-outs

- Don't regress the working jsPDF table styling (black borders/grid, blank-column widths in mm). Lift it verbatim into the engine.
- Preview of blank-column headers must stay (users rely on it).
- Keep the BOM (`﻿`) prefix on CSV for Excel/Marathi-name correctness.

## Acceptance criteria

- [ ] One screen, three ordered steps, no duplicated page-size control.
- [ ] Choosing CSV hides all PDF-only controls; choosing Grouped reveals grouping options.
- [ ] Export output is byte-identical in quality to today's (same columns, borders, grouping).
- [ ] Mobile shows a full-screen sheet, not a clipped dialog.
- [ ] Export engine lives in `src/lib/export/` as pure functions; dialog just calls it.
- [ ] Per-area export in the dashboard uses the same engine (no duplicate code).

## Out of scope

- Joining extra CSV columns on name+age → Plan 04 (engine made ready, importer not built).
- Visual tokens (colors/fonts/glass) → Plan 03.
