import { ChevronDown } from 'lucide-react'
import {
  Button,
  ListBox,
  ListBoxItem,
  Popover,
  Select as AriaSelect,
  SelectValue,
  type SelectProps,
} from 'react-aria-components'
import { composeTw, cn } from './index'

export interface SelectOption {
  id: string
  label: string
}

export interface SelectKitProps extends Omit<SelectProps<SelectOption>, 'children'> {
  options: SelectOption[]
  'aria-label': string
}

export function Select({ options, className, ...props }: SelectKitProps) {
  return (
    <AriaSelect {...props} className={composeTw('inline-flex', className)}>
      <Button className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-md border border-border bg-surface px-2.5 text-sm text-fg outline-none focus-visible:border-accent">
        <SelectValue />
        <ChevronDown size={14} className="text-fg-muted" />
      </Button>
      <Popover className="min-w-(--trigger-width) rounded-md border border-border bg-surface p-1 shadow-lg">
        <ListBox items={options} className="outline-none">
          {(item) => (
            <ListBoxItem
              id={item.id}
              textValue={item.label}
              className={({ isFocused, isSelected }) =>
                cn(
                  'cursor-pointer rounded px-2 py-1 text-sm text-fg outline-none',
                  isFocused && 'bg-surface-hover',
                  isSelected && 'text-accent',
                )
              }
            >
              {item.label}
            </ListBoxItem>
          )}
        </ListBox>
      </Popover>
    </AriaSelect>
  )
}
