# Plan 03 — Aesthetic Sweep (reference.html)

**Phase:** 3 (after function is solid — restyle once, everywhere)
**Goal:** Adopt the `data/reference.html` look — strict monochrome, frosted glass, masked grid texture, Geist typography — while keeping **restrained semantic status colors** (so field agents can still scan Done/Pending/Revisit fast). Both light and dark modes. Phone + desktop.

---

## Why

The reference is a cohesive, premium monochrome-glass system (white = the only decorative accent). The app already half-implements it in dark mode (`glass-surface`, `bg-grid-texture`, radial glow). This phase finishes the job consistently and adds a matching light mode.

User decisions:
- **Keep semantic colors for status only**, everything else monochrome/glass.
- **Keep light mode** (BLO works outdoors in sunlight) — invest most polish in dark to match reference, make light a clean equivalent.

## Reference recipe (from data/reference.html)

- **Glass:** `bg white/4–6%`, `backdrop-blur(16px) saturate(140%)`, `1px solid white/10` border, inset top sheen, `rounded-2xl`. One elevated surface per view, max.
- **Texture:** masked grid (64px) + a single top radial glow. Already present in dark — keep, refine, and add a light-mode equivalent (faint neutral grid).
- **Buttons:** exactly one solid primary (white on black / black on white), the rest ghost-glass. Clear `:focus-visible` ring.
- **Type:** Geist + Geist Mono, tight letter-spacing on headings, generous line-height on body.

## Current state (facts)

- Font is **Inter** (`layout.tsx`), `--font-sans`. `defaultTheme="dark"`.
- `globals.css` already defines `.glass-surface`, `.glass-header`, `.bg-grid-texture` (dark only) and full light/dark CSS-var token sets via shadcn.
- Status colors flow through `statusConfig` (FieldDashboard.tsx:156) using badge variants.

## Changes

1. **Typography.** Swap Inter → **Geist** (sans) + **Geist Mono** (numbers, EPIC, phone, counts) via `next/font/google`. Update `--font-sans` / add `--font-mono`. Apply mono to tabular data (counts, ages, distances, phone).
2. **Token pass.** Keep the existing dark palette (it already matches reference: near-black bg, white-ish foreground, white primary). Tighten the **light** palette to a clean neutral equivalent (off-white paper, near-black ink, subtle borders) — not the current bluish shadcn defaults.
3. **Glass everywhere intentional, not everywhere.** Apply `glass-surface` to: header (done), stat cards (done), filter/area panel, exporter container, the one elevated answer-style surface. Do **not** glass every voter row (perf + it stops reading as special). Voter cards = flat card with hairline border; only hover lifts.
4. **Light-mode texture.** Add a light variant of `.bg-grid-texture` + a faint top glow so glass has something to refract in both themes (reference's core rule: glass is invisible on flat bg).
5. **Buttons.** Establish the hierarchy repo-wide: one solid primary per view (Export, Mark Done), everything else ghost-glass. Add a consistent `focus-visible` ring. Map shadcn `Button` variants to this so it's automatic.
6. **Status colors, restrained.** Desaturate the status palette to muted/clear tones that survive on glass: e.g. done = calm green, pending = neutral/amber, revisit = restrained red, locked/wrong = muted. High-contrast labels per the reference accessibility note (glass = low contrast, so keep text bright).
7. **Spacing & rhythm.** Adopt reference spacing scale (generous section padding, hairline separators `white/6–10%`). Tighten heading sizes/`tracking` to match.
8. **Mobile polish.** Verify every glass surface degrades gracefully on small screens; respect `prefers-reduced-transparency` and `prefers-reduced-motion` (reference includes both — port the media queries).

## Risks / watch-outs

- `backdrop-filter` is GPU-cost; keep it to a few hero surfaces, never per-row (reference warns this explicitly).
- Light mode glass needs a textured/colored backdrop or it looks like flat grey.
- Don't let restrained status colors get so muted they fail contrast — labels stay bright.
- Geist must be loaded with `display: swap` to avoid layout shift; keep Inter as fallback stack.

## Acceptance criteria

- [ ] Geist + Geist Mono live; numeric/data fields use mono.
- [ ] Light and dark both look intentional; glass reads in both (texture behind it).
- [ ] Exactly one solid primary button per screen; rest are ghost-glass with focus rings.
- [ ] Status colors readable on glass, still instantly scannable.
- [ ] No glass blur on long lists (only hero surfaces).
- [ ] `prefers-reduced-transparency` / `reduced-motion` honored.

## Out of scope

- Functional behavior (covered by Plans 01–02).
- Clustering/photos (Plan 04).
