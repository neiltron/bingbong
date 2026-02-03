---
title: "feat: Spatial Source Manager"
type: feat
date: 2026-02-03
brainstorm: docs/brainstorms/2026-02-03-spatial-source-manager-brainstorm.md
---

# Spatial Source Manager

Transform the current 1D stereo panning system into a 2D draggable spatial interface where each connected agent appears as a circle on a radar-like canvas, with position controlling 3D audio via Web Audio PannerNode.

## Overview

Replace the current particle-based visualizer with an interactive spatial field:
- **Radar canvas**: Concentric circles, axis lines, listener at center
- **Draggable HTML overlays**: Each session rendered as a positioned div
- **3D audio**: PannerNode with HRTF for true spatial positioning
- **Position memory**: localStorage persistence per session

Reference: `docs/stitch-design/screen.png`

## Problem Statement

Current system limitations:
1. **1D audio positioning**: StereoPannerNode only supports left/right panning
2. **No user control**: Pan values auto-assigned based on session index
3. **No position memory**: Refreshing loses spatial configuration
4. **Passive visualization**: Canvas only displays events, no interaction

## Proposed Solution

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Spatial Canvas Container (relative positioning)            │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  <canvas> - Radar Grid Layer                           │ │
│  │    • Concentric circles (distance zones)               │ │
│  │    • Axis lines (X/Y reference)                        │ │
│  │    • Listener indicator at center                      │ │
│  │    • Particles (existing system, spawn from sources)   │ │
│  └────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  HTML Overlay Layer (absolute positioning)             │ │
│  │    • Source circles (one per session)                  │ │
│  │    • Pointer event handling                            │ │
│  │    • Drag behavior                                     │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────┐
│  Position State Manager                                     │
│    • sourcePositions: Map<sessionKey, {x, y}>               │
│    • loadFromLocalStorage()                                 │
│    • saveToLocalStorage()                                   │
│    • autoAssignPosition()                                   │
└─────────────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────┐
│  Audio Engine (Modified)                                    │
│    • sessionPanners: Map<sessionKey, PannerNode>            │
│    • createPannerForSession()                               │
│    • updatePannerPosition(sessionKey, x, y)                 │
│    • Listener at origin (0, 0, 0)                           │
└─────────────────────────────────────────────────────────────┘
```

### Coordinate System

```
Canvas Normalized (0-1)          PannerNode 3D Space
        ┌─────┐                      Front (+Z)
    0,0 │     │ 1,0                      ▲
        │  ●  │ center=0.5,0.5      -X ◄─●─► +X
        │     │                          │
    0,1 └─────┘ 1,1                 Back (-Z)

Mapping:
  pannerX = (canvasNormX - 0.5) * 10  // -5 to +5
  pannerZ = (0.5 - canvasNormY) * 10  // -5 to +5 (Y inverted)
  pannerY = 0                          // flat plane
```

### Auto-Position Algorithm

New sources without saved positions use a spiral pattern:
```javascript
function autoAssignPosition(existingPositions, index) {
  if (index === 0) return { x: 0.5, y: 0.5 }; // First at center

  const ring = Math.ceil(Math.sqrt(index));
  const angle = (index * 137.5) * (Math.PI / 180); // Golden angle
  const radius = 0.15 + (ring * 0.1); // 15% to 45% from center

  return {
    x: 0.5 + Math.cos(angle) * radius,
    y: 0.5 + Math.sin(angle) * radius
  };
}
```

### localStorage Schema

```typescript
// Key format
`bingbong:position:${machine_id}:${session_id}`

