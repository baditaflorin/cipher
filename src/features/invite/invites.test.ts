import { describe, expect, it } from "vitest";
import { checkInviteValidity } from "./validity";

const HOUR_MS = 60 * 60 * 1000;

describe("checkInviteValidity", () => {
  it("accepts a fresh, unused invite", () => {
    const now = new Date("2026-05-12T12:00:00Z");
    const result = checkInviteValidity(
      {
        expiresAt: new Date(now.getTime() + HOUR_MS).toISOString()
      },
      now
    );
    expect(result).toEqual({ ok: true });
  });

  it("rejects an expired invite and reports the original expiry", () => {
    const now = new Date("2026-05-12T12:00:00Z");
    const expiresAt = new Date(now.getTime() - HOUR_MS).toISOString();
    const result = checkInviteValidity({ expiresAt }, now);
    expect(result).toEqual({ ok: false, reason: "expired", expiresAt });
  });

  it("rejects an invite that's already been accepted, even if not yet expired", () => {
    const now = new Date("2026-05-12T12:00:00Z");
    const usedAt = new Date(now.getTime() - 60 * 1000).toISOString();
    const result = checkInviteValidity(
      {
        expiresAt: new Date(now.getTime() + HOUR_MS).toISOString(),
        usedAt
      },
      now
    );
    expect(result).toEqual({ ok: false, reason: "used", usedAt });
  });

  it("treats the used flag as a hard stop even after the expiry has passed", () => {
    // Pre-keys are single-use by design; once consumed, the invite can
    // never be re-accepted no matter how the clock looks.
    const now = new Date("2026-05-12T12:00:00Z");
    const usedAt = new Date(now.getTime() - 2 * HOUR_MS).toISOString();
    const expiresAt = new Date(now.getTime() - HOUR_MS).toISOString();
    const result = checkInviteValidity({ expiresAt, usedAt }, now);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // The used flag wins over the expired flag so the operator sees
      // the more accurate reason for the failure.
      expect(result.reason).toBe("used");
    }
  });

  it("treats exactly-at-expiry as still valid (inclusive end)", () => {
    // The expiry timestamp itself is the last instant the invite works;
    // we round in the user's favour rather than firing a 1ms race.
    const expiresAt = "2026-05-12T12:00:00.000Z";
    const result = checkInviteValidity({ expiresAt }, new Date(expiresAt));
    expect(result.ok).toBe(true);
  });
});
