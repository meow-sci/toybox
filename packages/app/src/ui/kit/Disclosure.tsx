import { ChevronRight } from 'lucide-react'
import {
  Button,
  Disclosure as AriaDisclosure,
  DisclosureGroup,
  DisclosurePanel as AriaDisclosurePanel,
  type ButtonProps,
  type DisclosurePanelProps,
  type DisclosureProps,
} from 'react-aria-components'
import { composeTw, cn } from './index'

export function Disclosure({ className, ...props }: DisclosureProps) {
  return <AriaDisclosure {...props} className={composeTw('group/disclosure', className)} />
}

/**
 * The clickable part of a disclosure header (chevron + children). Lay
 * non-toggling controls (buttons, chips) NEXT to it in the same flex row —
 * only this element toggles.
 */
export function DisclosureTrigger({ className, children, ...props }: ButtonProps) {
  return (
    <Button
      slot="trigger"
      {...props}
      className={composeTw(
        'flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md py-2 text-left text-fg outline-none hover:bg-surface-hover/60 focus-visible:outline-2 focus-visible:outline-accent',
        className,
      )}
    >
      {(rp) => (
        <>
          <ChevronRight
            size={14}
            className="shrink-0 text-fg-muted transition-transform group-expanded/disclosure:rotate-90"
          />
          {typeof children === 'function' ? children(rp) : children}
        </>
      )}
    </Button>
  )
}

export function DisclosurePanel({ className, ...props }: DisclosurePanelProps) {
  return (
    <AriaDisclosurePanel
      {...props}
      className={cn('pb-3 pl-6', typeof className === 'string' ? className : undefined)}
    />
  )
}

export { DisclosureGroup }
