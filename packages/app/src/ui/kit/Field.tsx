import { Label as AriaLabel, type LabelProps } from 'react-aria-components'
import { cn } from './styles'

export const inputStyles =
  'w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-fg placeholder:text-fg-muted outline-none focus:border-accent'

export function Label({ className, ...props }: LabelProps) {
  return <AriaLabel {...props} className={cn('text-sm text-fg-muted', className as string)} />
}
