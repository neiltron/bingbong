import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';

export interface SourceNodeProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * Activity state: 'default' teal, 'active' marigold, 'idle' dimmed sand,
   * 'disconnected' a dashed outline ghost.
   */
  status?: 'default' | 'active' | 'idle' | 'disconnected';
  /** Large glyph in the node center — an initial or symbol. */
  icon?: ReactNode;
  /** Small label under the icon. */
  label?: string;
}

/**
 * Circular audio-source node from the spatial visualizer — one per sound
 * source, colored by activity state. Draggable in the real app (cursor: grab).
 */
export function SourceNode({ status = 'default', icon, label, className, ...rest }: SourceNodeProps) {
  return (
    <div className={cx('source-node', `source-node--${status}`, className)} {...rest}>
      <div className="source-node-icon">{icon}</div>
      {label !== undefined && <div className="source-node-label">{label}</div>}
    </div>
  );
}
