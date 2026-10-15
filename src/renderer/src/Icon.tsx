import type { CSSProperties } from 'react'

const paths = {
  monitor: 'M3 4h18v12H3z M8 21h8 M12 16v5',
  grid: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  plus: 'M12 5v14 M5 12h14',
  arrow: 'M5 12h14 M13 6l6 6-6 6',
  settings:
    'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z',
  linux: 'M5 6l6 6-6 6 M13 18h6',
  macos:
    'M12 7c-3-3-8-1-8 4 0 4 3 10 5 10 2 0 2-1 4-1s2 1 3 1c2-1 4-4 4-6-4-2-3-6 0-7-2-3-5-3-8-1z M12 5c0-2 2-4 4-4 0 2-1 4-4 4',
  windows: 'M3 5l8-1v7H3z M14 3l7-1v9h-7z M3 14h8v7l-8-1z M14 14h7v9l-7-1z',
  check: 'M5 12l4 4L19 6',
  close: 'M6 6l12 12 M18 6L6 18',
  folder: 'M3 6h7l2 2h9v12H3z M3 6V4h7l2 2',
  key: 'M8 16a6 6 0 1 1 6-6h7v4h-4v3h-3 M5 7h.01',
  link: 'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2 M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2',
  power: 'M12 2v10 M6 5a9 9 0 1 0 12 0',
  edit: 'M14 5l5 5 M4 15L16 3l5 5L9 20l-6 1z',
  external: 'M14 3h7v7 M21 3L10 14 M10 3H3v18h18v-7',
  signal: 'M3 17h2v4H3z M8 12h2v9H8z M13 7h2v14h-2z M18 2h2v19h-2z',
  clock: 'M12 8v5l3 2 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  back: 'M19 12H5 M11 6l-6 6 6 6',
  shield: 'M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6z M8 12l3 3 5-6'
} as const

export type IconName = keyof typeof paths

export function Icon({
  name,
  size = 20,
  style
}: {
  name: IconName
  size?: number
  style?: CSSProperties
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={style}
    >
      <path d={paths[name]} />
    </svg>
  )
}
