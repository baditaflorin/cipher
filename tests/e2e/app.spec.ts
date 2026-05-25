import { expect, test, type Page } from "playwright/test";

/** Dismiss the first-launch onboarding overlay if it appears. */
async function dismissOnboarding(page: Page) {
  const overlay = page.locator('[data-testid="onboarding"]');
  try {
    // Wait up to 8 s for the onboarding to render (app boot is async)
    await overlay.waitFor({ state: "visible", timeout: 8_000 });
    await page.getByRole("button", { name: "Get started" }).click();
    await overlay.waitFor({ state: "hidden", timeout: 3_000 });
  } catch {
    // Onboarding not shown (returning user context) — continue normally
  }
}

test("loads the app and creates a room", async ({ page }) => {
  await page.goto("/cipher/");
  await dismissOnboarding(page);

  // Sidebar heading is always visible
  await expect(page.getByText("Cipher")).toBeVisible();

  // Create a room via the sidebar input + button
  await page.getByLabel("Group name").fill("Smoke room");
  await page.getByRole("button", { name: "Create room" }).click();

  // Chat header appears
  await expect(page.getByRole("heading", { name: "Smoke room" })).toBeVisible();

  // Type and send a message
  await page.getByPlaceholder("Write an encrypted message").fill("hello from smoke");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("hello from smoke")).toBeVisible();
});
