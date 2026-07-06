import { ChevronDown } from 'lucide-react'
import { Group, type Key } from 'react-aria-components'
import { Button, type ButtonKitProps } from './Button'
import { Menu, MenuItem, MenuTrigger, Popover } from './Menu'

export interface SplitButtonItem {
  id: string
  label: React.ReactNode
  checked?: boolean
}

export interface SplitButtonProps {
  /** Primary (default) action label. */
  children: React.ReactNode
  /** Fired by the primary segment. */
  onPress: () => void
  /** Dropdown alternatives; selecting one fires onAction with its id. */
  items: SplitButtonItem[]
  onAction: (id: string) => void
  menuLabel: string
  size?: ButtonKitProps['size']
  variant?: ButtonKitProps['variant']
}

/**
 * A split button: the primary segment performs the sensible default; the
 * attached chevron opens a menu of explicit alternatives.
 */
export function SplitButton({
  children,
  onPress,
  items,
  onAction,
  menuLabel,
  size = 'md',
  variant = 'secondary',
}: SplitButtonProps) {
  return (
    <Group className="inline-flex items-stretch">
      <Button size={size} variant={variant} className="rounded-r-none" onPress={onPress}>
        {children}
      </Button>
      <MenuTrigger>
        <Button
          size={size}
          variant={variant}
          aria-label={menuLabel}
          className="rounded-l-none border-l-0 px-1"
        >
          <ChevronDown size={13} />
        </Button>
        <Popover placement="bottom end">
          <Menu aria-label={menuLabel} onAction={(key: Key) => onAction(String(key))}>
            {items.map((item) => (
              <MenuItem key={item.id} id={item.id} checked={item.checked ?? false}>
                {item.label}
              </MenuItem>
            ))}
          </Menu>
        </Popover>
      </MenuTrigger>
    </Group>
  )
}
