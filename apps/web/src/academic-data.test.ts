import { it, expect } from "vitest";
import { parseAccountText } from "./academic-data";
it("parses student rows and keeps commas inside a quoted name", () => {
  const rows = parseAccountText(
    'email,student_code,name,password\na@example.test,sv01,"Nguyễn An, lớp A",unique-password-123',
    "student",
  );
  expect(rows[0].name).toBe("Nguyễn An, lớp A");
  expect(rows[0].student_code).toBe("sv01");
});
it("accepts teacher-only TSV without student code and rejects malformed input", () => {
  expect(
    parseAccountText("a@example.test\tTeacher\tpassword-12345", "teacher")[0]
      .student_code,
  ).toBe("");
  expect(() => parseAccountText("a,b,c", "student")).toThrow();
  expect(() => parseAccountText('"a,b,c', "teacher")).toThrow();
});

import { parseSubjectText } from "./academic-data";
it("imports Vietnamese subject rows and rejects extra columns", () => {
  expect(parseSubjectText('Tên môn\r\nToán\r\n"Ngữ văn, nâng cao"')).toEqual([
    "Toán",
    "Ngữ văn, nâng cao",
  ]);
  expect(() => parseSubjectText("Toán\tLý")).toThrow();
  expect(() => parseSubjectText("name")).toThrow();
});
