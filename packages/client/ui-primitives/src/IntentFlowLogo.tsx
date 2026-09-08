import type { IconProps } from './icons/props.ts'

/**
 * Render the IntentFlow mark: three intent streams converging on a result node.
 * @param props.size - square edge in pixels (default 24).
 * @param props.className - extra class for layout placement.
 * @returns the decorative logo svg; pair it with a visible brand name.
 */
export function IntentFlowLogo({ size = 24, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      className={className}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="4" cy="7" r="2" fill="currentColor" />
      <circle cx="4" cy="16" r="2" fill="currentColor" />
      <circle cx="4" cy="25" r="2" fill="currentColor" />
      <path
        d="M8 7h1.25c2.8 0 4.45 1.37 5.9 3.45l2.05 2.95c1.03 1.48 2.38 2.6 4.3 2.6H23"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path d="M8 16h15" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <path
        d="M8 25h1.25c2.8 0 4.45-1.37 5.9-3.45l2.05-2.95c1.03-1.48 2.38-2.6 4.3-2.6H23"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path d="m27 11.5 4.5 4.5-4.5 4.5-4.5-4.5 4.5-4.5Z" fill="#695AF5" />
    </svg>
  )
}
