import { ToolEvent, Theme } from '@bingbong/design-system';

export const Default = () => (
  <div style={{ maxWidth: 420 }}>
    <ToolEvent badge="tool" name="Read" agent="claude-code" time="12:04:33" />
  </div>
);

export const Feed = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 420 }}>
    <ToolEvent badge="tool" name="Bash" agent="claude-code" time="12:04:41" />
    <ToolEvent badge="tool" name="Edit" agent="claude-code" time="12:04:38" />
    <ToolEvent badge="hook" name="PostToolUse" agent="cursor" time="12:04:35" />
    <ToolEvent badge="tool" name="Read" agent="claude-code" time="12:04:33" />
  </div>
);

export const OnDark = () => (
  <Theme mode="dark" style={{ padding: 24 }}>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 420 }}>
      <ToolEvent badge="tool" name="Bash" agent="claude-code" time="12:04:41" />
      <ToolEvent badge="hook" name="PostToolUse" agent="cursor" time="12:04:35" />
    </div>
  </Theme>
);
