// Centralized react-aria + Tailwind component kit. Import UI primitives from
// here (not from react-aria-components directly) so styling stays in one place.

export { card, cn, composeTw, focusRing } from './styles'

export { Button, button, type ButtonKitProps } from './Button'
export { Label, inputStyles } from './Field'
export {
  SearchField,
  TextField,
  type SearchFieldKitProps,
  type TextFieldKitProps,
} from './TextField'
export { Select, type SelectKitProps, type SelectOption } from './Select'
export { Checkbox, type CheckboxKitProps } from './Checkbox'
export { Dialog, Modal, type ModalKitProps } from './Modal'
export { Disclosure, DisclosureGroup, DisclosurePanel, DisclosureTrigger } from './Disclosure'
export { ProgressBar } from './ProgressBar'
export { Badge, Tag, badge, type BadgeProps } from './Badge'

// Triggers / pieces that need no styling are re-exported verbatim so call
// sites only ever import from the kit.
export { DialogTrigger, FileTrigger, Heading, Link } from 'react-aria-components'
