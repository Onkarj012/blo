# Plan 04 — Clustering Fix-up, Manual Review & Photos

**Phase:** 4 (last — quality + corrections, after the core workflow is good)
**Goal:** Let the BLO correct mis-grouped voters by hand, surface the clustering pipeline's own review flags, improve grouping quality, and investigate whether the 1497 captured images can be linked to voters.

---

## Why

The area grouping is what makes the whole tool useful (so a BLO walks one society at a time instead of line-by-line through 1500 names). The grouping **engine already exists and is real** (rule-based + LLM via OpenRouter + geocode + canonicalization + confidence + `needsReview`). User wants it *improved*, not rebuilt, and wants manual correction in the UI.

## Current state (facts)

- `src/lib/area-clustering.ts` (584 lines): rule detection + LLM classification + known-cluster matching + confidence + `needsReview` + `Uncertain:` labels + `suggestedAreaCluster`.
- `src/app/api/admin/recluster-voters/route.ts`: batched recluster pipeline (cursor/limit, dryRun, useExistingClusters, geocoding per cluster).
- Schema (`convex/schema.ts`) stores: `areaClusterSource`, `areaClusterConfidence`, `areaClusterNeedsReview`, `areaClusterReasonCode`, `areaClusterSuggested`, `areaClusterLastClassifiedAt`. Rich metadata already there.
- **Images:** 1497 `capture-*.png` in `data/input/<range>/` (e.g. `1_100`, `101_200` … `1301_1530`), ~89–294 per folder. Filenames are **timestamps**, not voter keys. **No photo/image field in the schema. No mapping** from image → voter. CSV has no image column.

## Part A — Manual review & reassignment (build this)

1. **Review surfacing.** In the voter card / area header, show a subtle badge when `areaClusterNeedsReview` or `areaCluster` starts with `Uncertain:`. Add a dashboard filter "Needs review" so the BLO can sweep them.
2. **Manual reassign.** A control on the voter card to change a voter's area: pick an existing area (from `getClustersSummary`) or type a new one. Writes `areaCluster` + sets `areaClusterSource = "manual"` (add to the schema union) and clears `needsReview`. New Convex mutation (single-voter area override) + thin API route.
3. **Show suggestion.** When `areaClusterSuggested` exists, offer it as a one-tap "Apply suggestion" on the card.
4. This is a **view/correction layer** — it never edits the source CSV (user requirement: CSV stays untouched; grouping is an appended view).

## Part B — Clustering quality improvements (scoped, low-risk)

5. Audit grouping output on the real ~1500 rows: count `needsReview`, `Uncertain:`, and singleton areas (areas with 1 voter that probably belong to a neighbor). Produce a short quality report first.
6. Improve **canonicalization / known-cluster matching** in `normalize.ts` so near-duplicate society names collapse (e.g. "Pimple Saudagar" vs "Pimple-Saudagar" vs typos) — this is the safest lever and directly reduces fragmentation.
7. Optional re-run via the existing recluster endpoint with `useExistingClusters` to consolidate, dryRun first. **Do not** redesign the LLM prompt mid-stream unless the report shows it's the bottleneck.

## Part C — Photos (investigate first, then decide)

8. **Feasibility spike (no commitment yet):** determine whether `capture-*.png` files map 1:1 to voters. Check: does capture count per range match voter count per import batch? Is capture timestamp order == CSV row order? If yes, a deterministic order-based join is possible per batch.
9. If a reliable mapping exists:
   - Add `photoStorageId` / `photoUrl` to schema; upload images to Convex storage (or Vercel Blob) keyed by voter.
   - Show the voter photo on the card (helps the BLO confirm identity at the door) and optionally embed a thumbnail in PDF export.
10. If mapping is **not** reliable: stop. Document why; don't ship guessed photo↔person links (wrong photo on a government doc is worse than none).

## Risks / watch-outs

- Manual reassignment must be auditable — log it via the existing `statusEvents`-style pattern or a new `clusterEvents`.
- Re-running the LLM recluster costs API calls and can *un-fix* manual corrections — make recluster respect `areaClusterSource = "manual"` (skip manual rows).
- Photos: privacy + correctness. Government voter data — never display a misattributed photo. Mapping must be proven, not assumed.

## Acceptance criteria

- [ ] BLO can reassign a voter's area in-app; CSV untouched; change persists with `source = manual`.
- [ ] "Needs review" filter + badges work.
- [ ] Recluster skips manually-corrected voters.
- [ ] A written clustering-quality report exists (counts of review/uncertain/singletons).
- [ ] Photo mapping feasibility documented with a clear yes/no; photos shipped only if mapping proven.

## Out of scope

- The name+age **column-join importer** for appending extra data (user said "later"). Plan 02's export engine is built to accept extra columns, so this slots in cleanly when scheduled.
