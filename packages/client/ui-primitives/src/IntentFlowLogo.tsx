import type { IconProps } from './icons/props.ts'

/**
 * Render the RECO mark from the workspace Figma design.
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
      viewBox="0 0 24 24"
      fill="none"
      style={{ color: 'var(--dsw-alias-state-business-primary)' }}
      aria-hidden="true"
    >
      <circle cx="6" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="17.5" cy="5.5" r="2.5" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="7.5" cy="18" r="2.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8.5 6.2L15 5.8M7.1 7.4L7.4 15.5M9.5 16.4L16 7.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}
