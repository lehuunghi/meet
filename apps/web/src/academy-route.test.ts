import { describe, it, expect } from "vitest";
import { readAcademyRoute, safeNext, legacyAcademyPath } from "./academy-route";
describe("stable academy links", () => {
  it("resolves resource ids, tabs, staff pages and short meeting links", () => {
    for (const [path, key, value] of [
      ["/hoc/lop/LH0001", "classId", "LH0001"],
      ["/hoc/mon/MH0001/bai-tap", "subjectTab", "classwork"],
      ["/hoc/bai-giang/lesson-1", "lessonId", "lesson-1"],
      ["/hoc/bai-tap/task-1", "assignmentId", "task-1"],
      ["/hoc/thanh-toan/order-1", "orderId", "order-1"],
      ["/abc123", "roomCode", "abc123"],
      ["/quan-tri/tai-khoan", "tab", "accounts"],
    ])
      expect((readAcademyRoute(path) as any)[key]).toBe(value);
    expect(readAcademyRoute("/hoc/unknown").invalid).toBe(true);
  });
  it("retains legacy intent and rejects external login redirects", () => {
    expect(legacyAcademyPath("/hoc", "?register=1&course=course-1")).toBe(
      "/dang-ky?next=%2Fhoc%2Fkhoa-hoc%2Fcourse-1",
    );
    for (const value of [
      "https://evil.test",
      "//evil.test",
      "/\\evil.test",
      "/hoc/../../outside",
      "/api/logout",
    ])
      expect(safeNext(value)).toBe("/hoc");
    expect(safeNext("/hoc/diem-danh?lop=LH0001&thang=2026-11")).toBe(
      "/hoc/diem-danh?lop=LH0001&thang=2026-11",
    );
  });
});
