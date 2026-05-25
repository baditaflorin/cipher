/**
 * Mobile responsiveness tests.
 * Runs with an iPhone-sized viewport to verify the two-panel layout:
 *   - No room selected  → sidebar fills the screen
 *   - Room selected     → chat fills the screen; back button visible
 *   - Back button       → returns to the sidebar
 */
import { expect, test, type Page } from "playwright/test";

const MOBILE = { width: 390, height: 844 } as const;

test.use({ viewport: MOBILE });

/** Dismiss the first-launch onboarding overlay if it appears. */
async function dismissOnboarding(page: Page) {
  const overlay = page.locator('[data-testid="onboarding"]');
  try {
    await overlay.waitFor({ state: "visible", timeout: 8_000 });
    await page.getByRole("button", { name: "Get started" }).click();
    await overlay.waitFor({ state: "hidden", timeout: 3_000 });
  } catch {
    // Onboarding not shown (returning user context) — continue normally
  }
}

test.describe("mobile layout", () => {
  test("sidebar fills the viewport when no room is selected", async ({ page }) => {
    await page.goto("/cipher/");
    await dismissOnboarding(page);

    const sidebar = page.locator("aside");
    await expect(sidebar).toBeVisible();

    // Sidebar should span (roughly) the full mobile width
    const box = await sidebar.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(MOBILE.width * 0.9);

    // Chat panel should not be rendered
    await expect(page.locator("main")).not.toBeVisible();
  });

  test("chat fills the viewport after selecting a room", async ({ page }) => {
    await page.goto("/cipher/");
    await dismissOnboarding(page);

    // Create a room
    await page.getByLabel("Group name").fill("Mobile test");
    await page.getByRole("button", { name: "Create room" }).click();

    // Chat should now fill the screen
    const main = page.locator("main");
    await expect(main).toBeVisible({ timeout: 5_000 });

    const box = await main.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(MOBILE.width * 0.9);

    // Sidebar should be hidden
    await expect(page.locator("aside")).not.toBeVisible();
  });

  test("back button is visible in the room header on mobile", async ({ page }) => {
    await page.goto("/cipher/");
    await dismissOnboarding(page);

    await page.getByLabel("Group name").fill("Back-btn test");
    await page.getByRole("button", { name: "Create room" }).click();
    await expect(page.locator("main")).toBeVisible({ timeout: 5_000 });

    await expect(page.locator('button[title="Back to rooms"]')).toBeVisible();
  });

  test("back button returns to the room list", async ({ page }) => {
    await page.goto("/cipher/");
    await dismissOnboarding(page);

    await page.getByLabel("Group name").fill("Back nav test");
    await page.getByRole("button", { name: "Create room" }).click();
    await expect(page.locator("main")).toBeVisible({ timeout: 5_000 });

    await page.locator('button[title="Back to rooms"]').click();

    await expect(page.locator("aside")).toBeVisible({ timeout: 3_000 });
    await expect(page.locator("main")).not.toBeVisible();
  });

  test("can send a message on mobile", async ({ page }) => {
    await page.goto("/cipher/");
    await dismissOnboarding(page);

    await page.getByLabel("Group name").fill("Chat test");
    await page.getByRole("button", { name: "Create room" }).click();
    await expect(page.locator("main")).toBeVisible({ timeout: 5_000 });

    await page.getByPlaceholder("Write an encrypted message").fill("hello mobile");
    await page.getByRole("button", { name: "Send" }).click();

    await expect(page.getByText("hello mobile")).toBeVisible({ timeout: 5_000 });
  });
});
