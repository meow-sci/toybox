import { ProgressBar as AriaProgressBar, type ProgressBarProps } from 'react-aria-components'
import { composeTw } from './index'

export function ProgressBar({ className, ...props }: ProgressBarProps) {
  return (
    <AriaProgressBar {...props} className={composeTw('block w-full', className)}>
      {({ percentage, isIndeterminate }) => (
        <span className="block h-2 w-full overflow-hidden rounded-full bg-surface-hover">
          <span
            className={`block h-full rounded-full bg-accent transition-[width] ${
              isIndeterminate ? 'w-1/3 animate-pulse' : ''
            }`}
            style={isIndeterminate ? undefined : { width: `${percentage ?? 0}%` }}
          />
        </span>
      )}
    </AriaProgressBar>
  )
}
