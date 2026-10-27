import fs from "node:fs";
import path from "node:path";
import ts from "./node_modules/typescript/lib/typescript.js";
import { normalize } from "./ui-text-plugin.mjs";
const root = new URL(".", import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/,
  "$1",
);
process.chdir(decodeURIComponent(root));
const catalog = new Map();
const add = (key, area) => {
  if (key && key.length <= 2000 && /\p{L}/u.test(key) && !catalog.has(key))
    catalog.set(key, { key, area });
};
const area = (file) =>
  file.includes("site-editor")
    ? "Quản trị website"
    : file.includes("account")
      ? "Tài khoản & phân quyền"
      : file.includes("room") || file === "main.tsx"
        ? "Phòng học & hệ thống"
        : file.includes("classroom") || file.includes("learning")
          ? "Lớp học & môn học"
          : file.includes("attendance")
            ? "Điểm danh"
            : file.includes("record")
              ? "Video & ghi hình"
              : file.includes("settings")
                ? "Cài đặt"
                : file.startsWith("academy")
                  ? "Không gian học tập"
                  : "Giao diện chung";
for (const file of fs
  .readdirSync("src")
  .filter(
    (x) =>
      /\.[jt]sx?$/.test(x) &&
      !x.includes(".test.") &&
      !x.includes("ui-language"),
  )) {
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(path.join("src", file), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const visit = (node) => {
    if (ts.isJsxText(node)) add(normalize(node.text), area(file));
    if (
      ts.isStringLiteral(node) &&
      (/[À-ỹĐđ]/u.test(node.text) ||
        (ts.isJsxAttribute(node.parent) &&
          ["title", "placeholder", "alt", "aria-label"].includes(
            node.parent.name.text,
          )))
    )
      add(node.text, area(file));
    ts.forEachChild(node, visit);
  };
  visit(source);
}
const html = fs.readFileSync("../api/academy_site.html", "utf8");
for (const m of html.matchAll(/{{ui ("(?:[^"\\]|\\.)*")}}/g))
  add(JSON.parse(m[1]), "Website công khai");
for (const file of fs
  .readdirSync("../api")
  .filter((x) => x.endsWith(".go") && !x.endsWith("_test.go"))) {
  for (const m of fs
    .readFileSync("../api/" + file, "utf8")
    .matchAll(/problem\([^\n]*?,\s*\d+\s*,\s*("(?:[^"\\]|\\.)*")\s*\)/g)) {
    try {
      add(JSON.parse(m[1]), "Thông báo hệ thống");
    } catch {}
  }
}
fs.writeFileSync(
  "../api/ui_catalog.json",
  JSON.stringify(
    [...catalog.values()].sort(
      (a, b) => a.area.localeCompare(b.area) || a.key.localeCompare(b.key),
    ),
    null,
    2,
  ) + "\n",
);

for (const file of fs
  .readdirSync("../api")
  .filter((x) => x.endsWith(".go") && !x.endsWith("_test.go"))) {
  for (const m of fs
    .readFileSync("../api/" + file, "utf8")
    .matchAll(/"(?:[^"\\]|\\.)*"/g)) {
    try {
      const value = JSON.parse(m[0]);
      if (
        /[À-ỹĐđ]/u.test(value) &&
        !/^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER)\b/i.test(value)
      )
        add(value, "Thông báo hệ thống");
    } catch {}
  }
}
fs.writeFileSync(
  "../api/ui_catalog.json",
  JSON.stringify(
    [...catalog.values()].sort(
      (a, b) => a.area.localeCompare(b.area) || a.key.localeCompare(b.key),
    ),
    null,
    2,
  ) + "\n",
);

console.log("Editable interface strings:", catalog.size);