// Value structure
interface StoredPosition {
  x: number;      // 0-1 normalized
  y: number;      // 0-1 normalized
  savedAt: string; // ISO timestamp
}
```

## Technical Approach

### Phase 1: Audio System Migration

Replace StereoPannerNode with PannerNode throughout the audio chain.

**Tasks:**

- [x] Add `sessionPanners` Map to AudioEngine to track PannerNode per session
- [x] Create `createPannerForSession(sessionKey)` method with HRTF config
- [x] Create `updatePannerPosition(sessionKey, normX, normY)` method
- [x] Modify `playSound()` to route through session's PannerNode instead of StereoPanner
- [x] Set AudioListener position at origin on init
- [ ] Test audio positioning with hardcoded positions before UI integration

**PannerNode Configuration:**
```javascript
// client/index.html - AudioEngine class
createPannerForSession(sessionKey) {
  const panner = this.ctx.createPanner();
  panner.panningModel = 'HRTF';
  panner.distanceModel = 'inverse';
  panner.refDistance = 1;
  panner.maxDistance = 10;
  panner.rolloffFactor = 1.5; // Dramatic falloff
  panner.coneInnerAngle = 360;
  panner.coneOuterAngle = 360;

  // Connect to dry/wet paths
  panner.connect(this.dryGain);
  panner.connect(this.convolver);

  this.sessionPanners.set(sessionKey, panner);
  return panner;
}

updatePannerPosition(sessionKey, normX, normY) {
  const panner = this.sessionPanners.get(sessionKey);
  if (!panner) return;

  // Convert normalized coords to 3D space
  const x = (normX - 0.5) * 10;  // -5 to +5
  const z = (0.5 - normY) * 10;  // -5 to +5 (inverted)

  panner.positionX.setValueAtTime(x, this.ctx.currentTime);
  panner.positionY.setValueAtTime(0, this.ctx.currentTime);
  panner.positionZ.setValueAtTime(z, this.ctx.currentTime);
}
```

### Phase 2: Position State Management

Add client-side position tracking with localStorage persistence.

**Tasks:**

- [x] Create `PositionManager` class/object to manage source positions
- [x] Implement `loadPositions()` to read all bingbong positions from localStorage
- [x] Implement `savePosition(sessionKey, x, y)` to persist single position
- [x] Implement `getPosition(sessionKey)` returning saved or auto-assigned position
- [x] Implement `clearPositions()` for reset functionality
- [x] Add position expiration cleanup (remove positions older than 30 days)

**PositionManager Implementation:**
```javascript
// client/index.html - new class
class PositionManager {
  constructor() {
    this.positions = new Map();
    this.loadFromStorage();
    this.cleanupStale();
  }

  storageKey(sessionKey) {
    return `bingbong:position:${sessionKey}`;
  }

