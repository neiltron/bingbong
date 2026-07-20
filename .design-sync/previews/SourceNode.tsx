import { SourceNode, Theme } from '@bingbong/design-system';

export const States = () => (
  <div style={{ display: 'flex', gap: 20, alignItems: 'center', padding: 8 }}>
    <SourceNode status="default" icon="C" label="claude" />
    <SourceNode status="active" icon="C" label="claude" />
    <SourceNode status="idle" icon="X" label="cursor" />
    <SourceNode status="disconnected" icon="D" label="codex" />
  </div>
);

export const OnDark = () => (
  <Theme mode="dark" style={{ display: 'flex', gap: 20, alignItems: 'center', padding: 24 }}>
    <SourceNode status="default" icon="C" label="claude" />
    <SourceNode status="active" icon="C" label="claude" />
    <SourceNode status="idle" icon="X" label="cursor" />
    <SourceNode status="disconnected" icon="D" label="codex" />
  </Theme>
);
