export type AccountDraft = {
  id: string;
  short_id?: string;
  student_code: string;
  email: string;
  name: string;
  password: string;
  revision: number;
  active?: boolean;
  state?: string;
  dirty?: boolean;
  key?: string;
};
export function parseAccountText(
  text: string,
  role: "student" | "teacher",
): AccountDraft[] {
  const sep = text.includes("\t") ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && c === sep) {
      row.push(cell);
      cell = "";
    } else if (!quoted && (c === "\n" || c === "\r")) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((v) => v.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (quoted) throw Error("Thiếu dấu nháy đóng trong danh sách");
  row.push(cell);
  if (row.some((v) => v.trim())) rows.push(row);
  if (rows[0]?.[0].trim().toLowerCase() === "email") rows.shift();
  if (rows.length > 100) throw Error("Tối đa 100 dòng mỗi lượt");
  return rows.map((v, i) => {
    if (v.length !== (role === "student" ? 4 : 3))
      throw Error(`Dòng ${i + 1}: cần ${role === "student" ? 4 : 3} cột`);
    return {
      id: "",
      student_code: role === "student" ? v[1].trim() : "",
      email: v[0].trim(),
      name: v[role === "student" ? 2 : 1].trim(),
      password: v[role === "student" ? 3 : 2],
      revision: 0,
      dirty: true,
      key: crypto.randomUUID(),
    };
  });
}

export function parseSubjectText(text: string): string[] {
  const fake = text.split(/\r?\n/).filter((v) => v.trim());
  if (["name", "tên môn"].includes(fake[0]?.trim().toLocaleLowerCase("vi")))
    fake.shift();
  if (!fake.length || fake.length > 100)
    throw Error("Nhập từ 1 đến 100 dòng môn");
  return fake.map((v, i) => {
    let name = v.trim();
    if (name.startsWith('"') && name.endsWith('"'))
      name = name.slice(1, -1).replaceAll('""', '"');
    else if (/[\t,]/.test(name))
      throw Error("Dòng " + (i + 1) + ": chỉ nhập một cột tên môn");
    if (!name || name.length > 200) throw Error("Tên môn không hợp lệ");
    return name;
  });
}
