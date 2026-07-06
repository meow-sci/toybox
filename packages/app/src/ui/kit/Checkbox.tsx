import { Check } from 'lucide-react'
import { Checkbox as AriaCheckbox, type CheckboxProps } from 'react-aria-components'
import { composeTw } from './index'

export interface CheckboxKitProps extends Omit<CheckboxProps, 'children'> {
  children?: React.ReactNode
}

export function Checkbox({ children, className, ...props }: CheckboxKitProps) {
  return (
    <AriaCheckbox
      {...props}
      className={composeTw(
        'group inline-flex cursor-pointer items-center gap-2 text-sm text-fg-muted',
        className,
      )}
    >
      <span className="grid size-4 shrink-0 place-items-center rounded border border-border-strong bg-surface transition-colors group-selected:border-accent group-selected:bg-accent group-focus-visible:outline group-focus-visible:outline-2 group-focus-visible:outline-accent group-focus-visible:outline-offset-2">
        <Check size={12} className="text-accent-fg opacity-0 group-selected:opacity-100" />
      </span>
      {children}
    </AriaCheckbox>
  )
}
