# design-sync notes — bingbong

- The repo had no component library before 2026-07-07: `packages/design-system` was authored specifically for this sync (user-approved), wrapping the CSS classes in `apps/client/src/styles/design-system.css` 1:1 as React components. That CSS file remains the single source of truth — the package build concatenates it into `dist/styles.css` (font `@import` header + full CSS). Keep the wrappers in lockstep with it.
- Build is `bun install && bun run --cwd packages/design-system build` (tsc + CSS concat). React is hoisted to the repo-root `node_modules` — pass `--node-modules ./node_modules`, `--entry ./packages/design-system/dist/index.js`.
- Fonts (Geist Mono, Inter) load from Google Fonts via remote `@import`, same as `apps/client/index.html`. Validator reports `[FONT_REMOTE]` — expected, not a miss.
- A relative `@import` in `cssEntry` is NOT followed/copied by the converter (`[CSS_IMPORT_MISSING]` on first run) — hence the flattened single-file `dist/styles.css`.
- No provider needed; `Theme` (data-theme wrapper) is only for dark scoping in previews.

## Known render warns

- SourceNode labels use `--color-text-inverse`, so they're near-invisible on `idle`/`disconnected` nodes (light theme) and low-contrast on dark — the DS's own token choice, faithful to the app (the real visualizer draws labels on canvas via `--viz-label`). Graded good deliberately.

## Re-sync risks

- `packages/design-system` wrappers can drift from `design-system.css` if classes are added/renamed there — a re-sync rebuild won't fail on drift; check new classes in that CSS have wrapper coverage.
- Google Fonts remote import means previews need network to render the true fonts; offline render checks silently fall back to system mono/sans.
- Previews use bingbong domain content (agents, tools, soundscapes) — safe from upstream churn; no data inlined into config.
- Toolchain assumption: bun ≥1.3 at repo root, tsc from the package's devDeps.
