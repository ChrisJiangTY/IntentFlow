/** Shared source editor for Notebook task and Markdown cells. */

import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from 'react'

interface AutoGrowTextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> {
  readonly value: string
  readonly onValueChange: (value: string) => void
}

function resizeTextarea(element: HTMLTextAreaElement): void {
  element.style.height = '0px'
  element.style.height = `${Math.max(30, element.scrollHeight)}px`
}

/**
 * Render a one-row source editor that grows to fit its content.
 * @param props - Controlled source text, change handler, and textarea attributes.
 * @returns the auto-sized textarea.
 */
export function AutoGrowTextarea({ value, onValueChange, ...props }: AutoGrowTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    if (ref.current !== null) resizeTextarea(ref.current)
  }, [value])
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
        resizeTextarea(event.currentTarget)
        onValueChange(event.currentTarget.value)
      }}
    />
  )
}
