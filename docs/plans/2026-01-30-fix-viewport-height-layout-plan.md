---
title: Fix Viewport-Height Layout for Canvas and Sidebar
type: fix
date: 2026-01-30
---

# Fix Viewport-Height Layout for Canvas and Sidebar

## Overview

The current layout has a fixed-height canvas (400px) that doesn't fill available viewport space. When sidebar panels (Active Sessions, Event Log) grow with content, the canvas container grows but the canvas itself stays fixed. This wastes screen real estate and creates an inconsistent experience.

## Problem Statement

Current issues in `client/index.html`:
- Canvas has fixed `--visualizer-height: 400px` (CSS) and `this.height = 400` (JS)
- Event Log capped at `max-height: 300px`
- Sessions list has no overflow handling - pushes content down
- Body uses `min-height: 100vh` allowing page scroll instead of viewport-locked layout
- No mobile viewport handling (`100vh` breaks on iOS/Android address bar changes)

## Proposed Solution

Convert to a flexbox-based viewport-filling layout:
- Body/container fills exactly `100dvh` (dynamic viewport height)
- Header takes natural height
- Main grid fills remaining space with `flex: 1`
- Canvas fills its container height dynamically
- Sidebar panels distribute height: Controls (natural) + Sessions/Events (split remaining equally)
- Each scrollable panel handles its own overflow

## Technical Approach

### CSS Changes (client/index.html)

#### 1. Root Layout Structure

```css
/* Remove --visualizer-height variable (or keep for min-height fallback) */

html, body {
    height: 100dvh; /* Dynamic viewport height for mobile */
    overflow: hidden; /* Prevent page scroll */
}

body {
    display: flex;
    flex-direction: column;
}

.container {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0; /* Critical: allows flex children to shrink */
}
```

#### 2. Main Grid

```css
.main-grid {
    flex: 1;
    display: grid;
    grid-template-columns: 1fr var(--sidebar-width);
    gap: var(--space-lg);
    min-height: 0; /* Critical for nested flex/grid scroll */
}
```

#### 3. Visualizer Section

```css
.visualizer-section {
    display: flex;
    flex-direction: column;
    min-height: 0;
    /* Remove any fixed height */
}

#visualizer {
    flex: 1;
    width: 100%;
    min-height: 200px; /* Minimum usable height */
    /* Remove: height: var(--visualizer-height) */
}
```

#### 4. Sidebar Layout

```css
.sidebar {
    display: flex;
    flex-direction: column;
    gap: var(--space-lg);
    min-height: 0;
    height: 100%; /* Fill grid cell */
}

/* Controls: natural height */
.panel:first-child {
    flex-shrink: 0;
}

/* Sessions and Event Log: split remaining space */
.panel:nth-child(2),
.panel:nth-child(3) {
    flex: 1;
    min-height: 120px;
    display: flex;
    flex-direction: column;
}

.sessions-list,
.event-log {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
    /* Remove: max-height: 300px from .event-log */
}
```

#### 5. Mobile Breakpoint

```css
@media (max-width: 900px) {
    html, body {
        height: auto;
        overflow: auto; /* Allow page scroll on mobile */
    }

    .main-grid {
        grid-template-columns: 1fr;
        min-height: auto;
    }

    #visualizer {
        height: 300px; /* Fixed height on mobile */
        flex: none;
    }

    .sidebar {
        height: auto;
    }

    .sessions-list,
    .event-log {
        max-height: 250px; /* Cap panel heights on mobile */
    }
}
```

### JavaScript Changes (client/index.html)

Update the Visualizer class to handle dynamic height:

```javascript
// In resize() method, replace fixed height with actual rendered height
resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.width = rect.width;
    this.height = rect.height; // Was: this.height = 400
    this.dpr = window.devicePixelRatio || 1;

    this.canvas.width = this.width * this.dpr;
    this.canvas.height = this.height * this.dpr;
    this.ctx.scale(this.dpr, this.dpr);

    this.drawStatic();
}

// In constructor, remove hardcoded height
constructor(canvas) {
    // ...existing code...
    // Remove: this.height = 400
    // Let resize() set the actual height
}
```

## Acceptance Criteria

- [ ] Canvas fills available viewport height (minus header and container padding)
- [ ] Sidebar height matches canvas height
- [ ] Controls panel takes its natural height
- [ ] Sessions and Event Log panels split remaining sidebar space equally
- [ ] Sessions list scrolls internally when content overflows
- [ ] Event Log scrolls internally when content overflows
- [ ] Page does not scroll on desktop (layout locked to viewport)
- [ ] Layout adapts on browser resize without breaking
- [ ] Mobile layout allows page scroll with fixed-height canvas
- [ ] No JavaScript errors on resize

## Files to Modify

| File | Changes |
|------|---------|
| `client/index.html` | CSS: body, container, main-grid, visualizer-section, sidebar, panel styles |
| `client/index.html` | JS: Visualizer.resize() to use dynamic height |

## Implementation Checklist

1. [x] Update `:root` - consider removing `--visualizer-height` or keeping as min-height
2. [x] Add `height: 100dvh; overflow: hidden` to html/body
3. [x] Make body a flex column
4. [x] Add `flex: 1; min-height: 0` to .container
5. [x] Add `flex: 1; min-height: 0` to .main-grid
6. [x] Update .visualizer-section to flex column
7. [x] Remove fixed height from #visualizer, add `flex: 1; min-height: 200px`
8. [x] Update .sidebar to `height: 100%`
9. [x] Add `flex: 1; min-height: 120px` to Sessions and Event Log panels
10. [x] Add `overflow-y: auto` to .sessions-list
11. [x] Remove `max-height: 300px` from .event-log
12. [x] Update mobile breakpoint for page scroll
13. [x] Update JS: Visualizer.resize() to read actual height from getBoundingClientRect()
14. [x] Remove hardcoded `this.height = 400` from Visualizer constructor
15. [ ] Test with 0, 5, 20 sessions
16. [ ] Test with 0, 50, 200 events
17. [ ] Test browser resize
18. [ ] Test mobile viewport (address bar toggle)

## Edge Cases Addressed

- **Zero content**: Empty states maintain 50/50 split with min-heights
- **Many sessions**: Sessions list scrolls at ~6+ items
- **Many events**: Event log scrolls independently
- **Very short viewport**: min-height prevents panels from collapsing below usable size
- **Mobile address bar**: `100dvh` handles dynamic viewport changes
- **Single-column mobile**: Allows page scroll, caps panel heights

## References

- Brainstorm: `docs/brainstorms/2026-01-30-viewport-layout-brainstorm.md`
- MDN: [Dynamic viewport units](https://developer.mozilla.org/en-US/docs/Web/CSS/length#dynamic_viewport_units)
- CSS-Tricks: [Nested Flex Scroll](https://css-tricks.com/flexbox-truncated-text/)
