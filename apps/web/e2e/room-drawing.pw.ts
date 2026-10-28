import { test, expect, type Page } from "@playwright/test";
import { emptyDrawing } from "../src/drawing-model";

async function enterDemo(page: Page) {
  await page.goto("/?demo=1&role=teacher&page=overview");
  await page
    .getByRole("button", { name: "Xem môn học", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: /Vào phòng dạy|Chuẩn bị dạy/ })
    .first()
    .click();
}
async function line(page: Page, label = "Bảng trắng dùng chung") {
  const canvas = page.getByLabel(label, { exact: true });
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6, {
    steps: 8,
  });
  await page.mouse.up();
  await expect(page.getByText(/Đang lưu…/)).toHaveCount(0);
}
test("shared drawing controls support pages, export, presentation overlay and mobile", async ({
  page,
}) => {
  await enterDemo(page);
  await page.getByRole("button", { name: "Bảng trắng", exact: true }).click();
  await expect(
    page.getByLabel("Bảng trắng dùng chung", { exact: true }),
  ).toBeVisible();
  if (
    (await page
      .getByRole("button", { name: "Tùy chỉnh bút", exact: true })
      .getAttribute("aria-expanded")) === "false"
  )
    await page
      .getByRole("button", { name: "Tùy chỉnh bút", exact: true })
      .click();
  await page.getByRole("button", { name: "Bút", exact: true }).click();
  await line(page);
  await expect(
    page.getByRole("button", { name: "Hoàn tác nét của tôi" }),
  ).toBeEnabled();
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Tải ảnh PNG" }).click();
  expect((await downloaded).suggestedFilename()).toMatch(/\.png$/);
  await page.getByRole("button", { name: "Thêm trang", exact: true }).click();
  await expect(page.getByLabel("Trang bảng trắng")).toHaveValue(/.+/);
  expect(
    await page.getByLabel("Trang bảng trắng").locator("option").count(),
  ).toBe(2);
  page.on("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Xóa trang", exact: true }).click();
  await expect(
    page.getByLabel("Trang bảng trắng").locator("option"),
  ).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "../../outputs/meet-whiteboard-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Đóng cho cả lớp" }).click();
  await page.getByLabel("Thêm tùy chọn", { exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "Viết lên màn hình chia sẻ",
      exact: true,
    }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Mở công cụ vẽ", exact: true })
    .click();
  await expect(
    page.getByLabel("Chú thích trên màn hình chia sẻ", { exact: true }),
  ).toBeVisible();
});

