import type { ButtonHTMLAttributes } from 'react';
import { cx } from './cx';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual style: 'primary' is an accent fill, 'accent' a marigold fill, 'outline' a bordered ghost. */
  variant?: 'primary' | 'accent' | 'outline';
  /** 'small' is a compact size for headers, toolbars, and modal chrome. */
  size?: 'medium' | 'small';
}

/**
 * Action button in the bingbong palette. Renders a native `<button>`;
 * disabled state comes from the standard `disabled` attribute.
 */
export function Button({ variant = 'primary', size = 'medium', className, ...rest }: ButtonProps) {
  return (
    <button
      className={cx('btn', `btn-${variant}`, size === 'small' && 'btn-small', className)}
      {...rest}
    />
  );
}
