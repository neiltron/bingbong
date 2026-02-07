---
title: "feat: Vite + TypeScript Migration"
type: feat
date: 2026-02-06
revised: 2026-02-07
---

# Vite + TypeScript Migration

## Overview

Migrate the bingbong frontend from a single inline HTML file (~1965 lines) to a Vite + TypeScript setup. The goal is HMR for faster iteration and type safety for the complex Audio/Canvas code, while keeping the structure minimal.

## Problem Statement

The current `client/index.html` works well but would benefit from:
- HMR for CSS changes (currently requires manual refresh)
- Type safety for AudioEngine, Visualizer, and WebSocket handling
- Separate files for the four major classes (~800 lines of class code)

## Proposed Solution

Minimal Vite + TypeScript setup:
- 6 source files (not 11) - only split where there's a natural boundary
- State and DOM helpers stay in `main.ts` - no unnecessary modules
- Merge spatial components (Visualizer, SourceOverlay, PositionManager)
- 3 implementation phases (not 7)

## Technical Approach

### Architecture (6 files)

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

### Module Dependency Graph

```
main.ts (entry)
    ├── ./styles/main.css
    ├── types.ts
    ├── config.ts
    ├── audio-engine.ts
    │   └── config.ts
    └── visualizer.ts
        └── types.ts
```

No circular dependencies. State lives in `main.ts` and is passed to classes via constructor/method parameters.

### Vite Configuration

```typescript
// client/vite.config.ts
import { defineConfig } from 'vite'

export default defineConfig({
  root: '.',
  server: {
    port: 5173,
    proxy: {
      '/ws': {
        target: 'ws://localhost:3334',
        ws: true,
        changeOrigin: true,
      },
      '/events': 'http://localhost:3334',
      '/sessions': 'http://localhost:3334',
      '/health': 'http://localhost:3334',
    },
  },
  build: {
    outDir: 'dist',
    emptyDirBeforeWrite: true,
  },
})
```

### TypeScript Configuration

```json
// client/tsconfig.json
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

## Implementation Phases

### Phase 1: Setup and CSS Extraction

**Tasks:**
- [x] Create `client/vite.config.ts` with proxy configuration
- [x] Create `client/tsconfig.json`
- [x] Update root `package.json` with scripts
- [x] Create `client/src/styles/main.css` - copy CSS from lines 7-570 exactly
- [x] Create stub `client/src/main.ts` that imports CSS
- [x] Verify Vite dev server starts and CSS renders correctly

```json
// package.json additions
{
  "devDependencies": {
    "vite": "^5.0.0",
    "typescript": "^5.3.0"
  },
  "scripts": {
    "dev:client": "cd client && vite",
    "build:client": "cd client && vite build"
  }
}
```

### Phase 2: Migrate All TypeScript

Move all JavaScript to TypeScript in one pass. The code is interdependent - there's no meaningful intermediate state.

**Tasks:**

- [x] Create `client/src/types.ts`

```typescript
// types.ts - match server types exactly
export interface BingbongEvent {
  event_type: string;
  tool_name: string;
  session_id: string;
  timestamp: string;
  machine_id?: string;
  cwd?: string;
  tool_input?: unknown;
  tool_result?: unknown;
}

export interface EnrichedEvent extends BingbongEvent {
  pan: number;
  session_index: number;
  color: string;
}

export interface Session {
  id: string;
  index: number;
  events: EnrichedEvent[];
  last_activity: string;
  position?: { x: number; y: number };
}

export interface SoundParams {
  frequency: number;
  duration: number;
  type: OscillatorType;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  reverb: number;
}
```

- [x] Create `client/src/config.ts`

```typescript
// config.ts - data only, no logic
import type { SoundParams } from './types'

export const SOUND_CONFIG: Record<string, SoundParams | Record<string, SoundParams>> = {
  // Extract from client/index.html lines 713-815
}

export const NOTE_FREQ: Record<string, number> = {
  // Extract from client/index.html lines 818-844
}
```

- [x] Create `client/src/audio-engine.ts`

```typescript
// audio-engine.ts - AudioEngine class only
import { SOUND_CONFIG, NOTE_FREQ } from './config'
import type { EnrichedEvent, SoundParams } from './types'

export class AudioEngine {
  private ctx: AudioContext | null = null
  private masterGain: GainNode | null = null
  private reverbGain: GainNode | null = null
  private convolver: ConvolverNode | null = null
  private panners = new Map<string, PannerNode>()

  // Extract from client/index.html lines 849-1097
}
```

- [x] Create `client/src/visualizer.ts` (merged: Visualizer + SourceOverlay + PositionManager)

```typescript
// visualizer.ts - all spatial/visual code in one file
import type { EnrichedEvent, Session } from './types'
import type { AudioEngine } from './audio-engine'

// PositionManager - localStorage persistence for positions
class PositionManager {
  private readonly STORAGE_KEY = 'bingbong-positions'
  // Extract from client/index.html lines 1102-1173
}

// SourceOverlay - draggable HTML elements over canvas
class SourceOverlay {
  private positionManager: PositionManager
  // Extract from client/index.html lines 1410-1619
}

