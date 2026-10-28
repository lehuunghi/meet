export function DrawingIcon({ kind }: { kind: string }) {
  const paths: Record<string, string> = {
    chevron: "m9 5 7 7-7 7",
    back: "m15 5-7 7 7 7",
    people: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M20 8v6m-3-3h6",
    stop: "M9 4H4v16h5m4-13 5 5-5 5m-5-5h13",
    shapes: "M3 3h9v9H3zM21 16a5 5 0 1 1-10 0 5 5 0 0 1 10 0Z",
    pointer: "m5 3 14 9-7 1-3 7z",
    pen: "m4 16 11-11 4 4L8 20H4zm9-9 4 4",
    marker: "m6 15 9-10 5 5-10 9H6zm-2 6h10",
    laser: "m5 15 9-10 5 5-9 10H5zm-2 7h4m12-6 2 2M18 3l2-2",
    text: "M4 5h16M12 5v15M8 20h8",
    note: "M4 3h16v12l-6 6H4zm10 18v-6h6M8 8h8m-8 4h5",
    stamp: "M4 3h16v11l-7 7H4zM13 21v-7h7M8 8h.01M15 8h.01M8 11q3 3 6 0",
    line: "M4 20 20 4",
    arrow: "M4 20 20 4m-8 0h8v8",
    rect: "M4 4h16v16H4z",
    ellipse: "M21 12a9 7 0 1 1-18 0 9 7 0 0 1 18 0Z",
    erase: "m3 14 10-11 8 8-9 10H9zM7 10l8 8m-3 3h9",
    undo: "M9 5 3 11l6 6m-6-6h12a6 6 0 0 1 0 12",
    download: "M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4",
    trash: "M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7",
    close: "M5 5l14 14M5 19 19 5",
    board: "M3 3h18v14H3zM12 17v5m-5 0h10M7 8h10m-10 4h6",
    more: "M5 12h.01M12 12h.01M19 12h.01",
    eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm13 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  };
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[kind] || paths.pen} />
    </svg>
  );
}
