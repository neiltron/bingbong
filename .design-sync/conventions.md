# Bingbong design system — conventions

Bingbong is a soundscape monitor for coding agents. Its look is the "Ink + Gold" palette: cream (`#F6EFDF`) paper, warm brown-black ink (`#201A12`), gold (`#E8A832`) as the action color, rose accents — no teal or green; **Geist Mono** for all interface text, **Inter** only for display/heading type. Warm, rounded (8–16px radii), 2px solid borders. (Legacy token names survive the recolor: `--color-teal` now holds ink in light / olive-gold in dark, `--color-deep-teal` the dark ink base.)

## Setup

No provider is required — components work bare once `styles.css` is loaded. For dark UI, wrap any subtree in `<Theme mode="dark">` (it sets `data-theme` and paints the deep-teal base background); `<Theme mode="light">` scopes cream. Never hand-set `data-theme` attributes — use `Theme`.

## Styling idiom

Tokens are CSS custom properties; style your own layout glue with `var(--*)` (inline styles or your own classes), never hard-coded colors:

- Color: `--color-bg-base`, `--color-bg-surface`, `--color-bg-elevated`, `--color-bg-accent`, `--color-text-primary`, `--color-text-secondary`, `--color-text-muted`, `--color-border`, `--color-border-subtle`, `--color-success`, `--color-error`; raw palette `--color-teal`, `--color-marigold`, `--color-rose`, `--color-cream`, `--color-sand`
- Space: `--space-xs` (8) `--space-sm` (12) `--space-md` (16) `--space-lg` (20) `--space-xl` (24) `--space-2xl` (32) `--space-3xl` (48)
- Radius: `--radius-sm` (6) `--radius-md` (8) `--radius-lg` (12) `--radius-xl` (16) `--radius-full`
- Font: `--font-display` (Inter), `--font-interface` (Geist Mono)
- Motion: `--transition-fast`, `--transition-base`, `--transition-slow`

Utility classes exist for type and color only (no spacing/layout utilities): `text-display`, `text-heading`, `text-subheading`, `text-body`, `text-caption`, `text-label` (or use the `Text` component); `bg-teal`, `bg-marigold`, `bg-rose`, `bg-cream`, `bg-sand`; `text-teal`, `text-marigold`, `text-rose`, `text-cream`; `border-teal`, `border-marigold`, `border-rose`.

Semantic tokens flip automatically under `Theme mode="dark"` — prefer them over raw palette values so dark mode works for free.

## Components

`Button` (variant: primary | accent | outline; size: medium | small — small for headers/toolbars/modal chrome), `Panel` (variant: default | accent | inverted; `title` prop for the uppercase label), `Text` (variant: display…label), `AgentSession` (name/meta/indicatorColor; density: default | compact — compact is a fluid pill for narrow rails), `SourceNode` (status: default | active | idle | disconnected), `ToolEvent` (badge/name/agent/time), `Theme`. Each component's `.prompt.md` and `.d.ts` are the API truth; read `styles.css` for the full token set.

## Idiomatic example

```tsx
<Theme mode="dark" style={{ padding: 'var(--space-xl)' }}>
  <Text variant="heading">Session activity</Text>
  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
    <ToolEvent badge="tool" name="Bash" agent="claude-code" time="12:04:41" />
    <ToolEvent badge="hook" name="PostToolUse" agent="cursor" time="12:04:35" />
  </div>
  <Panel title="Connection">
    ws://localhost:4820 — connected
    <Button variant="accent">Play soundscape</Button>
  </Panel>
</Theme>
```
