import { test, expect, vi } from "vitest";
import { applyUITexts, uiText } from "./ui-language";
test("text overrides preserve data types and support parameterized messages without HTML execution", () => {
  vi.stubGlobal("window", new EventTarget());
  applyUITexts({
    "Đăng nhập": "Sign in",
    "Dòng %d bị lỗi: %s": "Row %d: %s",
    "Đưa lên ": "Move up ",
  });
  expect(uiText("Đăng nhập")).toBe("Sign in");
  expect(uiText("Dòng 2 bị lỗi: Email")).toBe("Row 2: Email");
  expect(uiText("Đưa lên Bài 1")).toBe("Move up Bài 1");
  expect(uiText(42)).toBe(42);
  const value = { password: "Đăng nhập" };
  expect(uiText(value)).toBe(value);
  applyUITexts({});
  expect(uiText("Đăng nhập")).toBe("Đăng nhập");
  vi.unstubAllGlobals();
});
