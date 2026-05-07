import { describe, expect, it } from "vitest";

import { summarizeThread } from "./localAi";

describe("local AI fallback", () => {
  it("summarizes short threads without loading a model", async () => {
    const result = await summarizeThread([
      {
        id: "1",
        groupId: "g",
        body: "Bring banners at 5pm.",
        senderId: "a",
        senderName: "Ana",
        createdAt: new Date().toISOString(),
        kind: "text",
        verified: true
      }
    ]);

    expect(result.summary).toContain("Bring banners");
  });
});
