---
title: "Vite + TypeScript Migration for Bingbong Client"
category: build-tooling
tags:
  - vite
  - typescript
  - migration
  - frontend
  - build-tools
  - web-audio
  - canvas
  - websocket
module: client
symptoms:
  - "No HMR for CSS changes"
  - "No type safety in Audio/Canvas code"
  - "Single 1965-line HTML file difficult to maintain"
  - "Manual browser refresh required after CSS changes"
date: 2026-02-09
---

# Vite + TypeScript Migration for Bingbong Client

## Problem

The bingbong frontend was a single 1965-line HTML file containing all CSS, JavaScript, and HTML. While functional, this created several issues:

- **No HMR**: CSS changes required manual browser refresh
- **No type safety**: Complex AudioEngine and Visualizer classes had no TypeScript protection
- **Poor maintainability**: Four major classes (~800 lines) embedded in one file
- **Difficult debugging**: No source maps or module boundaries

## Root Cause

The original architecture used inline `<script>` and `<style>` tags for simplicity during initial development. As the application grew with Web Audio API (spatial audio, reverb, multiple oscillator types) and Canvas 2D rendering (particles, drag-and-drop), the single-file approach became a liability.

## Solution

Migrated to Vite + TypeScript with a minimal 6-file architecture:

```
client/
├── index.html              # Minimal HTML with Vite entry point
├── src/
│   ├── main.ts             # Entry + state + DOM + WebSocket + UI
│   ├── types.ts            # Shared TypeScript interfaces
│   ├── config.ts           # SOUND_CONFIG, NOTE_FREQ constants
│   ├── audio-engine.ts     # AudioEngine class
│   ├── visualizer.ts       # Visualizer + SourceOverlay + PositionManager
│   └── styles/
│       └── main.css        # Extracted CSS (lift-and-shift)
├── vite.config.ts
└── tsconfig.json
```

### Key Configuration

**vite.config.ts** - WebSocket proxy for dev server:

```typescript
import { defineConfig } from 'vite'

export default defineConfig({
  root: '.',
  server: {
    port: 5173,
    proxy: {
      '/ws': {
        target: 'ws://localhost:3334',
        ws: true,           // Required for WebSocket
        changeOrigin: true,
      },
      '/events': 'http://localhost:3334',
      '/sessions': 'http://localhost:3334',
      '/health': 'http://localhost:3334',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
```

**tsconfig.json** - Strict TypeScript:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "isolatedModules": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

### Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| File count | 6 files (not 11) | Only split at natural boundaries |
| State location | In `main.ts` | No separate module for 6 variables |
| DOM helpers | In `main.ts` | Used in one place only |
| WebSocket code | In `main.ts` | 50 lines, not reusable |
| Spatial classes | Merged in `visualizer.ts` | Tightly coupled, same domain |

## Gotchas

### 1. Canvas Fonts Don't Support CSS Variables

**Problem**: Canvas 2D `ctx.font` doesn't resolve CSS custom properties.

**Bad**:
```typescript
ctx.font = "10px var(--font-mono)"  // Won't work!
```

**Good**:
```typescript
private readonly FONT = "10px 'SF Mono', Monaco, Inconsolata, 'Roboto Mono', monospace"
ctx.font = this.FONT
```

### 2. WebSocket Proxy Requires `ws: true`

**Problem**: Vite won't proxy WebSocket connections without explicit flag.

**Bad**:
```typescript
proxy: {
  '/ws': 'http://localhost:3334'  // HTTP only!
}
```

**Good**:
```typescript
proxy: {
  '/ws': {
    target: 'ws://localhost:3334',
    ws: true,  // Enable WebSocket proxying
    changeOrigin: true,
  }
}
```

### 3. Protocol-Aware WebSocket URLs

**Problem**: Hardcoded `ws://` breaks when served over HTTPS.

**Bad**:
```typescript
ws = new WebSocket('ws://localhost:3334/ws')
```

**Good**:
```typescript
const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
ws = new WebSocket(`${protocol}://${location.host}/ws`)
```

### 4. Server Must Serve Production Assets

Update the server to serve Vite's build output:

```typescript
// Serve static assets from client/dist/assets/
if (req.method === "GET" && url.pathname.startsWith("/assets/")) {
  const assetPath = new URL(
    `../client/dist${url.pathname}`,
    import.meta.url
  ).pathname
  const file = Bun.file(assetPath)
  if (await file.exists()) {
    const ext = url.pathname.split(".").pop()
    const contentTypes: Record<string, string> = {
      js: "application/javascript",
      css: "text/css",
    }
    return new Response(file, {
      headers: { "Content-Type": contentTypes[ext || ""] || "application/octet-stream" },
    })
  }
}
```

## Test Plan

| Flow | Steps | Expected |
|------|-------|----------|
| U1: Page Load | Navigate to localhost:5173 (dev) or :3334 (prod) | Radar grid renders, UI shows disconnected |
| U3: Events | Connect, send test event via POST /events | Sound plays, particle spawns, log updates |
| U4: Spatial | Drag source circle | 3D audio position changes |
| U8: Persistence | Position sources, reload page | Positions restored |
| U9: Mobile | Resize to <900px | Single column layout |

## Related Documents

- Brainstorm: `docs/brainstorms/2026-02-01-vite-migration-brainstorm.md`
- Plan: `docs/plans/2026-02-06-feat-vite-typescript-migration-plan.md`

## Prevention

For future frontend migrations:

1. **Start minimal**: 6 files is better than 11. Split only at natural boundaries.
2. **Test WebSocket proxy early**: Verify in Phase 1, not at the end.
3. **Audit CSS variables in Canvas**: They won't work; extract to constants.
4. **Match server types exactly**: Define interfaces that mirror backend types.
5. **Keep state simple**: Global state in entry file beats a state module for small apps.