  loadFromStorage() {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith('bingbong:position:')) {
        try {
          const data = JSON.parse(localStorage.getItem(key));
          const sessionKey = key.replace('bingbong:position:', '');
          this.positions.set(sessionKey, data);
        } catch (e) { /* ignore corrupt data */ }
      }
    }
  }

  savePosition(sessionKey, x, y) {
    const data = { x, y, savedAt: new Date().toISOString() };
    this.positions.set(sessionKey, data);
    localStorage.setItem(this.storageKey(sessionKey), JSON.stringify(data));
  }

  getPosition(sessionKey, index) {
    const saved = this.positions.get(sessionKey);
    if (saved) return { x: saved.x, y: saved.y };
    return this.autoAssign(index);
  }

  autoAssign(index) {
    if (index === 0) return { x: 0.5, y: 0.5 };
    const angle = (index * 137.5) * (Math.PI / 180);
    const radius = 0.15 + (Math.ceil(Math.sqrt(index)) * 0.1);
    return {
      x: Math.max(0.1, Math.min(0.9, 0.5 + Math.cos(angle) * radius)),
      y: Math.max(0.1, Math.min(0.9, 0.5 + Math.sin(angle) * radius))
    };
  }

  cleanupStale() {
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    for (const [key, data] of this.positions) {
      if (new Date(data.savedAt).getTime() < thirtyDaysAgo) {
        this.positions.delete(key);
        localStorage.removeItem(this.storageKey(key));
      }
    }
  }

  clearAll() {
    for (const key of this.positions.keys()) {
      localStorage.removeItem(this.storageKey(key));
    }
    this.positions.clear();
  }
}
```

### Phase 3: Canvas Radar Grid

Update Visualizer to render radar-style background instead of current stereo field.

**Tasks:**

- [x] Modify `drawStatic()` to render concentric circles (4 rings at 25%, 50%, 75%, 100% radius)
- [x] Add axis crosshair lines through center
- [x] Add listener indicator (white dot) at center
- [x] Remove old L/R labels and center divider line
- [ ] Add distance zone labels (optional: "Near", "Mid", "Far")
- [x] Ensure canvas maintains square aspect ratio within container

**Canvas Updates:**
```javascript
// client/index.html - Visualizer class
drawStatic() {
  // Use smaller dimension for square canvas area
  const size = Math.min(this.width, this.height);
  const centerX = this.width / 2;
  const centerY = this.height / 2;
  const maxRadius = size * 0.45; // Leave some padding

  // Background
  this.ctx.fillStyle = "var(--color-bg-base)";
  this.ctx.fillRect(0, 0, this.width, this.height);

  // Concentric circles
  this.ctx.strokeStyle = "rgba(42, 42, 58, 0.5)";
  this.ctx.lineWidth = 1;
  [0.25, 0.5, 0.75, 1].forEach(pct => {
    this.ctx.beginPath();
    this.ctx.arc(centerX, centerY, maxRadius * pct, 0, Math.PI * 2);
    this.ctx.stroke();
  });

  // Axis lines
  this.ctx.beginPath();
  this.ctx.moveTo(centerX - maxRadius, centerY);
  this.ctx.lineTo(centerX + maxRadius, centerY);
  this.ctx.moveTo(centerX, centerY - maxRadius);
  this.ctx.lineTo(centerX, centerY + maxRadius);
  this.ctx.stroke();

  // Listener indicator
  this.ctx.fillStyle = "#fff";
  this.ctx.beginPath();
  this.ctx.arc(centerX, centerY, 6, 0, Math.PI * 2);
  this.ctx.fill();

  // Listener label
  this.ctx.fillStyle = "var(--color-text-muted)";
  this.ctx.font = "10px var(--font-mono)";
  this.ctx.textAlign = "center";
  this.ctx.fillText("LISTENER", centerX, centerY + 20);
}
```

### Phase 4: HTML Source Overlays

Create draggable HTML elements for each session, positioned over the canvas.

**Tasks:**

- [x] Create container div with `position: relative` wrapping canvas
- [x] Create `SourceOverlay` class to manage source circle elements
- [x] Implement `createSourceElement(session)` returning styled div
- [x] Implement `updateSourcePosition(sessionKey, x, y)` to move div
- [x] Implement `removeSource(sessionKey)` with fade-out animation
- [x] Add CSS for source states: default, hover, selected, dragging
- [x] Wire up session events to create/update/remove source overlays

**Source Element Structure:**
```html
<div class="source-circle" data-session="machine:session" style="left: 50%; top: 50%;">
  <div class="source-icon">●</div>
  <div class="source-label">Agent-01</div>
</div>
```

**CSS Styles:**
```css
/* client/index.html - add to styles */
.spatial-container {
  position: relative;
  width: 100%;
  height: 100%;
}

.source-circle {
  position: absolute;
  transform: translate(-50%, -50%);
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: var(--color-bg-elevated);
  border: 2px solid var(--session-color, var(--color-border));
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  cursor: grab;
  user-select: none;
  transition: box-shadow 0.2s, transform 0.1s;
  z-index: 10;
}

.source-circle:hover {
  box-shadow: 0 0 15px color-mix(in srgb, var(--session-color) 50%, transparent);
}

.source-circle.selected {
  border-width: 3px;
  box-shadow: 0 0 20px color-mix(in srgb, var(--session-color) 70%, transparent);
}

.source-circle.dragging {
  cursor: grabbing;
  transform: translate(-50%, -50%) scale(1.05);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
  z-index: 100;
}

.source-circle.disconnected {
  opacity: 0.5;
  border-style: dashed;
  filter: grayscale(0.7);
}

.source-icon {
  font-size: 16px;
  color: var(--session-color);
}

