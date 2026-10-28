export function CallIcon({
  kind,
  off = false,
}: {
  kind: "mic" | "camera" | "present" | "people" | "leave" | "hand" | "reaction" | "chat" | "more" | "shield" | "activities" | "fullscreen" | "settings" | "info" | "record" | "stop";
  off?: boolean;
}) {
  const paths = {
    record: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
    stop: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM8 8h8v8H8z",
    mic: "M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm-7-3a7 7 0 0 0 14 0M12 18v4M8 22h8",
    camera: "M3 5h12v14H3zM15 10l6-4v12l-6-4",
    present: "M3 4h18v14H3zM8 22h8M12 18v4M12 14V7m-4 4 4-4 4 4",
    people:
      "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM2 21v-3a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v3M17 4a4 4 0 0 1 0 8m2 2a5 5 0 0 1 3 4v3",
    leave: "M3 15c5-5 13-5 18 0l-2 5-5-2v-4h-4v4l-5 2z",
    hand: "M8 12V5a2 2 0 0 1 4 0v6-8a2 2 0 0 1 4 0v8-6a2 2 0 0 1 4 0v9c0 5-3 8-7 8-3 0-5-2-7-5l-3-5a2 2 0 0 1 3-2l2 2",
    reaction: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM8 9h.01M16 9h.01M8 14c2 3 6 3 8 0",
    chat: "M21 4H3v14h5l4 4 4-4h5ZM7 9h10M7 13h6",
    more: "M12 4h.01M12 12h.01M12 20h.01",
    shield: "m12 2 8 3v6c0 5-4 8-8 11-4-3-8-6-8-11V5Zm-4 10 3 3 5-6",
    activities: "M12 2 7 10h10ZM3 15h6v6H3Zm17 3a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
    fullscreen: "M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5",
    settings: "M4 6h16M4 12h16M4 18h16M8 3v6m8 0v6m-6 0v6",
    info: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 11v6m0-10h.01",
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
