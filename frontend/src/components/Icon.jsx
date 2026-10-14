const paths = {
  bird: "M4 15c4-1 6-5 9-9 0 4 1 6 4 7l4-1-3 4c-2 4-6 5-10 3l-4 2 2-4z",
  grid: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  link: "M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2 M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2",
  activity: "M3 12h4l3-8 4 16 3-8h4",
  arrow: "M7 17 17 7 M7 7h10v10",
  play: "m8 5 11 7-11 7z",
  refresh: "M20 7v5h-5 M20 12a8 8 0 1 0-2 6",
  check: "m5 12 4 4L19 6",
  clock: "M12 8v5l3 2 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
  alert: "m12 3 10 18H2z M12 9v4 M12 17h.01",
  plus: "M12 5v14 M5 12h14",
  close: "m6 6 12 12 M18 6 6 18",
  search: "M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16 M16 16l6 6",
  chevron: "m9 5 7 7-7 7",
  stop: "M6 6h12v12H6z",
};

export default function Icon({ name, size = 18, ...props }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d={paths[name] ?? paths.activity} />
    </svg>
  );
}
