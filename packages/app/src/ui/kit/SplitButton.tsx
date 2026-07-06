import { ChevronDown } from 'lucide-react'
import { Group, type Key } from 'react-aria-components'
import { Button, type ButtonKitProps } from './Button'
import { Menu, MenuItem, MenuTrigger, Popover } from './Menu'
import { cn } from './styles'

export interface SplitButtonItem {
  id: string
  label: React.ReactNode
  checked?: boolean
}

export interface SplitButtonProps {
  /** Primary (default) action label. */
  children: React.ReactNode
  /** Second text row under the label (e.g. the selected platform). */
  subLabel?: React.ReactNode
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
  subLabel,
  onPress,
  items,
  onAction,
  menuLabel,
  size = 'md',
  variant = 'secondary',
}: SplitButtonProps) {
  return (
    <Group className="inline-flex items-stretch">
      <Button
        size={size}
        variant={variant}
        className={cn(
          'rounded-r-none',
          subLabel !== undefined && 'h-auto flex-col items-center gap-0 py-1 leading-tight',
        )}
        onPress={onPress}
      >
        {children}
        {subLabel !== undefined && (
          <span className="text-[11px] font-normal text-fg-muted">{subLabel}</span>
        )}
      </Button>
      <MenuTrigger>
        <Button
          size={size}
          variant={variant}
          aria-label={menuLabel}
          className={cn('rounded-l-none border-l-0 px-1', subLabel !== undefined && 'h-auto')}
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
