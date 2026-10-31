import { meetSymbols } from "./meet-symbols";
const names = {
  mic: "mic",
  camera: "videocam",
  present: "present_to_all",
  people: "group",
  leave: "call_end",
  hand: "pan_tool",
  reaction: "mood",
  chat: "chat_bubble",
  more: "more_vert",
  shield: "admin_panel_settings",
  activities: "category",
  fullscreen: "fullscreen",
  settings: "tune",
  info: "info",
  record: "radio_button_checked",
  stop: "stop_circle",
  expand: "keyboard_arrow_up",
} as const;
export function CallIcon({
  kind,
  off = false,
}: {
  kind: keyof typeof names;
  off?: boolean;
}) {
  const name =
    off && kind === "mic"
      ? "mic_off"
      : off && kind === "camera"
        ? "videocam_off"
        : names[kind];
  return (
    <svg
      className="meet-symbol"
      aria-hidden="true"
      focusable="false"
      width="24"
      height="24"
      viewBox="0 -960 960 960"
      fill="currentColor"
      stroke="none"
    >
      <path d={meetSymbols[name]} />
    </svg>
  );
}
