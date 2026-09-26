/** Shared source editor for Notebook task and Markdown cells. */

import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from 'react'

interface AutoGrowTextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> {
  readonly value: string
  readonly onValueChange: (value: string) => void
  readonly minimumHeight?: number
}

function resizeTextarea(element: HTMLTextAreaElement, minimumHeight: number): void {
  element.style.height = '0px'
  element.style.height = `${Math.max(minimumHeight, element.scrollHeight)}px`
}

/**
 * Render a one-row source editor that grows to fit its content.
 * @param props - Controlled source text, change handler, and textarea attributes.
 * @returns the auto-sized textarea.
 */
export function AutoGrowTextarea({ value, onValueChange, minimumHeight = 30, ...props }: AutoGrowTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    if (ref.current !== null) resizeTextarea(ref.current, minimumHeight)
  }, [minimumHeight, value])
  useLayoutEffect(() => {
    if (props.autoFocus) ref.current?.focus()
  }, [props.autoFocus])
  return (
    <textarea
      {...props}
      ref={ref}
      rows={1}
      value={value}
      onChange={(event) => {
        resizeTextarea(event.currentTarget, minimumHeight)
        onValueChange(event.currentTarget.value)
      }}
    />
  )
}
