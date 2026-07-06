import { Button as AriaButton, composeRenderProps, type ButtonProps } from 'react-aria-components'
import { tv, type VariantProps } from 'tailwind-variants'
import { focusRing } from './styles'

export const button = tv({
  extend: focusRing,
  base: 'inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md border font-medium transition-colors cursor-pointer disabled:opacity-50 disabled:pointer-events-none',
  variants: {
    variant: {
      primary: 'border-accent bg-accent-muted text-fg hover:brightness-110 pressed:brightness-90',
      secondary:
        'border-border bg-surface-hover text-fg hover:border-accent-muted pressed:brightness-90',
      ghost: 'border-transparent text-fg hover:bg-surface-hover pressed:brightness-90',
      danger: 'border-bad bg-surface-hover text-fg hover:bg-bad/15 pressed:brightness-90',
    },
    size: {
      sm: 'h-6 px-2 text-xs',
      md: 'h-8 px-3 text-sm',
      lg: 'h-10 px-4 text-[15px]',
    },
  },
  defaultVariants: { variant: 'secondary', size: 'md' },
})

export interface ButtonKitProps extends ButtonProps, VariantProps<typeof button> {}

export function Button({ variant, size, className, ...props }: ButtonKitProps) {
  return (
    <AriaButton
      {...props}
      className={composeRenderProps(className, (cls, renderProps) =>
        button({ ...renderProps, variant, size, className: cls }),
      )}
    />
  )
}
