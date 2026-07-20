import type { HTMLAttributes } from 'react';
import { cx } from './cx';

export interface PanelProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * 'default' is a surface card with a border; 'accent' a solid teal card with cream text;
   * 'inverted' a cream card for use on the dark theme.
   */
  variant?: 'default' | 'accent' | 'inverted';
  /** Small uppercase label rendered above the content. */
  title?: string;
}

/**
 * Content container. Children render inside a `.panel-content` block
 * (body type in Geist Mono); pass `title` for the uppercase panel label.
 */
export function Panel({ variant = 'default', title, className, children, ...rest }: PanelProps) {
  return (
    <div className={cx('panel', `panel--${variant}`, className)} {...rest}>
      {title !== undefined && <div className="panel-title">{title}</div>}
      <div className="panel-content">{children}</div>
    </div>
  );
}
