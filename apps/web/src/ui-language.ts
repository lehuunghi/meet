import { useEffect, useReducer } from "react";
let dictionary: Record<string, string> = {};
let patterns: Array<{ source: string; target: string; regexp?: RegExp }> = [];
export function uiText<T>(value: T): T {
  if (typeof value !== "string") return value;
  if (Object.hasOwn(dictionary, value)) return dictionary[value] as T;
  for (const p of patterns) {
    if (p.regexp) {
      const m = value.match(p.regexp);
      if (m) {
        let n = 1;
        return p.target.replace(/%[ds]/g, () => m[n++] || "") as T;
      }
    } else if (p.source.endsWith(" ") && value.startsWith(p.source))
      return (p.target + value.slice(p.source.length)) as T;
    else if (p.source.startsWith(" ") && value.endsWith(p.source))
      return (value.slice(0, -p.source.length) + p.target) as T;
  }
  return value;
}
export function applyUITexts(next: Record<string, string>) {
  dictionary = next;
  patterns = Object.entries(next)
    .filter(
      ([key]) =>
        key.length > 5 &&
        (/%[ds]/.test(key) || key.startsWith(" ") || key.endsWith(" ")),
    )
    .sort((a, b) => b[0].length - a[0].length)
    .map(([source, target]) => ({
      source,
      target,
      ...(/%[ds]/.test(source)
        ? {
            regexp: new RegExp(
              "^" +
                source
                  .split(/(%[ds])/)
                  .map((part) =>
                    /^%[ds]$/.test(part)
                      ? "([\\s\\S]*?)"
                      : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
                  )
                  .join("") +
                "$",
            ),
          }
        : {}),
    }));
  window.dispatchEvent(new Event("meet-ui-texts-changed"));
}
export function useUITexts() {
  const [, redraw] = useReducer((n) => n + 1, 0);
  useEffect(() => {
    const change = () => redraw();
    window.addEventListener("meet-ui-texts-changed", change);
    let active = true;
    void fetch("/api/academy/ui-texts", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : {}))
      .then((v: any) => {
        if (active && v.texts && !Array.isArray(v.texts)) applyUITexts(v.texts);
      })
      .catch(() => {});
    return () => {
      active = false;
      window.removeEventListener("meet-ui-texts-changed", change);
    };
  }, []);
}
