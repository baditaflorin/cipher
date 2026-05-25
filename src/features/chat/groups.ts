import * as Y from "yjs";

import type {
  ChatPlaintext,
  DecryptedChatRecord,
  EncryptedChatRecord,
  GroupRecord,
  IdentityRecord,
  Participant
} from "./types";
import { randomId } from "../crypto/base64";
import {
  decryptJsonWithKey,
  encryptJsonWithKey,
  randomSecretKey,
  signDetached,
  verifyDetached
} from "../crypto/sodium";
import { toParticipant } from "../identity/identity";
import { saveGroup } from "../storage/db";

const messagesKey = "messages";
const participantsKey = "participants";
const clearsKey = "clears";

interface ClearCommand {
  timestamp: string;
  ownerId: string;
  /** signDetached of `${groupId}.clear.${timestamp}` with the owner's signSecretKey */
  signature: string;
}

export async function createGroupRecord(
  identity: IdentityRecord,
  name: string
): Promise<GroupRecord> {
  const now = new Date().toISOString();
  const id = randomId("grp");
  const participant = toParticipant(identity);
  const group: GroupRecord = {
    id,
    name: name.trim() || "Untitled room",
    createdAt: now,
    updatedAt: now,
    groupKey: await randomSecretKey(),
    ownerId: identity.id,
    participants: [participant],
    mlsState: await import("../mls/mls").then((mls) =>
      mls.createMlsGroupState(identity, id)
    )
  };

  await saveGroup(group);
  return group;
}

export function createDocFromGroup(group: GroupRecord): Y.Doc {
  const doc = new Y.Doc();
  if (group.yState) {
    Y.applyUpdate(doc, decodeYUpdate(group.yState), "storage");
  }
  doc.getArray<EncryptedChatRecord>(messagesKey);
  return doc;
}

export function encodeDocState(doc: Y.Doc): string {
  return encodeYUpdate(Y.encodeStateAsUpdate(doc));
}

export function getEncryptedMessages(doc: Y.Doc): EncryptedChatRecord[] {
  return doc.getArray<EncryptedChatRecord>(messagesKey).toArray();
}

export async function addPlaintextMessage(
  doc: Y.Doc,
  group: GroupRecord,
  identity: IdentityRecord,
  body: string,
  kind: ChatPlaintext["kind"] = "text"
): Promise<EncryptedChatRecord> {
  const trimmed = body.trim();
  if (!trimmed) throw new Error("Message body is empty.");

  const now = new Date().toISOString();
  const plaintext: ChatPlaintext = {
    id: randomId("msg"),
    groupId: group.id,
    body: trimmed,
    senderId: identity.id,
    senderName: identity.displayName,
    createdAt: now,
    kind
  };
  const encrypted = await encryptJsonWithKey(group.groupKey, plaintext, group.id);
  const signaturePayload = `${group.id}.${encrypted.nonce}.${encrypted.ciphertext}`;
  const record: EncryptedChatRecord = {
    id: plaintext.id,
    groupId: group.id,
    senderId: identity.id,
    nonce: encrypted.nonce,
    ciphertext: encrypted.ciphertext,
    signature: await signDetached(identity.signSecretKey, signaturePayload),
    createdAt: now
  };

  doc.getArray<EncryptedChatRecord>(messagesKey).push([record]);
  return record;
}

export async function decryptMessage(
  group: GroupRecord,
  record: EncryptedChatRecord
): Promise<DecryptedChatRecord> {
  const participant = group.participants.find((item) => item.id === record.senderId);
  const signaturePayload = `${group.id}.${record.nonce}.${record.ciphertext}`;
  const verified = participant
    ? await verifyDetached(
        participant.signPublicKey,
        record.signature,
        signaturePayload
      )
    : false;
  const plaintext = await decryptJsonWithKey<ChatPlaintext>(
    group.groupKey,
    { nonce: record.nonce, ciphertext: record.ciphertext },
    group.id
  );

  return { ...plaintext, verified };
}

export async function decryptMessages(
  group: GroupRecord,
  records: EncryptedChatRecord[]
): Promise<DecryptedChatRecord[]> {
  const decrypted = await Promise.all(
    records
      .slice()
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map((record) => decryptMessage(group, record))
  );
  return decrypted;
}