.source-label {
  font-size: 9px;
  color: var(--color-text-secondary);
  margin-top: 2px;
  white-space: nowrap;
  max-width: 50px;
  overflow: hidden;
  text-overflow: ellipsis;
}
```

### Phase 5: Drag Interaction

Implement pointer-based drag behavior for source repositioning.

**Tasks:**

- [x] Add pointerdown listener to source circles
- [x] Track drag state: `isDragging`, `dragTarget`, `dragOffset`
- [x] Add pointermove listener (on document) for drag updates
- [x] Add pointerup listener (on document) to end drag
- [x] Constrain drag to canvas bounds (with padding)
- [x] Update PannerNode position during drag (real-time audio feedback)
- [x] Save position to localStorage on drag end
- [x] Add touch support via pointer events (works automatically)

**Drag Implementation:**
```javascript
// client/index.html - SourceOverlay class
class SourceOverlay {
  constructor(container, canvas, positionManager, audioEngine) {
    this.container = container;
    this.canvas = canvas;
    this.positionManager = positionManager;
    this.audioEngine = audioEngine;
    this.sources = new Map();
    this.selectedKey = null;
    this.dragState = null;

    // Global listeners for drag
    document.addEventListener('pointermove', (e) => this.onPointerMove(e));
    document.addEventListener('pointerup', (e) => this.onPointerUp(e));
  }

