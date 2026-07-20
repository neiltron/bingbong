import { AgentSession, Theme } from '@bingbong/design-system';

export const Default = () => (
  <AgentSession name="claude-code" meta="~/projects/bingbong" />
);

export const IndicatorColors = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
    <AgentSession name="claude-code" meta="~/projects/bingbong" indicatorColor="teal" />
    <AgentSession name="cursor" meta="~/projects/webapp" indicatorColor="marigold" />
    <AgentSession name="codex" meta="~/projects/api — 12m idle" indicatorColor="rose" />
  </div>
);

export const OnDark = () => (
  <Theme mode="dark" style={{ padding: 24 }}>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <AgentSession name="claude-code" meta="~/projects/bingbong" indicatorColor="marigold" />
      <AgentSession name="cursor" meta="~/projects/webapp — 3m idle" indicatorColor="rose" />
    </div>
  </Theme>
);

export const CompactRail = () => (
  <Theme mode="dark" style={{ padding: 24 }}>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: 218 }}>
      <AgentSession density="compact" name="bingbong" meta="~/projects/bingbong · 14 calls" indicatorColor="marigold" />
      <AgentSession density="compact" name="webapp" meta="~/projects/webapp · 6 calls" indicatorColor="rose" />
      <AgentSession density="compact" name="api" meta="~/projects/api · 2 calls" indicatorColor="teal" />
    </div>
  </Theme>
);
