const PATHS = {
  home: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10',
  box: 'M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8',
  layers: 'M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5M3 17l9 5 9-5',
  bolt: 'M13 2L4 14h7l-1 8 9-12h-7l1-8z',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  search: 'M11 4a7 7 0 100 14 7 7 0 000-14zM20 20l-4-4',
  gear: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-2.9 1.2V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-2.9-1.1l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00-1.2-2.9H3a2 2 0 110-4h.1a1.7 1.7 0 001.1-2.9l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 002.9 1.1l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z',
  filter: 'M3 5h18l-7 8v6l-4 2v-8L3 5z',
  download: 'M12 3v12M7 10l5 5 5-5M4 21h16',
  upload: 'M12 15V3M7 8l5-5 5 5M4 21h16',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 100-6 3 3 0 000 6z',
  x: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12l5 5 9-10',
  cart: 'M3 4h2l2.5 11h10L20 7H6.5M9 20a1 1 0 100-2 1 1 0 000 2zM17 20a1 1 0 100-2 1 1 0 000 2z',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  users: 'M16 20v-1a4 4 0 00-4-4H6a4 4 0 00-4 4v1M9 11a4 4 0 100-8 4 4 0 000 8zM22 20v-1a4 4 0 00-3-3.9M16 3.1a4 4 0 010 7.8',
  store: 'M3 9l1.5-5h15L21 9M4 9v11h16V9M3 9a3 3 0 006 0 3 3 0 006 0 3 3 0 006 0M9 20v-6h6v6',
  cash: 'M2 7h20v10H2zM12 14a2 2 0 100-4 2 2 0 000 4zM6 10v4M18 10v4',
  card: 'M2 6h20v12H2zM2 10h20M6 15h4',
  printer: 'M7 8V3h10v5M7 17H4v-7h16v7h-3M7 14h10v7H7z',
  logout: 'M9 4H4v16h5M16 8l4 4-4 4M20 12H9',
  back: 'M15 5l-7 7 7 7',
  down: 'M6 9l6 6 6-6',
  undo: 'M4 9h11a5 5 0 010 10H9M4 9l4-4M4 9l4 4',
  clock: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2',
  alert: 'M12 3l10 18H2L12 3zM12 10v5M12 18v.5',
  tag: 'M3 12V3h9l9 9-9 9-9-9zM7.5 7.5v.01',
  doc: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h6M9 17h6',
  up: 'M6 15l6-6 6 6',
  swap: 'M4 8h14l-3-3M20 16H6l3 3',
  building: 'M4 21V4h10v17M14 9h6v12M8 8h2M8 12h2M8 16h2M17 13v.01M17 17v.01M2 21h20',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
