import { useEffect, useState, useRef } from "react";
import { vnDate, vnDateTime, dateInputISO } from "./date-format";
export function VNMonthInput({
  value,
  onValueChange,
}: {
  value: string;
  onValueChange: (v: string) => void;
}) {
  const format = (v: string) =>
    /^\d{4}-\d{2}$/.test(v) ? v.slice(5) + "/" + v.slice(0, 4) : "";
  const [text, setText] = useState(() => format(value));
  useEffect(() => setText(format(value)), [value]);
  return (
    <input
      type="text"
      value={text}
      placeholder="mm/yyyy"
      maxLength={7}
      aria-invalid={!!text && !/^(0[1-9]|1[0-2])\/[12][0-9]{3}$/.test(text)}
      onChange={(e) => {
        const v = e.target.value;
        setText(v);
        if (!v) onValueChange("");
        else if (/^(0[1-9]|1[0-2])\/[12][0-9]{3}$/.test(v))
          onValueChange(v.slice(3) + "-" + v.slice(0, 2));
      }}
    />
  );
}
export function VNDateInput({
  name,
  value,
  defaultValue,
  required = false,
  disabled = false,
  dateTime = false,
  onValueChange,
  label,
}: {
  name?: string;
  value?: string;
  defaultValue?: string;
  required?: boolean;
  disabled?: boolean;
  dateTime?: boolean;
  onValueChange?: (value: string) => void;
  label?: string;
}) {
  const format = (v?: string) =>
    v ? (dateTime ? vnDateTime(v) : vnDate(v)) : "";
  const control = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(() => format(value ?? defaultValue));
  useEffect(() => {
    if (value !== undefined) {
      setText(format(value));
      control.current?.setCustomValidity("");
    }
  }, [value]);
  return (
    <>
      <input
        ref={control}
        aria-label={label}
        type="text"
        value={text}
        required={required}
        disabled={disabled}
        placeholder={dateTime ? "dd/mm/yyyy hh:mm" : "dd/mm/yyyy"}
        maxLength={dateTime ? 16 : 10}
        pattern={
          dateTime
            ? "[0-9]{2}/[0-9]{2}/[0-9]{4} [0-9]{2}:[0-9]{2}"
            : "[0-9]{2}/[0-9]{2}/[0-9]{4}"
        }
        onChange={(e) => {
          const v = e.target.value;
          setText(v);
          const iso = dateInputISO(v, dateTime);
          e.target.setCustomValidity(
            v && !iso
              ? "Nhập ngày hợp lệ theo " +
                  (dateTime ? "dd/mm/yyyy hh:mm" : "dd/mm/yyyy")
              : "",
          );
          if (iso || !v) onValueChange?.(iso);
        }}
      />
      <input
        type="hidden"
        name={name}
        value={dateInputISO(text, dateTime)}
        disabled={disabled}
      />
    </>
  );
}
