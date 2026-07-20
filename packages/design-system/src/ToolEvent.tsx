import type { HTMLAttributes } from 'react';
import { cx } from './cx';

export interface ToolEventProps extends HTMLAttributes<HTMLDivElement> {
  /** Short badge text, e.g. an event category like "tool" or "hook". */
  badge?: string;
  /** Tool name, e.g. "Read" or "Bash". */
  name: string;
  /** Agent/session that ran the tool. */
  agent?: string;
  /** Right-aligned timestamp, e.g. "12:04:33". */
  time?: string;
}

/**
 * One row in the tool-activity feed: badge, tool name, originating agent,
 * and a right-aligned time.
 */
export function ToolEvent({ badge, name, agent, time, className, ...rest }: ToolEventProps) {
  return (
    <div className={cx('tool-event', className)} {...rest}>
      {badge !== undefined && <span className="tool-event-badge">{badge}</span>}
      <span className="tool-event-name">{name}</span>
      {agent !== undefined && <span className="tool-event-agent">{agent}</span>}
      {time !== undefined && <span className="tool-event-time">{time}</span>}
    </div>
  );
}