test("presentation has a direct annotation action, icon tools and fading ink", async ({
  page,
}) => {
  await enterDemo(page);
  await page
    .getByRole("button", { name: "Mở công cụ vẽ", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Tùy chỉnh bút", exact: true })
    .click();
  const canvas = page.getByLabel("Chú thích trên màn hình chia sẻ", {
    exact: true,
  });
  await expect(canvas).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Mũi tên", exact: true }).locator("svg"),
  ).toHaveCount(1);
  await page
    .getByRole("button", { name: "Ghi chú cố định", exact: true })
    .click();
  await page.getByLabel("Nội dung chữ trên bảng").fill("Ôn tập công thức");
  await page.getByRole("button", { name: "Thêm chữ ở giữa" }).click();
  await expect(
    page.getByRole("button", { name: "Hoàn tác nét của tôi" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Hình dán", exact: true }).click();
  await page.getByRole("button", { name: "Hình dán ✅", exact: true }).click();
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.7, box.y + box.height * 0.3);
  await expect(page.getByText(/Đang lưu…/)).toHaveCount(0);
  page.on("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Xóa nét trên trang", exact: true })
    .click();
  await page.getByRole("button", { name: "Mực biến mất", exact: true }).click();
  await line(page, "Chú thích trên màn hình chia sẻ");
  const alpha = () =>
    canvas.evaluate(
      (c: HTMLCanvasElement) =>
        c
          .getContext("2d")!
          .getImageData(
            Math.round(c.width * 0.4),
            Math.round(c.height * 0.45),
            1,
            1,
          ).data[3],
    );
  await expect.poll(alpha).toBeGreaterThan(0);
  await expect.poll(alpha, { timeout: 10000 }).toBe(0);
  await page.screenshot({
    path: "../../outputs/meet-annotation-icons.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Dừng chú thích", exact: true })
    .click();
  await expect(canvas).toHaveCount(0);
});

test("board and presentation share one main surface and retain content when switching", async ({
  page,
}) => {
  await enterDemo(page);
  const presentation = page.locator(".preview-stage");
  await expect(presentation).toBeVisible();
  await page.getByRole("button", { name: "Bảng trắng", exact: true }).click();
  await expect(presentation).toBeHidden();
  if (
    (await page
      .getByRole("button", { name: "Tùy chỉnh bút", exact: true })
      .getAttribute("aria-expanded")) === "false"
  )
    await page
      .getByRole("button", { name: "Tùy chỉnh bút", exact: true })
      .click();
  await page.getByRole("button", { name: "Bút", exact: true }).click();
  await line(page);
  await page
    .getByRole("button", { name: "Quay lại trình bày", exact: true })
    .click();
  await expect(presentation).toBeVisible();
  await expect(
    page.getByLabel("Bảng trắng dùng chung", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Bảng trắng", exact: true }).click();
  await expect(presentation).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Hoàn tác nét của tôi" }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Đóng cho cả lớp", exact: true })
    .click();
  await expect(presentation).toBeVisible();
  await page
    .getByRole("button", { name: "Mở công cụ vẽ", exact: true })
    .click();
  await expect(
    page.getByLabel("Chú thích trên màn hình chia sẻ", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Bảng trắng", exact: true }).click();
  await expect(
    page.getByLabel("Chú thích trên màn hình chia sẻ", { exact: true }),
  ).toHaveCount(0);
  await expect(presentation).toBeHidden();
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("meeting:drawing", {
        detail: { meeting: "preview", mode: "present" },
      }),
    ),
  );
  await expect(presentation).toBeVisible();
  await expect(
    page.getByLabel("Bảng trắng dùng chung", { exact: true }),
  ).toHaveCount(0);
});

test("Meet icon hints and labelled drawing menu support mouse, keyboard and mobile", async ({
  page,
}) => {
  await enterDemo(page);
  await page.getByRole("button", { name: "Tắt mic", exact: true }).hover();
  await expect(page.getByRole("tooltip")).toHaveText("Tắt mic");
  await page.getByRole("button", { name: "Bảng trắng", exact: true }).click();
  await page.getByLabel("Chọn công cụ viết vẽ", { exact: true }).click();
  const menu = page.getByRole("menu", { name: "Danh sách công cụ viết vẽ" });
  await expect(
    menu.getByRole("menuitemradio", { name: "Ghi chú cố định" }),
  ).toBeVisible();
  await menu.getByRole("menuitemradio", { name: "Ghi chú cố định" }).click();
  await expect(
    page.getByRole("button", { name: "Ghi chú cố định", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.setViewportSize({ width: 390, height: 520 });
  await page
    .getByLabel("Chọn công cụ viết vẽ", { exact: true })
    .evaluate((el) => window.scrollBy(0, el.getBoundingClientRect().top - 265));
  await page.getByLabel("Chọn công cụ viết vẽ", { exact: true }).click();
  await expect
    .poll(async () => {
      const r = await menu.boundingBox();
      return !!r && r.y >= 8 && r.y + r.height <= 512;
    })
    .toBe(true);
  await menu
    .getByRole("menuitem", { name: "Đường kẻ và hình dạng", exact: true })
    .click();
  await menu
    .getByRole("menuitemradio", { name: "Mũi tên", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Mũi tên", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByLabel("Chọn công cụ viết vẽ", { exact: true }).click();
  await page.keyboard.press("End");
  await expect(
    menu.getByRole("menuitem", { name: "Đóng bảng cho cả lớp", exact: true }),
  ).toBeFocused();
  await menu.getByRole("menuitemradio", { name: "Tẩy", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Tẩy", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({
    path: "../../outputs/meet-surface-tools-mobile.png",
    fullPage: true,
  });
});

test("two participants receive persisted drawings and teacher permission changes", async ({
  browser,
}) => {
  let state = emptyDrawing(),
    revision = 0;
  const teacher = await browser.newPage(),
    student = await browser.newPage();
  const meeting = {
    id: "ink-room",
    title: "Kiểm thử bảng trắng",
    status: "live",
    starts_at: new Date().toISOString(),
    course: "Toán",
    class_name: "10A1",
    recording_allowed: false,
  };
  const install = async (page: Page, role: string) =>
    page.route("**/api/**", async (route) => {
      const req = route.request(),
        path = new URL(req.url()).pathname;
      let data: any = [];
      if (path === "/api/me")
        data = { id: role, school_id: "school", role, name: role };
      else if (path === "/api/setup/status") data = { initialized: true };
      else if (path === "/api/meetings") data = [meeting];
      else if (path === "/api/meetings/ink-room")
        data = {
          ...meeting,
          can_manage: role === "teacher",
          admission: "admitted",
          rules: {
            lobby: false,
            chat_enabled: true,
            present_enabled: true,
            revision: 0,
          },
        };
      else if (path.endsWith("/drawing")) {
        if (req.method() === "POST") {
          const input = req.postDataJSON();
          if (input.action === "open_board") {
            state.active = true;
            state.mode = "board";
            state.control_revision++;
          } else if (input.action === "allow") {
            state.allow_students = input.allow_students;
            state.control_revision++;
          } else if (input.action === "stroke") {
            const p = state.pages[0],
              stroke = { ...input.stroke, owner: role };
            p.strokes = [
              ...p.strokes.filter((s) => s.id !== stroke.id),
              stroke,
            ];
          }
          revision++;
        }
        data = { state: structuredClone(state), revision, targets: [] };
      } else if (req.method() === "POST")
        data = path.endsWith("/admission")
          ? { admission: "admitted" }
          : { ok: true };
      await route.fulfill({ json: data });
    });
  await install(teacher, "teacher");
  await install(student, "student");
  await teacher.goto("/?room=ink-room");
  await student.goto("/?room=ink-room");
  await teacher
    .getByRole("button", { name: "Vào lớp học", exact: true })
    .click();
  await student
    .getByRole("button", { name: "Vào lớp học", exact: true })
    .click();
  for (const p of [teacher, student]) {
    await p.locator(".video-grid").evaluate((el) => {
      const screen = document.createElement("article");
      screen.dataset.presentation = "teacher";
      screen.textContent = "Màn hình kiểm thử";
      el.append(screen);
    });
    await expect(p.locator('[data-presentation="teacher"]')).toHaveCount(1);
    await expect(p.locator('[data-presentation="teacher"]')).toBeVisible();
  }
  await teacher
    .getByRole("button", { name: "Bảng trắng", exact: true })
    .click();
  await expect(
    student.getByLabel("Bảng trắng dùng chung", { exact: true }),
  ).toBeVisible();
  await expect(teacher.locator('[data-presentation="teacher"]')).toBeHidden();
  await expect(student.locator('[data-presentation="teacher"]')).toBeHidden();
  await teacher
    .getByRole("button", { name: "Tùy chỉnh bút", exact: true })
    .click();
  await student
    .getByRole("button", { name: "Tùy chỉnh bút", exact: true })
    .click();
  await expect(
    student.getByRole("button", { name: "Bút", exact: true }),
  ).toBeDisabled();
  await teacher.getByRole("checkbox", { name: "Cho học sinh cùng vẽ" }).click();
  await expect(
    student.getByRole("button", { name: "Bút", exact: true }),
  ).toBeEnabled();
  await student.getByRole("button", { name: "Bút", exact: true }).click();
  await line(student);
  await expect.poll(() => state.pages[0].strokes.length).toBe(1);
  await expect
    .poll(() =>
      teacher
        .getByLabel("Bảng trắng dùng chung", { exact: true })
        .evaluate((c: HTMLCanvasElement) =>
          Array.from(
            c
              .getContext("2d")!
              .getImageData(
                Math.floor(c.width * 0.4),
                Math.floor(c.height * 0.45),
                1,
                1,
              ).data,
          )
            .slice(0, 3)
            .some((v) => v < 200),
        ),
    )
    .toBe(true);
  await student.reload({ waitUntil: "domcontentloaded" });
  await expect(
    student.getByLabel("Bảng trắng dùng chung", { exact: true }),
  ).toBeVisible();
  expect(state.pages[0].strokes.length).toBe(1);
  await student
    .getByRole("button", { name: "Tùy chỉnh bút", exact: true })
    .click();
  await teacher.getByRole("checkbox", { name: "Cho học sinh cùng vẽ" }).click();
  await expect(
    student.getByRole("button", { name: "Bút", exact: true }),
  ).toBeDisabled();
  await teacher.close();
  await student.close();
});

test("annotation menu groups colors and stamps and controls class permissions", async ({
  page,
}) => {
  await enterDemo(page);
  await page
    .getByRole("button", { name: "Mở công cụ vẽ", exact: true })
    .click();
  const open = () =>
    page.getByLabel("Chọn công cụ viết vẽ", { exact: true }).click();
  const menu = page.getByRole("menu", { name: "Danh sách công cụ viết vẽ" });
  await open();
  await menu.getByRole("menuitem", { name: "Màu", exact: true }).click();
  await menu
    .getByRole("menuitemradio", { name: "Xanh lá", exact: true })
    .click();
  await expect(page.getByLabel("Màu bút", { exact: true })).toHaveValue(
    "#34A853",
  );
  await open();
  await menu.getByRole("menuitem", { name: "Hình dán", exact: true }).click();
  await menu
    .getByRole("menuitem", { name: "Hình dán ✅", exact: true })
    .click();
  await expect(
    page.getByLabel("Chọn công cụ viết vẽ", { exact: true }),
  ).toHaveAttribute("aria-description", "Công cụ đang chọn: Hình dán");
  await open();
  const allow = menu.getByRole("menuitemcheckbox", {
    name: "Cho phép người khác chú thích",
    exact: true,
  });
  await expect(allow).toHaveAttribute("aria-checked", "false");
  await allow.click();
  await expect(allow).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await open();
  await menu
    .getByRole("menuitem", { name: "Đường kẻ và hình dạng", exact: true })
    .click();
  await page.keyboard.press("Escape");
  await expect(
    menu.getByRole("menuitem", { name: "Màu", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Chú thích trên màn hình chia sẻ", { exact: true })
    .click({ position: { x: 200, y: 100 } });
  await expect(menu).toBeHidden();
  await open();
  await menu
    .getByRole("menuitem", { name: "Dừng chú thích", exact: true })
    .click();
  await expect(
    page.getByLabel("Chú thích trên màn hình chia sẻ", { exact: true }),
  ).toHaveCount(0);
});

test("compact annotation dock leaves the shared canvas usable on short phones", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 520 });
  await enterDemo(page);
  await page
    .getByRole("button", { name: "Mở công cụ vẽ", exact: true })
    .click();
  await expect(page.locator(".drawing-compact")).toBeVisible();
  await page.getByLabel("Chọn công cụ viết vẽ", { exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Bút", exact: true }).click();
  await line(page, "Chú thích trên màn hình chia sẻ");
  await expect(
    page.getByRole("button", { name: "Hoàn tác nét của tôi", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Tùy chỉnh bút", exact: true })
    .click();
  await expect(
    page.getByRole("toolbar", { name: "Bút và hình vẽ" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Tùy chỉnh bút", exact: true })
    .click();
  await expect(
    page.getByRole("toolbar", { name: "Bút và hình vẽ" }),
  ).toBeHidden();
});

test("floating pen uses an icon only and board menu stays inside narrow phone edges", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 520 });
  await enterDemo(page);
  const pen = page.getByRole("button", { name: "Mở công cụ vẽ", exact: true });
  await expect(pen).toBeVisible();
  await expect(pen).toHaveText("");
  await pen.click();
  await expect(page.locator(".drawing-compact")).toBeVisible();
  await expect(
    page.getByLabel("Chú thích trên màn hình chia sẻ", { exact: true }),
  ).toBeVisible();
  await expect(pen).toHaveCount(0);
  await page.getByLabel("Chọn công cụ viết vẽ", { exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Dừng chú thích", exact: true })
    .click();
  await expect(pen).toBeVisible();
  await page.getByLabel("Thêm tùy chọn", { exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "Viết lên màn hình chia sẻ",
      exact: true,
    }),
  ).toHaveCount(0);
  await page
    .locator(".meeting-menu")
    .getByRole("button", { name: "Bảng trắng", exact: true })
    .click();
  await expect(page.locator(".drawing-compact")).toBeVisible();
  await page.getByLabel("Chọn công cụ viết vẽ", { exact: true }).click();
  await expect
    .poll(async () => {
      const r = await page
        .getByRole("menu", { name: "Danh sách công cụ viết vẽ" })
        .boundingBox();
      return (
        !!r &&
        r.x >= 0 &&
        r.x + r.width <= 390 &&
        r.y >= 0 &&
        r.y + r.height <= 520
      );
    })
    .toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
