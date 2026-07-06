import { ChevronRight } from 'lucide-react'
import {
  Button,
  Disclosure as AriaDisclosure,
  DisclosureGroup,
  DisclosureGroupStateContext,
  DisclosurePanel as AriaDisclosurePanel,
  type ButtonProps,
  type DisclosurePanelProps,
  type DisclosureProps,
} from 'react-aria-components'
import { composeTw, cn } from './index'

export interface DisclosureKitProps extends DisclosureProps {
  /**
   * Detach this disclosure from any surrounding DisclosureGroup so it keeps
   * its own expanded state. Use for disclosures nested INSIDE a grouped
   * disclosure's panel (e.g. the file-manifest section inside a release) —
   * without this they would share the group's expandedKeys.
   */
  standalone?: boolean
}

export function Disclosure({ standalone, className, ...props }: DisclosureKitProps) {
  const disclosure = <AriaDisclosure {...props} className={composeTw('', className)} />

  if (!standalone) return disclosure
  return (
    <DisclosureGroupStateContext.Provider value={null}>
      {disclosure}
    </DisclosureGroupStateContext.Provider>
  )
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
        // The chevron keys off THIS button's own aria-expanded (group/trigger)
        // rather than the Disclosure root's data-expanded: trigger buttons are
        // never nested inside each other, so nested disclosures (e.g. the file
        // manifest inside a release) rotate independently of their parent.
        'group/trigger flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md py-2 text-left text-fg outline-none hover:bg-surface-hover/60 focus-visible:outline-2 focus-visible:outline-accent',
        className,
      )}
    >
      {(rp) => (
        <>
          <ChevronRight
            size={14}
            className="shrink-0 text-fg-muted transition-transform group-aria-expanded/trigger:rotate-90"
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
