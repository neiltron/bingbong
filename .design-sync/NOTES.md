# design-sync notes — bingbong

- The repo had no component library before 2026-07-07: `packages/design-system` was authored specifically for this sync (user-approved), wrapping the CSS classes in `apps/client/src/styles/design-system.css` 1:1 as React components. That CSS file remains the single source of truth — the package build concatenates it into `dist/styles.css` (font `@import` header + full CSS). Keep the wrappers in lockstep with it.
- Build is `bun install && bun run --cwd packages/design-system build` (tsc + CSS concat). React is hoisted to the repo-root `node_modules` — pass `--node-modules ./node_modules`, `--entry ./packages/design-system/dist/index.js`.
- Fonts (Geist Mono, Inter) load from Google Fonts via remote `@import`, same as `apps/client/index.html`. Validator reports `[FONT_REMOTE]` — expected, not a miss.
- A relative `@import` in `cssEntry` is NOT followed/copied by the converter (`[CSS_IMPORT_MISSING]` on first run) — hence the flattened single-file `dist/styles.css`.
- No provider needed; `Theme` (data-theme wrapper) is only for dark scoping in previews.

## Known render warns

- ~~SourceNode labels use `--color-text-inverse`, so they're near-invisible on `idle`/`disconnected` nodes (light theme) and low-contrast on dark~~ — fixed 2026-07-19 while upstreaming the "Ink + Gold" handoff overrides: dark labels now use `--color-text-primary`, idle/disconnected labels `--color-text-muted`.

## 2026-07-19 — "Ink + Gold" recolor + handoff upstreams

- The Claude Design handoff ("Color scheme alternatives" / trace-first monitor) palette is now the DS default in `design-system.css` — no wrapper overrides needed. Legacy token names kept: `--color-teal` = ink `#201A12` (light) / olive-gold `#6B5A3A` (dark); `--color-deep-teal` = dark ink base `#171310`.
- Upstreamed the handoff's component-level overrides: `Button size="small"` (`.btn-small`), `AgentSession density="compact"` (`.agent-session--compact` fluid pill), SourceNode label contrast fixes.

## Re-sync risks

- `packages/design-system` wrappers can drift from `design-system.css` if classes are added/renamed there — a re-sync rebuild won't fail on drift; check new classes in that CSS have wrapper coverage.
- Google Fonts remote import means previews need network to render the true fonts; offline render checks silently fall back to system mono/sans.
- Previews use bingbong domain content (agents, tools, soundscapes) — safe from upstream churn; no data inlined into config.
- Toolchain assumption: bun ≥1.3 at repo root, tsc from the package's devDeps.