// Visualizer - Canvas 2D rendering
export class Visualizer {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private sourceOverlay: SourceOverlay
  private particles: Particle[] = []

  // Fix: replace var(--font-mono) with literal font string
  private readonly FONT = "10px 'SF Mono', Monaco, Inconsolata, 'Roboto Mono', monospace"

  // Extract from client/index.html lines 1178-1405
}
```

- [x] Complete `client/src/main.ts`

```typescript
// main.ts - entry point with state, DOM, WebSocket, UI
import './styles/main.css'
import type { EnrichedEvent, Session } from './types'
import { AudioEngine } from './audio-engine'
import { Visualizer } from './visualizer'

// State - lives here, passed to classes as needed
const sessions = new Map<string, Session>()
const eventLog: EnrichedEvent[] = []
let ws: WebSocket | null = null
let audioEngine: AudioEngine | null = null
let visualizer: Visualizer | null = null

// DOM cache - populated once on DOMContentLoaded
const DOM = {
  status: null as HTMLElement | null,
  connectBtn: null as HTMLButtonElement | null,
  sessionList: null as HTMLElement | null,
  eventLog: null as HTMLElement | null,
  canvas: null as HTMLCanvasElement | null,
  // ... etc
}

// createElement helper - used only in updateUI()
function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Record<string, string>,
  ...children: (string | Node)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  if (attrs) Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v))
  children.forEach(c => el.append(c))
  return el
}

// WebSocket handlers - inline, not a separate module
function connect() {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
  ws = new WebSocket(`${protocol}://${location.host}/ws`)
  ws.onopen = () => { /* ... */ }
  ws.onmessage = (e) => handleEvent(JSON.parse(e.data))
  ws.onclose = () => { /* ... */ }
}

function handleEvent(event: EnrichedEvent) {
  // Update state, trigger audio/visual
}

function updateUI() {
  // Render session list, event log
}

// Init
document.addEventListener('DOMContentLoaded', () => {
  // Cache DOM elements
  DOM.status = document.getElementById('status')
  // ... etc

  // Create instances
  audioEngine = new AudioEngine()
  visualizer = new Visualizer(DOM.canvas!, audioEngine)

  // Wire up event listeners
  DOM.connectBtn?.addEventListener('click', connect)
})
```

### Phase 3: Server Update and Verify

**Tasks:**
- [x] Modify `src/server.ts` to serve static assets from `client/dist/`
- [x] Run production build: `bun run build:client`
- [x] Test all functionality in production mode
- [x] Archive original `client/index.html` as `client/index.html.bak`

```typescript
// src/server.ts additions
if (pathname.startsWith("/assets/")) {
  const assetPath = new URL(`../client/dist${pathname}`, import.meta.url).pathname
  const file = Bun.file(assetPath)
  if (await file.exists()) {
    return new Response(file, { headers: corsHeaders })
  }
}

if (pathname === "/") {
  const clientPath = new URL("../client/dist/index.html", import.meta.url).pathname
  // ...
}
```

## Acceptance Criteria

### Functional Requirements
- [ ] HMR works for CSS changes (hot injection)
- [ ] Audio playback works (user gesture required)
- [ ] Canvas visualization renders correctly
- [ ] WebSocket connects and receives events
- [ ] Spatial audio positioning works (drag sources)
- [ ] Position persistence works (localStorage)

### Non-Functional Requirements
- [ ] No visual regressions from CSS extraction
- [ ] TypeScript strict mode passes with no errors
- [ ] Production build generates valid assets

## Test Plan (5 flows)

| Flow | Steps | Expected |
|------|-------|----------|
| U1: Page Load | Navigate to localhost:5173 (dev) or :3334 (prod) | Radar grid renders, UI shows disconnected |
| U3: Events | Connect, send test event via POST /events | Sound plays, particle spawns, log updates |
| U4: Spatial | Drag source circle | 3D audio position changes |
| U8: Persistence | Position sources, reload page | Positions restored |
| U9: Mobile | Resize to <900px | Single column layout |

Note: U2 (Connect), U5 (Volume), U6 (Sessions), U7 (Reconnect) are covered by U3/U4 or are trivial.

## Risk Analysis

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Visual regression | Medium | High | Keep original CSS exactly; visual comparison |
| WebSocket proxy issues | Medium | High | Test proxy config in Phase 1 |
| Canvas font rendering | Low | Medium | Replace CSS var with literal font string |
| Type errors in migration | High | Low | Fix incrementally |

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| File count | 6 files (not 11) | Only split at natural boundaries |
| State location | In `main.ts` | No separate module for 6 variables |
| DOM helpers | In `main.ts` | Used in one place only |
| WebSocket code | In `main.ts` | 50 lines, not reusable |
| Spatial classes | Merged in `visualizer.ts` | Tightly coupled, same domain |
| Phases | 3 (not 7) | No meaningful intermediate states |

## References

### Internal References
- Brainstorm: `docs/brainstorms/2026-02-01-vite-migration-brainstorm.md`
- Current client: `client/index.html` (1965 lines)
- Server types: `src/server.ts` (match these exactly in types.ts)

### External References
- [Vite Configuration](https://vite.dev/config/)
- [Vite Proxy Configuration](https://vite.dev/config/server-options.html#server-proxy)
