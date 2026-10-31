import { test, expect } from "vitest";
import { vnDate, vnDateTime, dateInputISO } from "./date-format";
test("Vietnam dates always use padded day/month/year, 24 hours and Vietnam timezone", () => {
  expect(vnDateTime("2026-01-02T18:05:00Z")).toBe("03/01/2026 01:05");
  expect(vnDate("2010-02-03")).toBe("03/02/2010");
  expect(vnDateTime("2026-01-02 18:05:00")).toBe("03/01/2026 01:05");
  expect(vnDate("bad")).toBe("—");
});
test("date inputs reject impossible/ambiguous dates and return canonical API values", () => {
  expect(dateInputISO("29/02/2024")).toBe("2024-02-29");
  expect(dateInputISO("29/02/2025")).toBe("");
  expect(dateInputISO("03/01/2026 01:05", true)).toBe(
    "2026-01-02T18:05:00.000Z",
  );
  expect(dateInputISO("1/2/2026")).toBe("");
  expect(dateInputISO("03/01/2026 24:00", true)).toBe("");
});
