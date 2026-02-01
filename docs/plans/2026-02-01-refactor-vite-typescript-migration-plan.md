---
title: Migrate Frontend to Vite + TypeScript
type: refactor
date: 2026-02-01
---

# Migrate Frontend to Vite + TypeScript

## Overview

Migrate the bingbong frontend from a single inline HTML file (`client/index.html` with ~480 lines CSS, ~870 lines JS) to a modular Vite + TypeScript setup with separate CSS and JS files. This improves developer experience (HMR), code organization (maintainable modules), type safety, and establishes a foundation for future tooling.

## Problem Statement / Motivation

The current architecture has all frontend code inline in a single 1470-line HTML file:
- No hot module replacement - changes require full page reload
- No type checking - runtime errors only discovered in browser
- Difficult to navigate and maintain - single file with multiple concerns
- No build optimization - serving raw code rather than minified bundles

## Proposed Solution

**Minimal Vite migration** - Extract code to TypeScript modules with existing CSS preserved (Tailwind deferred). Use Vite dev server with proxy to Bun backend for development; Bun serves production builds from `client/dist/`.

### Target File Structure

```
client/
├── index.html              # Minimal HTML with Vite entry point
├── src/
│   ├── main.ts             # Entry point, initializes app
│   ├── types.ts            # Shared TypeScript interfaces
│   ├── config.ts           # SOUND_CONFIG, NOTE_FREQ, WS_URL
│   ├── audio-engine.ts     # AudioEngine class
│   ├── visualizer.ts       # Visualizer class
│   ├── websocket.ts        # WebSocket manager, state, UI updates
│   └── styles/
│       └── main.css        # Extracted CSS (verbatim from inline)
├── vite.config.ts
└── tsconfig.json

# Root package.json changes:
# - Add devDependencies: vite, typescript
# - Add scripts: dev:client, build:client, dev (concurrent)
```

## Technical Approach

### Phase 1: Build Configuration

Set up Vite and TypeScript configuration files.

**Tasks:**

- [x] Create `client/vite.config.ts` with proxy to Bun backend

```typescript
// client/vite.config.ts
import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  server: {
    port: 5173,
    proxy: {
      '/ws': {
        target: 'ws://localhost:3334',
        ws: true,
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
});
```

- [x] Create `client/tsconfig.json` with strict mode

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "module": "ESNext",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"]
}
```

- [x] Update root `package.json` with Vite dependencies and scripts

```json
{
  "devDependencies": {
    "vite": "^5.0.0",
    "typescript": "^5.3.0"
  },
  "scripts": {
    "start": "bun run bin/cli.ts",
    "dev:server": "bun --watch run bin/cli.ts",
    "dev:client": "cd client && vite",
    "build:client": "cd client && vite build",
    "preview:client": "cd client && vite preview"
  }
}
```

### Phase 2: Extract CSS

Extract inline CSS to separate file.

**Tasks:**

- [x] Create `client/src/styles/main.css` - copy lines 7-490 from current `index.html`
- [x] Preserve all CSS custom properties in `:root` block
- [x] Preserve all component styles and media queries
- [x] No modifications to CSS - verbatim extraction

### Phase 3: Extract TypeScript Modules

Extract inline JS to TypeScript modules with proper types.

**Tasks:**

- [x] Create `client/src/types.ts` - shared interfaces

```typescript
// client/src/types.ts
export interface SoundConfig {
  note?: string;
  notes?: string[];
  duration: number;
  type: OscillatorType;
  gain: number;
}

export interface Session {
  session_id: string;
  machine_id: string;
  pan: number;
  color: string;
  event_count: number;
}

export interface BingbongEvent {
  event_type: string;
  session_id: string;
  machine_id: string;
  timestamp: string;
  tool_name?: string;
  pan?: number;
  session_index?: number;
  color?: string;
}

declare global {
  interface Window {
    webkitAudioContext: typeof AudioContext;
  }
}
```

- [x] Create `client/src/config.ts` - extract SOUND_CONFIG, NOTE_FREQ (lines 625-756)
- [x] Create `client/src/audio-engine.ts` - extract AudioEngine class (lines 761-938)
  - Add TypeScript types for all methods
  - Export class as default or named export
- [x] Create `client/src/visualizer.ts` - extract Visualizer class (lines 943-1157)
  - Add TypeScript types for canvas, particles, sessions
  - Export class
- [x] Create `client/src/app.ts` - extract connection logic and state (lines 1161-1419)
  - WebSocket URL must handle dev vs production: `const WS_URL = import.meta.env.DEV ? 'ws://localhost:3334/ws' : \`ws://\${location.host}/ws\`;`
  - Export connect/disconnect functions
  - Manage global state (sessions Map, event log)
