import type { IdentityRecord, Participant } from "../chat/types";
import { randomId } from "../crypto/base64";
import { createBoxKeyPair, createSigningKeyPair } from "../crypto/sodium";
import { getActiveIdentity, saveIdentity } from "../storage/db";

function defaultDisplayName(): string {
  return `Operator ${Math.floor(1000 + Math.random() * 9000)}`;
}

export function toParticipant(identity: IdentityRecord): Participant {
  return {
    id: identity.id,
    displayName: identity.displayName,
    boxPublicKey: identity.boxPublicKey,
    signPublicKey: identity.signPublicKey,
    joinedAt: identity.joinedAt
  };
}

export async function getOrCreateIdentity(): Promise<IdentityRecord> {
  const existing = await getActiveIdentity();
  if (existing) return existing;

  const [box, signing] = await Promise.all([
    createBoxKeyPair(),
    createSigningKeyPair()
  ]);
  const now = new Date().toISOString();

  const identity: IdentityRecord = {
    id: randomId("id"),
    displayName: defaultDisplayName(),
    boxPublicKey: box.publicKey,
    boxSecretKey: box.secretKey,
    signPublicKey: signing.publicKey,
    signSecretKey: signing.secretKey,
    createdAt: now,
    joinedAt: now
  };

  await saveIdentity(identity);
  return identity;
}

export async function updateDisplayName(
  identity: IdentityRecord,
  displayName: string
): Promise<IdentityRecord> {
  const updated = {
    ...identity,
    displayName: displayName.trim() || identity.displayName
  };
  await saveIdentity(updated);
  return updated;
}
