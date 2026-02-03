# Spatial Source Manager Brainstorm

**Date:** 2026-02-03
**Status:** Ready for planning

## What We're Building

A draggable spatial source manager where each connected agent appears as a circle on a radar-like canvas. Users can drag sources in 2D space to control their position in the 3D audio field. The listener sits at center with concentric circles indicating distance zones.

### Core Behaviors

- **Draggable source circles**: Each session/agent gets a circle that can be dragged freely on the canvas
- **3D audio via PannerNode**: Position maps to Web Audio PannerNode (X for left/right, Y for front/back)
- **Dramatic distance falloff**: Sources further from center sound quieter and more reverberant (intimate room feel)
- **Position memory**: localStorage stores positions keyed by session identifier; returning agents appear where you last put them
- **Auto-assign on first entrance**: New agents get automatically placed, then user can adjust

### Visual Design

- Minimal source circles: icon + session name only (no status badges or activity visualizers)
- Radar-style background: concentric circles, axis lines, center listener indicator
- Selection: clicking a source highlights it visually (no mixer panel opens)

Reference: `docs/stitch-design/screen.png` and `docs/stitch-design/code.html`

## Why This Approach

**HTML overlay on canvas** - Keep canvas for the radar grid and particle effects, use absolutely-positioned HTML divs for the draggable source circles.

### Rationale

1. **Native drag handling**: HTML elements get pointer events, drag-and-drop, and touch support without manual hit-testing
2. **Accessibility**: Draggable divs can be keyboard-focusable and work with screen readers
3. **CSS flexibility**: Styling states (hover, active, selected) with CSS is simpler than canvas drawing logic
4. **Separation of concerns**: Canvas handles atmospheric visuals (grid, particles), HTML handles interactive elements
5. **Coordinate sync**: Both layers share the same parent container, making position mapping straightforward

### Trade-offs Accepted

- Mixed rendering paradigms (canvas + HTML)
- Need to translate between CSS coordinates and canvas/audio coordinates
- Slightly less "integrated" feel than pure canvas

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Audio spatialization | Web Audio PannerNode (3D) | Full spatial positioning, not just stereo pan |
| Distance model | Dramatic falloff | Creates intimate, position-sensitive soundscape |
| Initial positioning | Auto-assign + remember | Good defaults, user customization persists |
| Position storage | localStorage | Browser-local, no server changes needed |
| Source circle content | Minimal (icon + name) | Clean visual, avoid clutter |
| Selection behavior | Highlight only | Keep UI simple, no panel switching |
| Rendering approach | HTML overlay on canvas | Best balance of interactivity and visual effects |

## Open Questions

1. **Session identifier for localStorage key**: Use `machine_id:session_id` (current) or add a user-definable label?
2. **Coordinate mapping**: Should canvas be square (1:1 aspect) or fill available space?
3. **Particle integration**: Do particles still emanate from source positions, or from center?
4. **Multi-select**: Should users be able to select/move multiple sources at once?
5. **Reset positions**: Should there be a "reset to auto" button?

## Technical Notes

### Current State

- Audio: Web Audio API with stereo `StereoPannerNode`, reverb via convolver
- Visualization: Canvas-based `Visualizer` class with particle system
- Sessions: Tracked server-side, broadcast via WebSocket with `pan` value (-1 to +1)

### Migration Path

1. Replace `StereoPannerNode` with `PannerNode` for each session's audio chain
2. Add source position state to client (object mapping session key → {x, y})
3. Render HTML overlay divs for each active session
4. Wire up drag events to update position state and PannerNode
5. Persist positions to localStorage on change
6. Load positions from localStorage on session init

### PannerNode Configuration

```javascript
panner.panningModel = 'HRTF';  // or 'equalpower' for simpler
panner.distanceModel = 'inverse';  // dramatic falloff
panner.refDistance = 1;
panner.maxDistance = 10;
panner.rolloffFactor = 1;
panner.coneInnerAngle = 360;
panner.coneOuterAngle = 360;
```

## Next Steps

Run `/workflows:plan` to create implementation plan with specific tasks.
