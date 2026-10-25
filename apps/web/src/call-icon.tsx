export function CallIcon({
  kind,
  off = false,
}: {
  kind: "mic" | "camera" | "present" | "people" | "leave";
  off?: boolean;
}) {
  const paths = {
    mic: "M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm-7-3a7 7 0 0 0 14 0M12 18v4M8 22h8",
    camera: "M3 5h12v14H3zM15 10l6-4v12l-6-4",
    present: "M3 4h18v14H3zM8 22h8M12 18v4M12 14V7m-4 4 4-4 4 4",
    people:
      "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM2 21v-3a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v3M17 4a4 4 0 0 1 0 8m2 2a5 5 0 0 1 3 4v3",
    leave: "M3 15c5-5 13-5 18 0l-2 5-5-2v-4h-4v4l-5 2z",
  };
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[kind]} />
      {off && <path d="M3 3 21 21" strokeWidth="2.5" />}
    </svg>
  );
}
