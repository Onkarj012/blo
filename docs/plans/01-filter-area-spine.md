# Plan 01 — Filter & Area Spine

**Phase:** 1 (do first — everything else depends on it)
**Goal:** Make the dashboard area-first. Multi-select areas, instant filtering, fix the silent "All Status" bug, and unify the competing List / Clusters tabs into one coherent flow.

---

## Why

The real BLO workflow: pick area(s) on the left → see those voters on the right → export. Today this is painful:

- Only **one** area can be selected (single-value `areaCluster` popover).
- To move between areas you must clear, reselect, re-apply — area-by-area dance.
- There's an **Apply Filters** button + a second client-side re-filter — double work, janky.
- **Bug:** when status = "All", the dashboard sends no `status` param, and `/api/voters/nearby` defaults it to `"pending"` (route.ts:25). "All Status" silently hides everyone who isn't pending.
- "List" tab and "Clusters" tab solve overlapping problems and fight each other.

## Current state (facts)

- `FieldDashboard.tsx` holds `pendingFilters` + `appliedFilters`, fetches `/api/voters/nearby`, then re-filters client-side in `filteredVoters` (line ~573).
- `getVoters` (convex/voters.ts) takes a single optional `areaCluster: string`.
- `getClustersSummary` (convex/clusters.ts) **already** returns per-area `{ name, total, pending, done, revisit, ... , lat, lng }`. Free data for an area panel — no new backend needed.
- ~1500 voters total → safe to load the full set client-side and filter in memory.

## Approach

**Load-all + filter-in-memory.** Fetch the full voter set once (status = all, properly), keep it in state, and derive the visible list purely client-side. This makes multi-area selection, instant filtering, and WYSIWYG export trivial and removes the Apply button.

## Changes

### Backend / API
1. **Fix the status="all" bug.** In `src/app/api/voters/nearby/route.ts`, stop defaulting to `"pending"`. Accept an explicit `status=all` (or absence of status) and pass through so `getVoters` returns all statuses. Verify `getVoters` handler treats missing/`all` status as "no status filter" (check convex/voters.ts handler body).
2. No multi-area backend change required for Phase 1 — area filtering happens client-side. (If perf ever demands it, add `areaClusters: v.array(v.string())` later.)

### Dashboard state
3. Fetch all voters once on mount (and on location change for distance). Drop the `pendingFilters` / `appliedFilters` split and the **Apply Filters** button. Keep one `filters` object; `filteredVoters` recomputes instantly via `useMemo`.
4. Add `selectedAreas: Set<string>` (replaces single `areaCluster` string). `filteredVoters` includes a voter when `selectedAreas.size === 0 || selectedAreas.has(voter.areaCluster)`.

### UI — area-first layout
5. **Left panel = Area list** (desktop sidebar / mobile sheet). Built from `getClustersSummary`:
   - Searchable, scrollable checklist of areas.
   - Each row: area name, voter count, tiny progress (done / total).
   - "Select all" / "Clear" controls. Multi-select via checkboxes.
6. Keep the other filters (name, phone, address, status, gender, age, toggles) below the area list, all instant.
7. **Unify List + Clusters.** Right pane shows the filtered voters. When ≥2 areas are selected, group the list by area with collapsible area headers (reuse the existing `ClusterView` grouping visuals). When 1 or 0 areas selected, flat virtualized list. Remove the separate "Clusters" tab; keep "List" and "Map" tabs only. (Per-cluster export menu from `ClusterView` moves into the area headers.)
8. Selected-area summary bar above the list: "3 areas · 142 voters" + a one-click **Export** that opens the exporter (Plan 02) pre-scoped to exactly what's shown.

## Risks / watch-outs

- Loading all voters removes server-side status filtering — make sure client `filteredVoters` covers every filter the server used (it nearly does already).
- Virtualized list (`VirtualizedVoterList`) assumes a flat array. Grouped-by-area mode needs either grouped virtualization or capped non-virtual rendering per area (areas are small, ~10–50, so plain render per expanded area is fine).
- Distance/location: still needs lat/lng round-trip. Keep that fetch param; compute distance server-side as today.

## Acceptance criteria

- [ ] Selecting 3 areas shows all voters from those 3, grouped by area, no Apply click.
- [ ] "All Status" actually shows all statuses.
- [ ] Typing in name/phone filters instantly.
- [ ] Export button exports exactly the currently visible voters.
- [ ] No "Clusters" tab; its grouping lives in the main list.

## Out of scope (later plans)

- Exporter internals → Plan 02.
- Visual restyle → Plan 03.
- Manual area reassignment + clustering accuracy + photos → Plan 04.
