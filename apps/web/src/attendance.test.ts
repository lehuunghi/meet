import { expect, it } from "vitest";
import { availableClasses, duration } from "./attendance";
it("keeps distinct class IDs and combines subjects in the same class", () => {
  expect(
    availableClasses([
      {
        id: "math",
        name: "Toán",
        class_id: "a",
        class_name: "10A1",
        teacher: "A",
      },
      {
        id: "physics",
        name: "Lý",
        class_id: "a",
        class_name: "10A1",
        teacher: "A",
      },
      {
        id: "math-b",
        name: "Toán",
        class_id: "b",
        class_name: "10A2",
        teacher: "B",
      },
    ]),
  ).toEqual([
    { id: "a", name: "10A1" },
    { id: "b", name: "10A2" },
  ]);
});
it("formats accumulated seconds without dropping hours", () => {
  expect(duration("3695")).toBe("1 giờ 1 phút 35 giây");
  expect(duration(0)).toBe("0 phút 0 giây");
});
