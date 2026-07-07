import type { ButtonHTMLAttributes } from 'react';
import { cx } from './cx';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual style: 'primary' is a teal fill, 'accent' a marigold fill, 'outline' a bordered ghost. */
  variant?: 'primary' | 'accent' | 'outline';
}

/**
 * Action button in the bingbong palette. Renders a native `<button>`;
 * disabled state comes from the standard `disabled` attribute.
 */
export function Button({ variant = 'primary', className, ...rest }: ButtonProps) {
  return <button className={cx('btn', `btn-${variant}`, className)} {...rest} />;
}
