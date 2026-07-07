import { Panel, Theme, Button } from '@bingbong/design-system';

export const Default = () => (
  <Panel title="Now playing" style={{ maxWidth: 360 }}>
    Forest ambience — 3 sources active, 2 idle. Master volume 80%.
  </Panel>
);

export const Accent = () => (
  <Panel variant="accent" title="Session summary" style={{ maxWidth: 360 }}>
    claude-code ran 42 tool calls across 3 sessions in the last hour.
  </Panel>
);

export const WithActions = () => (
  <Panel title="Connection" style={{ maxWidth: 360 }}>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <span>ws://localhost:4820 — disconnected</span>
      <div style={{ display: 'flex', gap: 12 }}>
        <Button variant="primary">Reconnect</Button>
        <Button variant="outline">Settings</Button>
      </div>
    </div>
  </Panel>
);

export const OnDark = () => (
  <Theme mode="dark" style={{ display: 'flex', gap: 16, padding: 24 }}>
    <Panel title="Now playing" style={{ maxWidth: 300 }}>
      Forest ambience — 3 sources active.
    </Panel>
    <Panel variant="inverted" title="Tip" style={{ maxWidth: 300 }}>
      Drag source nodes to position them in the stereo field.
    </Panel>
  </Theme>
);
