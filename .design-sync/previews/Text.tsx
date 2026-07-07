import { Text, Theme } from '@bingbong/design-system';

export const TypeScale = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 520 }}>
    <Text variant="display">Soundscapes for coding agents</Text>
    <Text variant="heading">Session activity</Text>
    <Text variant="subheading">Spatial audio monitoring</Text>
    <Text variant="body">
      Each connected agent becomes a sound source in the stereo field. Tool calls trigger
      one-shot samples; long-running work sustains an ambient layer.
    </Text>
    <Text variant="caption">Last event 4 seconds ago via WebSocket.</Text>
    <Text variant="label">Master volume</Text>
  </div>
);

export const OnDark = () => (
  <Theme mode="dark" style={{ padding: 24 }}>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 520 }}>
      <Text variant="heading">Session activity</Text>
      <Text variant="body">
        Each connected agent becomes a sound source in the stereo field.
      </Text>
      <Text variant="label">Master volume</Text>
    </div>
  </Theme>
);