- [x] Create `client/src/main.ts` - entry point

```typescript
// client/src/main.ts
import './styles/main.css';
import { AudioEngine } from './audio-engine';
import { Visualizer } from './visualizer';
import { initApp, connect, disconnect } from './websocket';

document.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('visualizer') as HTMLCanvasElement;
  const visualizer = new Visualizer(canvas);
  const audioEngine = new AudioEngine();

  initApp(visualizer, audioEngine);

  // Setup event listeners for controls
  // ...
});
```

### Phase 4: Update HTML and Server

Create minimal HTML entry point and update server for production builds.

**Tasks:**

- [x] Create new `client/index.html` (minimal, Vite-compatible)

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bingbong</title>
</head>
<body>
  <!-- Same HTML structure as current, minus inline CSS/JS -->
  <a href="#main-content" class="skip-link">Skip to main content</a>
  <div class="container">
    <!-- header, main grid, sidebar, etc. -->
  </div>
  <script type="module" src="/src/main.ts"></script>
</body>
</html>
```

- [x] Update `src/server.ts` to serve from `client/dist/` in production

```typescript
// In server.ts GET / handler
const distPath = new URL("../client/dist/index.html", import.meta.url).pathname;
const devPath = new URL("../client/index.html", import.meta.url).pathname;

const distFile = Bun.file(distPath);
if (await distFile.exists()) {
  // Production: serve built files
  return new Response(distFile, { headers: { "Content-Type": "text/html", ...corsHeaders } });
}

// Development fallback: serve source files (or let Vite handle it)
const devFile = Bun.file(devPath);
if (await devFile.exists()) {
  return new Response(devFile, { headers: { "Content-Type": "text/html", ...corsHeaders } });
}
```

- [x] Add static file serving for `client/dist/assets/` (JS, CSS bundles)

### Phase 5: Verification

**Tasks:**

- [x] Run `bun install` to install vite and typescript
- [x] Run `bun run dev:server` in one terminal
- [x] Run `bun run dev:client` in another terminal
- [ ] Verify HMR works for TypeScript changes
- [ ] Verify HMR works for CSS changes
- [ ] Verify WebSocket connection works through proxy
- [ ] Verify audio plays on first user gesture
- [x] Run `bun run build:client` and verify production build
- [x] Test production build served by Bun

## Acceptance Criteria

### Functional Requirements

- [ ] HMR works for TypeScript and CSS changes in development
- [ ] All existing functionality preserved (audio synthesis, visualization, WebSocket events)
- [ ] WebSocket connects in both dev (via Vite proxy) and production (direct to Bun)
- [ ] AudioContext initializes on first user gesture (Connect button click)
- [ ] Production build generates minified JS/CSS in `client/dist/`
- [ ] Bun server serves production builds correctly

### Non-Functional Requirements

- [ ] No visual regressions from CSS extraction
- [ ] TypeScript compiles with strict mode, no errors
- [ ] Each module has single responsibility
- [ ] No circular dependencies between modules

## Dependencies & Risks

**Dependencies:**
- Vite 5.x
- TypeScript 5.x
- No framework dependencies (remains vanilla TypeScript)

**Risks:**

| Risk | Mitigation |
|------|------------|
| Visual regressions from CSS extraction | Verbatim copy, manual visual comparison |
| WebSocket proxy misconfiguration | Test proxy early in Phase 1 |
| AudioContext lost on HMR | Document limitation; full page reload if audio breaks |
| Dev workflow friction (two terminals) | Consider adding `concurrently` later if needed |

## Open Questions Resolved

1. **WebSocket URL in dev vs production:** Use `import.meta.env.DEV` to detect environment and construct appropriate URL.

2. **Production serving:** Bun checks for `client/dist/index.html` first; serves that if exists, otherwise falls back to dev HTML.

3. **Concurrent dev:** Start with two terminals approach; add `concurrently` as enhancement if needed.

## References

### Internal References
- Brainstorm: `docs/brainstorms/2026-02-01-vite-migration-brainstorm.md`
- Current client: `client/index.html` (1470 lines to extract)
- Server: `src/server.ts:212-234` (static file serving)

### External References
- [Vite Documentation](https://vitejs.dev/)
- [Vite Server Proxy](https://vitejs.dev/config/server-options.html#server-proxy)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/)