  createSource(session) {
    const key = `${session.machine_id}:${session.session_id}`;
    const pos = this.positionManager.getPosition(key, session.index || 0);

    const el = document.createElement('div');
    el.className = 'source-circle';
    el.dataset.session = key;
    el.style.setProperty('--session-color', session.color);
    el.innerHTML = `
      <div class="source-icon">●</div>
      <div class="source-label">${session.session_id.slice(0, 8)}</div>
    `;

    this.setElementPosition(el, pos.x, pos.y);

    el.addEventListener('pointerdown', (e) => this.onPointerDown(e, key));
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      this.select(key);
    });

    this.container.appendChild(el);
    this.sources.set(key, { el, pos });

    // Update audio
    this.audioEngine.updatePannerPosition(key, pos.x, pos.y);
  }

  setElementPosition(el, normX, normY) {
    const rect = this.canvas.getBoundingClientRect();
    const size = Math.min(rect.width, rect.height);
    const offsetX = (rect.width - size) / 2;
    const offsetY = (rect.height - size) / 2;

    el.style.left = `${offsetX + normX * size}px`;
    el.style.top = `${offsetY + normY * size}px`;
  }

  onPointerDown(e, key) {
    e.preventDefault();
    const source = this.sources.get(key);
    if (!source) return;

    source.el.classList.add('dragging');
    source.el.setPointerCapture(e.pointerId);

    this.dragState = {
      key,
      startX: e.clientX,
      startY: e.clientY,
      startPos: { ...source.pos }
    };
  }

  onPointerMove(e) {
    if (!this.dragState) return;

    const rect = this.canvas.getBoundingClientRect();
    const size = Math.min(rect.width, rect.height);
    const offsetX = (rect.width - size) / 2;
    const offsetY = (rect.height - size) / 2;

    // Calculate new normalized position
    const canvasX = e.clientX - rect.left - offsetX;
    const canvasY = e.clientY - rect.top - offsetY;

    let normX = canvasX / size;
    let normY = canvasY / size;

    // Clamp to bounds with padding
    normX = Math.max(0.05, Math.min(0.95, normX));
    normY = Math.max(0.05, Math.min(0.95, normY));

    const source = this.sources.get(this.dragState.key);
    if (source) {
      source.pos = { x: normX, y: normY };
      this.setElementPosition(source.el, normX, normY);
      this.audioEngine.updatePannerPosition(this.dragState.key, normX, normY);
    }
  }

  onPointerUp(e) {
    if (!this.dragState) return;

    const source = this.sources.get(this.dragState.key);
    if (source) {
      source.el.classList.remove('dragging');
      this.positionManager.savePosition(this.dragState.key, source.pos.x, source.pos.y);
    }

    this.dragState = null;
  }

  select(key) {
    // Deselect previous
    if (this.selectedKey) {
      const prev = this.sources.get(this.selectedKey);
      prev?.el.classList.remove('selected');
    }

    // Select new
    this.selectedKey = key;
    const source = this.sources.get(key);
    source?.el.classList.add('selected');
  }

  removeSource(key) {
    const source = this.sources.get(key);
    if (!source) return;

    source.el.classList.add('disconnected');
    setTimeout(() => {
      source.el.remove();
      this.sources.delete(key);
    }, 1000);
  }
}
```

### Phase 6: Integration & Polish

Wire everything together and add finishing touches.

**Tasks:**

- [x] Initialize PositionManager, update AudioEngine, create SourceOverlay on page load
- [x] Update `handleEvent()` to create/update sources via SourceOverlay
- [x] Update WebSocket `init` handler to create sources for existing sessions
- [ ] Handle session disconnect events (call `removeSource`)
- [x] Update particle spawn location to use source positions
- [x] Add "Reset Layout" button to sidebar controls
- [ ] Add keyboard support: Tab to cycle, Arrow keys to move selected
- [ ] Test with multiple concurrent sessions
- [ ] Test localStorage persistence across browser refresh
- [ ] Test on mobile/touch devices

**Particle Integration:**
```javascript
// Modify Visualizer.addParticle to accept position from source
addParticle(event, sessionKey) {
  const source = this.sourceOverlay?.sources.get(sessionKey);
  let x, y;

  if (source) {
    // Spawn from source position
    const rect = this.canvas.getBoundingClientRect();
    const size = Math.min(rect.width, rect.height);
    x = (rect.width - size) / 2 + source.pos.x * size;
    y = (rect.height - size) / 2 + source.pos.y * size;
  } else {
    // Fallback to center
    x = this.width / 2;
    y = this.height / 2;
  }

  // ... rest of particle creation with x, y
}
```

## Acceptance Criteria

### Functional Requirements

- [ ] Canvas displays radar grid with concentric circles and axis lines
- [ ] Listener indicator visible at center
- [ ] Each connected session appears as a draggable circle
- [ ] Source circles show session color and truncated ID
- [ ] Dragging a source updates its position in real-time
- [ ] Audio positioning changes as source is dragged (audible difference)
- [ ] Source positions persist across browser refresh
- [ ] New sessions auto-position using spiral algorithm
- [ ] Returning sessions restore their saved position
- [ ] Disconnected sessions fade out and are removed

### Non-Functional Requirements

- [ ] Drag interaction feels smooth (no visible lag)
- [ ] Touch drag works on mobile devices
- [ ] Canvas renders at 60fps during particle animation
- [ ] localStorage usage stays under 100KB for typical usage

### Quality Gates

- [ ] Manual testing with 5+ concurrent sessions
- [ ] Test position persistence: place source, refresh, verify position
- [ ] Test auto-position: clear localStorage, connect sessions, verify spread
- [ ] Test audio: close eyes, identify source position by sound alone

## Dependencies

- Web Audio API PannerNode support (all modern browsers)
- Pointer Events API (all modern browsers)
- localStorage API (all browsers)

## Risk Analysis

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| HRTF not supported on some browsers | Low | Medium | Fallback to 'equalpower' panning model |
| localStorage quota exceeded | Very Low | Low | Cleanup stale positions, limit stored sessions |
| Touch drag conflicts with scroll | Medium | Medium | Use `touch-action: none` on container |
| Performance with many sources | Low | Medium | Virtualize sources if >20, batch DOM updates |

## References

### Internal

- Brainstorm: `docs/brainstorms/2026-02-03-spatial-source-manager-brainstorm.md`
- Design mockup: `docs/stitch-design/screen.png`
- Design code: `docs/stitch-design/code.html`
- Current audio engine: `client/index.html:761-938`
- Current visualizer: `client/index.html:943-1157`

### External

- [Web Audio PannerNode](https://developer.mozilla.org/en-US/docs/Web/API/PannerNode)
- [Pointer Events API](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events)
- [HRTF Spatialization](https://webaudio.github.io/web-audio-api/#Spatialization)
