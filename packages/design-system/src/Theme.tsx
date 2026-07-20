import type { HTMLAttributes } from 'react';

export interface ThemeProps extends HTMLAttributes<HTMLDivElement> {
  /** Color scheme; sets `data-theme` so all descendant components re-token. */
  mode?: 'light' | 'dark';
}

/**
 * Theme scope. Wrap a subtree to switch it between the light (cream) and
 * dark (deep teal) themes; paints the theme's base background and text color.
 */
export function Theme({ mode = 'light', style, ...rest }: ThemeProps) {
  return (
    <div
      data-theme={mode}
      style={{
        background: 'var(--color-bg-base)',
        color: 'var(--color-text-primary)',
        ...style,
      }}
      {...rest}
    />
  );
}
