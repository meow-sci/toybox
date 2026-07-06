import {
  Input,
  SearchField as AriaSearchField,
  TextField as AriaTextField,
  type SearchFieldProps,
  type TextFieldProps,
} from 'react-aria-components'
import { composeTw, inputStyles } from './index'

export interface TextFieldKitProps extends TextFieldProps {
  placeholder?: string
}

/** Single-line text input (label optional at the call site via <Label>). */
export function TextField({ placeholder, className, ...props }: TextFieldKitProps) {
  return (
    <AriaTextField {...props} className={composeTw('flex min-w-0 flex-1', className)}>
      <Input placeholder={placeholder} className={inputStyles} />
    </AriaTextField>
  )
}

export interface SearchFieldKitProps extends SearchFieldProps {
  placeholder?: string
}

export function SearchField({ placeholder, className, ...props }: SearchFieldKitProps) {
  return (
    <AriaSearchField {...props} className={composeTw('group flex min-w-0 flex-1', className)}>
      <Input
        placeholder={placeholder}
        className={`${inputStyles} text-[15px] [&::-webkit-search-cancel-button]:appearance-none`}
      />
    </AriaSearchField>
  )
}
