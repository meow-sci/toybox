import { tv, type VariantProps } from 'tailwind-variants'

/** Static status pills + tag chips (not interactive — plain spans). */
export const badge = tv({
  base: 'inline-block rounded-full px-2 py-px text-[11px] font-semibold whitespace-nowrap',
  variants: {
    tone: {
      good: 'bg-good/18 text-good',
      warn: 'bg-warn/18 text-warn',
      bad: 'bg-bad/18 text-bad',
      info: 'bg-accent/18 text-accent',
    },
  },
  defaultVariants: { tone: 'info' },
})

export interface BadgeProps extends VariantProps<typeof badge> {
  children: React.ReactNode
  title?: string
}

export function Badge({ tone, children, title }: BadgeProps) {
  return (
    <span className={badge({ tone })} title={title}>
      {children}
    </span>
  )
}

export function Tag({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <span
      className="inline-block rounded-full border border-border bg-surface-hover px-2 py-px text-[11px] whitespace-nowrap text-fg-muted"
      title={title}
    >
      {children}
    </span>
  )
}
