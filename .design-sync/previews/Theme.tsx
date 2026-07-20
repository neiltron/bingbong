import { Theme, Panel, Button, Text } from '@bingbong/design-system';

const Sample = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 24, minWidth: 280 }}>
    <Text variant="subheading">Now playing</Text>
    <Panel title="Session">Forest ambience — 3 sources active.</Panel>
    <div style={{ display: 'flex', gap: 12 }}>
      <Button variant="primary">Connect</Button>
      <Button variant="outline">Mute</Button>
    </div>
  </div>
);

export const LightAndDark = () => (
  <div style={{ display: 'flex' }}>
    <Theme mode="light">
      <Sample />
    </Theme>
    <Theme mode="dark">
      <Sample />
    </Theme>
  </div>
);
