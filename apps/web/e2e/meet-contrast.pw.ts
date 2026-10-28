import { test, expect } from "@playwright/test";
function luminance(rgb: number[]) {
  const c = rgb.slice(0, 3).map((v) => {
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function ratio(a: string, b: string) {
  const x = luminance(a.match(/[\d.]+/g)!.map(Number)),
    y = luminance(b.match(/[\d.]+/g)!.map(Number));
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
test("Meet controls keep readable foregrounds and visible boundaries in on and off states", async ({
  page,
}) => {
  await page.goto("/hoc/buoi-hoc/preview?academy_demo=1&role=teacher");
  const check = async () => {
    const data = await page.locator(".room-toolbar").evaluate((el) => ({
      bar: getComputedStyle(el).backgroundColor,
      buttons: Array.from(
        el.querySelectorAll<HTMLElement>(
          "button.call-control,.meeting-popup>summary",
        ),
      )
        .filter((e) => e.getBoundingClientRect().width > 0)
        .map((e) => {
          const s = getComputedStyle(e);
          return {
            label: e.getAttribute("aria-label"),
            fg: s.color,
            bg: s.backgroundColor,
            border: s.borderTopColor,
            borderWidth: parseFloat(s.borderTopWidth),
          };
        }),
    }));
    for (const b of data.buttons) {
      expect(
        ratio(b.fg, b.bg),
        b.label + " icon contrast",
      ).toBeGreaterThanOrEqual(4.5);
      expect(b.borderWidth, b.label + " border").toBeGreaterThanOrEqual(1);
      expect(
        ratio(b.border, data.bar),
        b.label + " boundary contrast",
      ).toBeGreaterThanOrEqual(3);
    }
  };
  await check();
  await page.getByRole("button", { name: "Tắt mic", exact: true }).click();
  await page.getByRole("button", { name: "Tắt camera", exact: true }).click();
  await page.getByRole("button", { name: "Giơ tay", exact: true }).click();
  await check();
  await page.getByRole("button", { name: "Bật mic", exact: true }).hover();
  await expect(page.getByRole("tooltip")).toHaveText("Bật mic");
  await expect(page.locator(".control-label:visible")).toHaveCount(0);
  await page.setViewportSize({ width: 320, height: 568 });
  await check();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "../../outputs/meet-control-contrast-mobile.png",
  });
});