export function upsertParticipant(
  group: GroupRecord,
  participant: Participant
): GroupRecord {
  const participants = group.participants.some((item) => item.id === participant.id)
    ? group.participants.map((item) =>
        item.id === participant.id ? participant : item
      )
    : [...group.participants, participant];

  return {
    ...group,
    participants,
    updatedAt: new Date().toISOString()
  };
}

/**
 * Write a participant into the shared Y.Doc participants map.
 * The map uses participantId as key → JSON-serialised Participant as value.
 * y-webrtc syncs it automatically so every peer sees everyone who has ever
 * connected to this room, even if they are currently offline.
 */
export function writeParticipantToDoc(doc: Y.Doc, participant: Participant): void {
  doc.getMap<string>(participantsKey).set(participant.id, JSON.stringify(participant));
}

/**
 * Read all participants stored in the Y.Doc (by all peers, past or present).
 */
export function readParticipantsFromDoc(doc: Y.Doc): Participant[] {
  const map = doc.getMap<string>(participantsKey);
  const result: Participant[] = [];
  map.forEach((json) => {
    try {
      result.push(JSON.parse(json) as Participant);
    } catch {
      /* ignore malformed entries */
    }
  });
  return result;
}

/**
 * Post a signed "delete history" command to the shared Yjs doc, then
 * immediately delete all matching messages from the Y.Array.
 *
 * The Y.Array.delete() is a real CRDT operation: it propagates to every
 * connected peer via y-webrtc and is baked into the yState snapshot, so
 * future joiners also receive a doc that no longer contains the deleted
 * messages.  The signed command in the `clears` map is the authorisation
 * record — peers that receive the update verify it and delete any
 * stragglers that arrived out-of-order after the clear.
 *
 * Only the room owner can produce a valid signature, so non-owners cannot
 * trigger a delete even if they bypass the UI.
 */
export async function postClearCommand(
  doc: Y.Doc,
  group: GroupRecord,
  identity: IdentityRecord
): Promise<void> {
  if (identity.id !== group.ownerId) {
    throw new Error("Only the room owner can delete history.");
  }
  const timestamp = new Date().toISOString();
  const payload = `${group.id}.clear.${timestamp}`;
  const signature = await signDetached(identity.signSecretKey, payload);
  const cmd: ClearCommand = { timestamp, ownerId: identity.id, signature };
  doc.getMap<string>(clearsKey).set("v1", JSON.stringify(cmd));
  // Actually remove the message content from the CRDT array.
  deleteMessagesBefore(doc, timestamp);
}

/**
 * Delete all messages with createdAt ≤ cutoff from the shared Y.Array.
 * Safe to call multiple times — a no-op when the array is already empty.
 * Wrapped in a single Yjs transaction so peers receive one atomic update.
 */
export function deleteMessagesBefore(doc: Y.Doc, cutoff: string): void {
  const arr = doc.getArray<EncryptedChatRecord>(messagesKey);
  // Collect indices in reverse so earlier deletions don't shift later ones.
  const toDelete: number[] = [];
  arr.forEach((msg, i) => {
    if (msg.createdAt <= cutoff) toDelete.push(i);
  });
  if (toDelete.length === 0) return;
  doc.transact(() => {
    for (let i = toDelete.length - 1; i >= 0; i--) {
      arr.delete(toDelete[i], 1);
    }
  });
}

/**
 * Read and cryptographically verify the latest delete command from the doc.
 *
 * Returns the cutoff timestamp if the signature is valid (signed by the
 * actual room owner), or null otherwise.  Used by peers to delete any
 * out-of-order straggler messages that arrived after the owner's clear.
 */
export async function getVerifiedClearTimestamp(
  doc: Y.Doc,
  group: GroupRecord
): Promise<string | null> {
  const raw = doc.getMap<string>(clearsKey).get("v1");
  if (!raw) return null;
  try {
    const cmd = JSON.parse(raw) as ClearCommand;
    if (cmd.ownerId !== group.ownerId) return null;
    const owner = group.participants.find((p) => p.id === group.ownerId);
    if (!owner) return null;
    const payload = `${group.id}.clear.${cmd.timestamp}`;
    const ok = await verifyDetached(owner.signPublicKey, cmd.signature, payload);
    return ok ? cmd.timestamp : null;
  } catch {
    return null;
  }
}

export function encodeYUpdate(update: Uint8Array): string {
  let binary = "";
  for (const byte of update) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function decodeYUpdate(value: string): Uint8Array {
  const padded = value.padEnd(value.length + ((4 - (value.length % 4)) % 4), "=");
  const binary = atob(padded.replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
