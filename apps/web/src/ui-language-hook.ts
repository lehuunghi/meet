import {useEffect,useReducer} from "react";
import {applyUITexts} from "./ui-language";
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
