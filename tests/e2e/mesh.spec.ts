/**
 * Two-browser mesh tests.
 *
 * These tests require the y-webrtc signaling server (wss://turn.0docker.com/ws)
 * to be reachable, so they are kept in a separate file and NOT part of the
 * pre-commit smoke suite. Run explicitly with:
 *
 *   npm run test:e2e:mesh
 */
import { expect, test } from "playwright/test";
import * as path from "node:path";
import * as fs from "node:fs";

test.describe("room-link two-browser join", () => {
  test("both browsers see each other as participants and can exchange messages", async ({
    browser
  }) => {
    // WebRTC handshake + y-webrtc sync can take several seconds.
    test.setTimeout(90_000);

    const screenshotDir = path.resolve("test-results/mesh-screenshots");
    fs.mkdirSync(screenshotDir, { recursive: true });

    // ---- Browser A: host -----------------------------------------------
    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();

    const errorsA: string[] = [];
    pageA.on("console", (msg) => {
      if (msg.type() === "error") errorsA.push(msg.text());
    });

    await pageA.goto("/cipher/");
    await expect(pageA.getByRole("heading", { name: "Cipher" })).toBeVisible();

    // Create a room.
    await pageA.getByLabel("Group name").fill("Mesh sync test");
    await pageA.getByRole("button", { name: "Create room" }).click();
    await expect(pageA.getByRole("heading", { name: "Mesh sync test" })).toBeVisible();

    // Click Share → wait for the Share Room panel → extract link via DOM eval
    // (more reliable than Playwright textarea text-filter which may miss React values).
    await pageA.getByRole("button", { name: "Share" }).click();
    await pageA.getByText("Share Room").waitFor({ timeout: 10_000 });

    const roomLink = await pageA.evaluate((): string => {
      const textareas =
        document.querySelectorAll<HTMLTextAreaElement>("textarea[readonly]");
      for (const ta of textareas) {
        if (ta.value.includes("#/room/")) return ta.value;
      }
      return "";
    });

    console.log(
      "[DEBUG] roomLink =",
      roomLink ? roomLink.slice(0, 80) + "…" : "(empty)"
    );
    expect(roomLink, "room link must be non-empty").toBeTruthy();
    expect(roomLink).toContain("#/room/");

    await pageA.screenshot({ path: path.join(screenshotDir, "a-share-panel.png") });

    // ---- Browser B: joiner -----------------------------------------------
    // IMPORTANT: navigate directly to the room link in a fresh context.
    // Going to /cipher/ first then changing the hash would be a same-page hash
    // navigation (no reload), so boot() would never see the #/room/ fragment.
    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();

    const errorsB: string[] = [];
    pageB.on("console", (msg) => {
      if (msg.type() === "error") errorsB.push(`[${msg.type()}] ${msg.text()}`);
    });

    await pageB.goto(roomLink);
    await pageB.waitForLoadState("domcontentloaded");

    await pageB.screenshot({ path: path.join(screenshotDir, "b-after-room-link.png") });

    const headings = await pageB.evaluate(() =>
      [...document.querySelectorAll("h1,h2,h3")].map(
        (h) => `${h.tagName}: ${h.textContent}`
      )
    );
    const notices = await pageB.evaluate(() =>
      [...document.querySelectorAll("[class*='notice']")].map((n) => n.textContent)
    );
    console.log("[DEBUG] pageB headings:", headings);
    console.log("[DEBUG] pageB notices:", notices);
    if (errorsB.length) console.log("[DEBUG] pageB errors:", errorsB.slice(0, 5));

    // Auto-join should have fired; the room heading should appear.
    await expect(pageB.getByRole("heading", { name: "Mesh sync test" })).toBeVisible({
      timeout: 20_000
    });

    await pageB.screenshot({ path: path.join(screenshotDir, "b-room-joined.png") });

    // ---- Verify participant sync ----------------------------------------
    // Both peers write their identity into the shared Y.Doc participants map.
    // y-webrtc syncs it; both sides should show "2 participants".
    await expect(pageA.getByText("2 participants")).toBeVisible({ timeout: 45_000 });
    await expect(pageB.getByText("2 participants")).toBeVisible({ timeout: 45_000 });

    await pageA.screenshot({ path: path.join(screenshotDir, "a-2-participants.png") });
    await pageB.screenshot({ path: path.join(screenshotDir, "b-2-participants.png") });

    // ---- Verify message delivery in both directions ----------------------
    await pageA.getByPlaceholder("Write an encrypted message").fill("hello from A");
    await pageA.getByRole("button", { name: "Send" }).click();
    await expect(pageB.getByText("hello from A")).toBeVisible({ timeout: 20_000 });

    await pageB.getByPlaceholder("Write an encrypted message").fill("hello from B");
    await pageB.getByRole("button", { name: "Send" }).click();
    await expect(pageA.getByText("hello from B")).toBeVisible({ timeout: 20_000 });

    await pageA.screenshot({ path: path.join(screenshotDir, "a-final.png") });
    await pageB.screenshot({ path: path.join(screenshotDir, "b-final.png") });

    if (errorsA.length) console.log("[DEBUG] pageA errors:", errorsA.slice(0, 5));

    await ctxA.close();
    await ctxB.close();
  });
});
