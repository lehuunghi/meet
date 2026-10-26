const baselines = new WeakMap<HTMLFormElement, string>(),
  submitted = new WeakMap<HTMLFormElement, string>(),
  pending = new Set<HTMLFormElement>(),
  dirty = new Set<HTMLFormElement>();
let active: HTMLFormElement | null = null;
function values(f: HTMLFormElement) {
  return JSON.stringify({
    data: Array.from(new FormData(f).entries()).map(([k, v]) => [
      k,
      v instanceof File ? [v.name, v.size, v.lastModified] : v,
    ]),
    controls: Array.from(
      f.querySelectorAll<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >("input:not([name]),textarea:not([name]),select:not([name])"),
    ).map((el) => [el.type, el.value]),
  });
}
function prune() {
  for (const f of dirty) if (!f.isConnected) dirty.delete(f);
  for (const f of pending) if (!f.isConnected) pending.delete(f);
}
export function allowPageLeave() {
  prune();
  if (!dirty.size && !pending.size) return true;
  const ok = window.confirm(
    pending.size
      ? "Đang lưu dữ liệu. Bạn vẫn muốn rời trang?"
      : "Bạn có nội dung chưa lưu. Rời trang và bỏ thay đổi?",
  );
  if (ok) {
    dirty.clear();
    pending.clear();
  }
  return ok;
}
export function submittingForm() {
  const f = active;
  if (!f || pending.has(f)) return () => {};
  pending.add(f);
  f.dataset.submitting = "true";
  f.setAttribute("aria-busy", "true");
  return (success = false) => {
    pending.delete(f);
    delete f.dataset.submitting;
    f.removeAttribute("aria-busy");
    if (success) {
      baselines.set(f, submitted.get(f) || values(f));
      if (values(f) === baselines.get(f)) dirty.delete(f);
      else dirty.add(f);
    }
  };
}
export function installAcademyFormGuard() {
  const formOf = (e: Event) => {
    const el = e.target as HTMLElement;
    const f = el.closest?.("form");
    return f && f.closest(".academy-shell,.academy-auth") ? f : null;
  };
  const baseline = (e: Event) => {
    const f = formOf(e);
    if (f && !baselines.has(f)) baselines.set(f, values(f));
  };
  const changed = (e: Event) => {
    const f = formOf(e);
    if (f) {
      if (values(f) === baselines.get(f)) dirty.delete(f);
      else dirty.add(f);
    }
  };
  const submit = (e: Event) => {
    const f = formOf(e);
    if (!f) return;
    if (pending.has(f)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    submitted.set(f, values(f));
    active = f;
    setTimeout(() => {
      if (active === f) active = null;
    }, 0);
  };
  const unload = (e: BeforeUnloadEvent) => {
    prune();
    if (dirty.size || pending.size) {
      e.preventDefault();
      e.returnValue = "";
    }
  };
  window.addEventListener("focusin", baseline, true);
  window.addEventListener("pointerdown", baseline, true);
  window.addEventListener("input", changed, true);
  window.addEventListener("change", changed, true);
  window.addEventListener("submit", submit, true);
  window.addEventListener("beforeunload", unload);
  return () => {
    window.removeEventListener("focusin", baseline, true);
    window.removeEventListener("pointerdown", baseline, true);
    window.removeEventListener("input", changed, true);
    window.removeEventListener("change", changed, true);
    window.removeEventListener("submit", submit, true);
    window.removeEventListener("beforeunload", unload);
    dirty.clear();
    pending.clear();
  };
}
