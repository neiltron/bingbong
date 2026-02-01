# Vite Migration Brainstorm

**Date:** 2026-02-01
**Status:** Ready for planning

## What We're Building

Migrate the bingbong frontend from a single inline HTML file to a modular Vite + TypeScript setup with separate CSS and JS files. The goal is improved developer experience (HMR, better errors), code organization (maintainable modules), and a foundation for future tooling.

### Current State

- Single `client/index.html` with ~480 lines inline CSS and ~870 lines inline JS
- No build tooling - Bun serves the HTML directly
- Vanilla JavaScript with ES6+ features (classes, async/await)
- Web Audio API for sound synthesis, Canvas for visualization, WebSockets for real-time communication

### Target State

- Vite dev server with proxy to Bun backend (port 3334)
- TypeScript for type safety across AudioEngine, Visualizer, and WebSocket handling
- Feature-based modules: `audio-engine.ts`, `visualizer.ts`, `websocket.ts`, `config.ts`, `main.ts`
- Extracted CSS files (keeping existing CSS variables/custom properties)
- Production build output served by Bun

## Why This Approach

**Minimal Vite (TypeScript, keep existing CSS)** was chosen over:

1. **Full Vite + Tailwind** - Lower risk of visual regressions, faster initial migration. Tailwind can be adopted incrementally later.
2. **Library Mode** - Wanted full HMR benefits and proper module system.

This approach prioritizes:
- Fast iteration with HMR
- Type safety for complex audio/visual code
- Maintaining current visual design exactly
- Foundation for incremental CSS improvements

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Build tool | Vite | Industry standard, excellent TS support, fast HMR |
| Language | TypeScript | Type safety for AudioEngine, Visualizer classes |
| CSS approach | Keep existing CSS variables | Avoid visual regressions, convert Tailwind later |
| Dev mode | Vite proxy to Bun | Separate processes, proxy WebSocket/API to :3334 |
| Module structure | Feature-based files | One file per major concern (audio, visual, network, config) |

## Proposed File Structure

```
client/
├── index.html          # Minimal HTML with Vite entry point
├── src/
│   ├── main.ts         # Entry point, initializes app
│   ├── config.ts       # Sound mappings, note frequencies
│   ├── audio-engine.ts # AudioEngine class
│   ├── visualizer.ts   # Visualizer class
│   ├── websocket.ts    # WebSocket connection handling
│   ├── types.ts        # Shared TypeScript types
│   └── styles/
│       └── main.css    # Extracted CSS (existing styles)
├── vite.config.ts
└── tsconfig.json

# Root package.json additions:
# - vite, typescript as devDependencies
# - Scripts: dev:client, build:client
```

## Open Questions

1. **Tailwind timeline** - When to start incremental Tailwind adoption?
2. **Production serving** - Should Bun serve from `client/dist/` or copy built files elsewhere?
3. **Concurrent dev** - Use `concurrently` package or just run two terminals?

## Success Criteria

- [ ] HMR works for TypeScript and CSS changes
- [ ] All existing functionality preserved (audio, visualization, WebSocket)
- [ ] No visual regressions from CSS extraction
- [ ] Clean separation of concerns in modules
- [ ] Production build works and is served by Bun

## Next Steps

Run `/workflows:plan` to create implementation plan.
