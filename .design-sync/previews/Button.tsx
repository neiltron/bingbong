import { Button, Theme } from '@bingbong/design-system';

export const Variants = () => (
  <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
    <Button variant="primary">Connect</Button>
    <Button variant="accent">Play soundscape</Button>
    <Button variant="outline">Mute all</Button>
  </div>
);

export const Small = () => (
  <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
    <Button variant="primary" size="small">Connect</Button>
    <Button variant="accent" size="small">Play soundscape</Button>
    <Button variant="outline" size="small">Mute</Button>
  </div>
);

export const Disabled = () => (
  <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
    <Button variant="primary" disabled>
      Connect
    </Button>
    <Button variant="outline" disabled>
      Mute all
    </Button>
  </div>
);

export const OnDark = () => (
  <Theme mode="dark" style={{ display: 'flex', gap: 16, alignItems: 'center', padding: 24 }}>
    <Button variant="primary">Connect</Button>
    <Button variant="accent">Play soundscape</Button>
    <Button variant="outline">Mute all</Button>
  </Theme>
);
