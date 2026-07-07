import type { ElementType, HTMLAttributes } from 'react';
import { cx } from './cx';

export interface TextProps extends HTMLAttributes<HTMLElement> {
  /**
   * Type-scale step. 'display'/'heading'/'subheading' use Inter;
   * 'body'/'caption' use Geist Mono; 'label' is uppercase letter-spaced Geist Mono.
   */
  variant?: 'display' | 'heading' | 'subheading' | 'body' | 'caption' | 'label';
  /** Element to render. Defaults per variant (h1, h2, h3, p, span, span). */
  as?: ElementType;
}

const defaultTag: Record<NonNullable<TextProps['variant']>, ElementType> = {
  display: 'h1',
  heading: 'h2',
  subheading: 'h3',
  body: 'p',
  caption: 'span',
  label: 'span',
};

/**
 * Typography primitive covering the full bingbong type scale.
 */
export function Text({ variant = 'body', as, className, ...rest }: TextProps) {
  const Tag = as ?? defaultTag[variant];
  return <Tag className={cx(`text-${variant}`, className)} {...rest} />;
}
