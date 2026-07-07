# @bingbong/design-system

React components wrapping the bingbong design system's CSS classes. The CSS
source of truth stays in `apps/client/src/styles/design-system.css`; the build
copies it into `dist/` so the package is self-contained.

```tsx
import { Theme, Panel, Button } from '@bingbong/design-system';
import '@bingbong/design-system/styles.css';

<Theme mode="dark">
  <Panel title="Session" variant="default">
    <Button variant="accent">Reconnect</Button>
  </Panel>
</Theme>
```

Build: `bun run --cwd packages/design-system build` (tsc + CSS copy → `dist/`).
