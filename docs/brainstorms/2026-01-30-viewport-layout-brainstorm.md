# Viewport-Height Layout for Canvas and Sidebar

**Date:** 2026-01-30
**Status:** Ready for planning

## What We're Building

A viewport-filling layout where:
- The canvas and sidebar fill the entire screen height (minus header)
- Controls panel takes its natural height
- Active Sessions and Event Log panels split remaining sidebar height equally
- Each scrollable panel (Sessions, Event Log) scrolls its own content independently
- The canvas height matches the sidebar height (they grow together)

## Why This Approach

**Flexbox with 100vh** was chosen because:
- It's the standard pattern for dashboard-style layouts
- Simpler CSS than a full grid solution
- Native browser resize handling without JavaScript
- Easy to maintain and understand

## Current State

The current layout has these issues:
- Canvas has a fixed height of `400px` via `--visualizer-height`
- Event log has `max-height: 300px` which limits its growth
- When sidebar panels grow, the canvas container grows but the canvas doesn't fill it
- Layout doesn't utilize full viewport height

## Key Decisions

1. **Layout strategy**: Flexbox with `100vh` (or `100dvh` for mobile)
2. **Scroll behavior**: Individual panels scroll their own content; overall layout is fixed to viewport
3. **Panel distribution**: Controls = natural height, Sessions and Event Log = equal share of remaining space (`flex: 1` each)
4. **Canvas sizing**: Fills full height of its container (remove fixed `--visualizer-height`)

## Implementation Outline

1. Set `body` or container to `height: 100vh` with `display: flex; flex-direction: column`
2. Header takes natural height
3. `.main-grid` gets `flex: 1` and `min-height: 0` (critical for nested flex scroll)
4. `.visualizer-section` fills its grid cell with `height: 100%`
5. Canvas element fills section with `height: 100%` (remove fixed height)
6. Sidebar becomes `display: flex; flex-direction: column; height: 100%`
7. Controls panel: natural height
8. Sessions and Event Log panels: `flex: 1; min-height: 0; overflow-y: auto`

## Open Questions

None - requirements are clear.

## Files to Modify

- `client/index.html` (CSS styles section)
- Possibly update JavaScript canvas resize logic to handle dynamic height
