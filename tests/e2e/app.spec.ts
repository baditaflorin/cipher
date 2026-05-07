import { expect, test } from "playwright/test";

test("loads the static app and creates a group", async ({ page }) => {
  await page.goto("/cipher/");
  await expect(page.getByRole("heading", { name: "Cipher" })).toBeVisible();
  await expect(page.getByText("No server-held state")).toBeVisible();

  await page.getByRole("button", { name: "New group" }).click();
  await page.getByLabel("Group name").fill("Smoke room");
  await page.getByRole("button", { name: "Create room" }).click();

  await expect(page.getByRole("heading", { name: "Smoke room" })).toBeVisible();
  await page.getByPlaceholder("Write an encrypted message").fill("hello from smoke");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("hello from smoke")).toBeVisible();
});
