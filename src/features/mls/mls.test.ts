import { describe, expect, it } from "vitest";

import { mlsSelfTest } from "./mls";

describe("MLS engine", () => {
  it("creates a group, welcomes a member, and decrypts an app message", async () => {
    await expect(mlsSelfTest()).resolves.toBe(true);
  }, 20_000);
});
