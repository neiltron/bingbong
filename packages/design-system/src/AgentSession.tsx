import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';

export interface AgentSessionProps extends HTMLAttributes<HTMLDivElement> {
  /** Session name, e.g. "claude-code" or a project-derived label. */
  name: string;
  /** Secondary line under the name, e.g. a working directory or elapsed time. */
  meta?: string;
  /** Fill color of the round indicator. */
  indicatorColor?: 'teal' | 'marigold' | 'rose' | 'sand';
  /** Content inside the indicator; defaults to the first letter of `name`. */
  icon?: ReactNode;
}

/**
 * Card representing one connected agent session: a round color indicator
 * next to the session name and its metadata line.
 */
export function AgentSession({
  name,
  meta,
  indicatorColor = 'teal',
  icon,
  className,
  ...rest
}: AgentSessionProps) {
  const iconText = indicatorColor === 'teal' ? 'text-cream' : 'text-teal';
  return (
    <div className={cx('agent-session', className)} {...rest}>
      <div className={cx('agent-session-indicator', `bg-${indicatorColor}`, iconText)}>
        {icon ?? name.charAt(0).toUpperCase()}
      </div>
      <div className="agent-session-info">
        <div className="agent-session-name">{name}</div>
        {meta !== undefined && <div className="agent-session-meta">{meta}</div>}
      </div>
    </div>
  );
}
