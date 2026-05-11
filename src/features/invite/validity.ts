import type { InviteRecord } from "../chat/types";

/**
 * Decision shape for invite validity. Surfaced separately so the UI and
 * `openJoinRequestCapsule` share a single source of truth — and so a
 * unit test can exercise the rule without depending on IndexedDB or the
 * sealed-box plumbing.
 */
export type InviteValidity =
  | { ok: true }
  | { ok: false; reason: "expired"; expiresAt: string }
  | { ok: false; reason: "used"; usedAt: string };

export function checkInviteValidity(
  invite: Pick<InviteRecord, "expiresAt" | "usedAt">,
  now: Date = new Date()
): InviteValidity {
  // An invite that's already been accepted must not be replayable — even
  // if the host re-shares the original link by mistake. The pre-key is
  // single-use by design, so the used flag wins over the expiry check
  // (a stale-but-used invite still reads as `used`, the more accurate
  // failure reason for the host to act on).
  if (invite.usedAt) {
    return { ok: false, reason: "used", usedAt: invite.usedAt };
  }
  // The expiry stamp is plaintext inside the capsule, but we trust the
  // recipient's own copy of the invite (stored in IndexedDB at creation
  // time). Comparing against that closes the door on a malicious peer
  // forwarding a stale link with a hand-edited `expiresAt`.
  if (Date.parse(invite.expiresAt) < now.getTime()) {
    return { ok: false, reason: "expired", expiresAt: invite.expiresAt };
  }
  return { ok: true };
}
