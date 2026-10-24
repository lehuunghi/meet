import { useEffect, useId, useState } from "react";
import "./class-subject-picker.css";
export type ScopedCourse = {
  id: string;
  name: string;
  class_id: string;
  class_name: string;
  teacher: string;
};
type Option = { id: string; label: string; detail: string };
const normalize = (value: string) =>
  value
    .toLocaleLowerCase("vi")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/đ/g, "d");
function SearchSelect({
  label,
  placeholder,
  options,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  placeholder: string;
  options: Option[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const id = useId(),
    selected = options.find((o) => o.id === value),
    selectedLabel = selected?.label || "",
    [query, setQuery] = useState(selectedLabel),
    [open, setOpen] = useState(false),
    [active, setActive] = useState(0),
    [edited, setEdited] = useState(false),
    [moved, setMoved] = useState(false);
  useEffect(() => {
    setQuery(selectedLabel);
    setEdited(false);
    setMoved(false);
    setOpen(false);
  }, [value, selectedLabel]);
  const needle = normalize(edited ? query : "").trim(),
    matches = options.filter((o) =>
      normalize(o.label + " " + o.detail).includes(needle),
    ),
    shown = matches.slice(0, 20);
  function choose(option: Option) {
    onChange(option.id);
    setQuery(option.label);
    setEdited(false);
    setMoved(false);
    setOpen(false);
  }
  return (
    <div
      className="scope-combo"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setOpen(false);
          setQuery(selectedLabel);
        }
      }}
    >
      <label htmlFor={id}>{label}</label>
      <div className="scope-input">
        <input
          id={id}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={id + "-list"}
          aria-activedescendant={
            open && shown[active] ? id + "-" + active : undefined
          }
          disabled={disabled}
          placeholder={placeholder}
          value={query}
          autoComplete="off"
          onFocus={() => {
            setOpen(true);
            setActive(0);
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setEdited(true);
            setMoved(false);
            setOpen(true);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              setMoved(true);
              e.preventDefault();
              setOpen(true);
              setActive((n) => Math.min(n + 1, shown.length - 1));
            } else if (e.key === "ArrowUp") {
              setMoved(true);
              e.preventDefault();
              setActive((n) => Math.max(0, n - 1));
            } else if (e.key === "Enter" && open) {
              e.preventDefault();
              if (!edited && !moved && selected) {
                setOpen(false);
                setQuery(selectedLabel);
              } else if (shown[active]) choose(shown[active]);
            } else if (e.key === "Escape") {
              setOpen(false);
              setQuery(selectedLabel);
            }
          }}
        />
        {value && (
          <button
            type="button"
            className="scope-clear"
            aria-label={"Bỏ chọn " + label.toLowerCase()}
            disabled={disabled}
            onClick={() => {
              onChange("");
              setQuery("");
              setOpen(false);
            }}
          >
            ×
          </button>
        )}
      </div>
      {open && !disabled && (
        <div
          id={id + "-list"}
          role="listbox"
          aria-label={label}
          className="scope-options"
        >
          {shown.map((o, i) => (
            <button
              type="button"
              role="option"
              id={id + "-" + i}
              key={o.id}
              aria-selected={o.id === value}
              className={i === active ? "keyboard-active" : ""}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(o)}
            >
              <strong>{o.label}</strong>
              <small>{o.detail}</small>
            </button>
          ))}
          {!shown.length && <p>Không tìm thấy kết quả.</p>}
          {matches.length > 20 && (
            <p>Có {matches.length} kết quả. Nhập thêm để thu hẹp danh sách.</p>
          )}
        </div>
      )}
    </div>
  );
}
export function ClassSubjectPicker({
  courses,
  classId,
  courseId,
  onClass,
  onCourse,
}: {
  courses: ScopedCourse[];
  classId: string;
  courseId: string;
  onClass: (id: string) => void;
  onCourse: (id: string) => void;
}) {
  const counts = new Map<string, number>();
  for (const c of courses)
    counts.set(c.class_id, (counts.get(c.class_id) || 0) + 1);
  const classes = [
    ...new Map(
      courses.map((c) => [
        c.class_id,
        {
          id: c.class_id,
          label: c.class_name,
          detail: (counts.get(c.class_id) || 0) + " môn học",
        },
      ]),
    ).values(),
  ].sort((a, b) => a.label.localeCompare(b.label, "vi", { numeric: true }));
  const subjects = courses
    .filter((c) => c.class_id === classId)
    .map((c) => ({ id: c.id, label: c.name, detail: c.teacher }))
    .sort((a, b) => a.label.localeCompare(b.label, "vi", { numeric: true }));
  return (
    <div className="class-subject-picker compact-scope">
      <div className="scope-selects">
        <SearchSelect
          label="Lớp học"
          placeholder="Tìm và chọn lớp…"
          options={classes}
          value={classId}
          onChange={onClass}
        />
        <SearchSelect
          label="Môn học"
          placeholder={classId ? "Tìm và chọn môn…" : "Chọn lớp trước"}
          options={subjects}
          value={courseId}
          onChange={onCourse}
          disabled={!classId}
        />
      </div>
      <small className="scope-hint">
        {classes.length} lớp trong phạm vi
        {classId ? " · " + subjects.length + " môn trong lớp đã chọn" : ""}
      </small>
    </div>
  );
}
