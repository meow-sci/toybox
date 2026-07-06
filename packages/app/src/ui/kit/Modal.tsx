import {
  Dialog as AriaDialog,
  Modal as AriaModal,
  ModalOverlay,
  type DialogProps,
  type ModalOverlayProps,
} from 'react-aria-components'
import { composeTw } from './index'

export interface ModalKitProps extends ModalOverlayProps {
  /**
   * 'center' — classic dialog, full-screen sheet on phones.
   * 'right'  — slide-over drawer (the cart), full-width sheet on phones.
   */
  placement?: 'center' | 'right'
}

const overlayBase = 'fixed inset-0 z-20 bg-overlay/55'
const placements = {
  center: {
    overlay: `${overlayBase} grid place-items-start justify-items-center overflow-y-auto p-0 sm:py-10 sm:px-5`,
    modal:
      'w-full min-h-full sm:min-h-0 sm:max-w-3xl rounded-none sm:rounded-xl border-0 sm:border border-border bg-surface',
  },
  right: {
    overlay: `${overlayBase}`,
    modal:
      'fixed inset-y-0 right-0 w-full sm:w-[440px] sm:max-w-[calc(100vw-40px)] overflow-y-auto border-l border-border bg-surface shadow-2xl',
  },
} as const

export function Modal({ placement = 'center', className, children, ...props }: ModalKitProps) {
  const p = placements[placement]
  return (
    <ModalOverlay {...props} isDismissable className={p.overlay}>
      <AriaModal className={composeTw(p.modal, className)}>{children}</AriaModal>
    </ModalOverlay>
  )
}

export function Dialog({ className, ...props }: DialogProps) {
  return <AriaDialog {...props} className={`${className ?? ''} p-5 outline-none sm:p-6`.trim()} />
}
