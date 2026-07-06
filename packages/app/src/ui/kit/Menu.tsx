import { Check } from 'lucide-react'
import {
  Menu as AriaMenu,
  MenuItem as AriaMenuItem,
  MenuTrigger,
  Popover as AriaPopover,
  type MenuItemProps,
  type MenuProps,
  type PopoverProps,
} from 'react-aria-components'
import { composeTw, cn } from './index'

export function Popover({ className, ...props }: PopoverProps) {
  return (
    <AriaPopover
      {...props}
      className={composeTw(
        'min-w-(--trigger-width) rounded-md border border-border bg-surface p-1 shadow-lg',
        className,
      )}
    />
  )
}

export function Menu<T extends object>({ className, ...props }: MenuProps<T>) {
  return <AriaMenu {...props} className={composeTw('outline-none', className)} />
}

export interface MenuItemKitProps extends Omit<MenuItemProps, 'children'> {
  children: React.ReactNode
  /** Show a leading check mark (e.g. "this is the detected platform"). */
  checked?: boolean
}

export function MenuItem({ checked, children, className, ...props }: MenuItemKitProps) {
  return (
    <AriaMenuItem
      {...props}
      className={(rp) =>
        cn(
          'flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm text-fg outline-none',
          rp.isFocused && 'bg-surface-hover',
          rp.isDisabled && 'opacity-45',
          typeof className === 'function' ? className(rp) : className,
        )
      }
    >
      <Check size={12} className={checked ? 'text-accent' : 'invisible'} />
      {children}
    </AriaMenuItem>
  )
}

export { MenuTrigger }
