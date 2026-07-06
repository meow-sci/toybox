import { useStore } from '@nanostores/react'
import { ShoppingCart } from 'lucide-react'
import { Button as AriaButton } from 'react-aria-components'
import { $cartOpen, $cartSize } from '../state/appStore.ts'

/**
 * Floating always-on-top cart button (bottom-right) with a count chip in
 * its upper-left corner. Opens the one reusable cart panel. Rendered inside
 * the full-screen mod-detail dialog so the cart stays reachable there.
 */
export function CartFab() {
  const cartSize = useStore($cartSize)

  return (
    <div className="fixed right-5 bottom-5 z-30">
      <AriaButton
        aria-label={`Open cart (${cartSize} items)`}
        onPress={() => $cartOpen.set(true)}
        className="relative grid size-12 cursor-pointer place-items-center rounded-full border border-accent bg-accent-muted text-fg shadow-lg outline-none transition-[filter] hover:brightness-110 pressed:brightness-90 focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
      >
        <ShoppingCart size={20} />
        {cartSize > 0 && (
          <span className="absolute -top-1 -left-1 grid h-5 min-w-5 place-items-center rounded-full bg-red-600 px-1 text-[11px] leading-none font-bold text-white">
            {cartSize}
          </span>
        )}
      </AriaButton>
    </div>
  )
}
