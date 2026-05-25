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
 * Delete all messages from the shared Yjs doc.
 * The deletion is a CRDT operation — it propagates to every connected peer
 * via y-webrtc and is included in future yState snapshots, so new joiners
 * also start with a clean slate.
 */
export function clearMessages(doc: Y.Doc): void {
  const arr = doc.getArray<EncryptedChatRecord>(messagesKey);
  if (arr.length > 0) arr.delete(0, arr.length);
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
