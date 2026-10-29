import { test, expect } from "@playwright/test";

for (const [role,initialStatus] of [["teacher","live"],["student","live"],["teacher","scheduled"]]) {
  test(`${role} ${initialStatus}: lesson recording preference and call controls`, async ({
    page,
  }) => {
    let enabled = true,
      fail = false,
      changes = 0;
    const lesson = {
      id: "lesson",
      title: "Buổi học",
      status: initialStatus,
      course_id: "math",
      starts_at: new Date().toISOString(),
      short_code: "abc123",
    };
    await page.route("**/api/**", async (route) => {
      const req = route.request(),
        p = new URL(req.url()).pathname;
      let data: any = [];
      if (p === "/api/setup/status") data = { initialized: true };
      else if (p === "/api/me")
        data = { id: role, school_id: "school", name: role, role };
      else if (p === "/api/meetings")
        data = [{ ...lesson, recording_allowed: enabled }];
      else if (p === "/api/meetings/lesson")
        data = {
          ...lesson,
          recording_allowed: enabled,
          can_manage: role === "teacher",
          admission: "admitted",
          server_recording: { state: enabled ? "recording" : "stopped" },
        };
      else if (p.endsWith("/admission")) data = { admission: "admitted" };
      else if (p.endsWith("/recording-control")) {
        changes++;
        if (fail) {
          await route.fulfill({
            status: 503,
            json: { error: "Không lưu được ghi hình" },
          });
          return;
        }
        enabled = req.postDataJSON().enabled;
        data = { recording_allowed: enabled };
      } else if (req.method() === "POST") data = { ok: true };
      await route.fulfill({ json: data });
    });
    await page.setViewportSize({ width: 320, height: 680 });
    await page.goto("/?room=lesson");
    const preview=await page.locator('.prejoin-media').boundingBox();
    for(const button of await page.locator('.prejoin-device-icons button').all()){
      const r=await button.boundingBox();expect(r!.x).toBeGreaterThanOrEqual(preview!.x);expect(r!.x+r!.width).toBeLessThanOrEqual(preview!.x+preview!.width+1);expect(r!.y+r!.height).toBeLessThanOrEqual(preview!.y+preview!.height+1);
    }
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.getByLabel("Thêm tùy chọn", { exact: true }).click();
    const box = page.getByRole("checkbox", {
      name: "Ghi hình khi giáo viên vào lớp",
    });
    if (role === "teacher") {
      await expect(box).toBeChecked();
      await box.click();
      await expect.poll(() => enabled).toBe(false);
      await expect(box).not.toBeChecked();
      fail = true;
      await box.click();
      await expect(page.getByRole("alert")).toContainText(
        "Không lưu được ghi hình",
      );
      await expect(box).not.toBeChecked();
      fail = false;
    } else {
      await expect(box).toHaveCount(0);
    }
    await page.keyboard.press("Escape");
    if(initialStatus==="scheduled") await page.getByRole("button",{name:"Bắt đầu buổi học",exact:true}).click();
    await page
      .getByRole("button", { name: "Vào lớp học", exact: true })
      .click();
    if (role === "teacher") {
      await page
        .getByRole("button", { name: "Bắt đầu ghi hình", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Dừng ghi hình", exact: true }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Dừng ghi hình", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Bắt đầu ghi hình", exact: true }),
      ).toBeVisible();
      expect(changes).toBe(4);
    } else {
      await expect(page.locator(".meeting-recording-toggle")).toHaveCount(0);
      expect(changes).toBe(0);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}
