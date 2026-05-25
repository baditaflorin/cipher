import QRCode from "qrcode";

import type {
  GroupRecord,
  IdentityRecord,
  InvitePayload,
  InviteRecord,
  JoinRequestPayload,
  PendingJoinRecord,
  RoomLinkPayload,
  WelcomePayload
} from "../chat/types";
import { base64UrlToJson, jsonToBase64Url, randomId } from "../crypto/base64";
import {
  createBoxKeyPair,
  sealedBoxDecryptJson,
  sealedBoxEncryptJson
} from "../crypto/sodium";
import { toParticipant } from "../identity/identity";
import {
  getInvite,
  getPendingJoinByInvite,
  listGroups,
  listInvitesForGroup,
  saveGroup,
  saveInvite,
  savePendingJoin
} from "../storage/db";
import {
  invitePayloadSchema,
  joinRequestPayloadSchema,
  roomLinkPayloadSchema,
  welcomePayloadSchema
} from "./schemas";
import { checkInviteValidity } from "./validity";

export { checkInviteValidity, type InviteValidity } from "./validity";

export function getAppUrl(): string {
  return `${window.location.origin}/cipher/`;
}

export function buildInviteLink(invite: InviteRecord): string {
  const payload: InvitePayload = {
    v: 1,
    type: "cipher-invite",
    appUrl: getAppUrl(),
    inviteId: invite.id,
    groupId: invite.groupId,
    groupName: invite.groupName,
    host: invite.host,
    preKeyPublicKey: invite.preKeyPublicKey,
    expiresAt: invite.expiresAt
  };

  return `${getAppUrl()}#/join/${jsonToBase64Url(payload)}`;
}

export function parseInviteFromHash(
  hash = window.location.hash
): InvitePayload | undefined {
  const marker = "#/join/";
  if (!hash.startsWith(marker)) return undefined;
  return invitePayloadSchema.parse(base64UrlToJson(hash.slice(marker.length)));
}

// ---------------------------------------------------------------------------
// Room-link: group key in URL, zero-step join.
// Security: link confidentiality. Anyone with the link can join and read
// messages. Use the invite flow when you need tighter access control.
// ---------------------------------------------------------------------------

export function buildRoomLink(group: GroupRecord): string {
  const payload: RoomLinkPayload = {
    v: 1,
    type: "cipher-room",
    id: group.id,
    name: group.name,
    groupKey: group.groupKey,
    ownerId: group.ownerId,
    createdAt: group.createdAt,
    participants: group.participants
  };
  return `${getAppUrl()}#/room/${jsonToBase64Url(payload)}`;
}

export function parseRoomLinkFromHash(
  hash = window.location.hash
): RoomLinkPayload | undefined {
  const marker = "#/room/";
  if (!hash.startsWith(marker)) return undefined;
  return roomLinkPayloadSchema.parse(base64UrlToJson(hash.slice(marker.length)));
}

/** Import a room from a room-link payload. Returns the existing record if the
 *  group is already in IndexedDB (idempotent). */
export async function joinFromRoomLink(
  payload: RoomLinkPayload,
  identity: IdentityRecord
): Promise<GroupRecord> {
  const existing = await import("../storage/db").then((db) => db.getGroup(payload.id));
  if (existing) return existing;

  const { toParticipant: tp } = await import("../identity/identity");
  const me = tp(identity);
  const group: GroupRecord = {
    id: payload.id,
    name: payload.name,
    groupKey: payload.groupKey,
    ownerId: payload.ownerId,
    createdAt: payload.createdAt,
    updatedAt: new Date().toISOString(),
    participants: payload.participants.some((p) => p.id === identity.id)
      ? payload.participants
      : [...payload.participants, me]
  };
  await import("../storage/db").then((db) => db.saveGroup(group));
  return group;
}

export async function createInvite(
  group: GroupRecord,
  identity: IdentityRecord
): Promise<{ invite: InviteRecord; link: string; qrDataUrl: string }> {
  const preKey = await createBoxKeyPair();
  const now = new Date();
  const invite: InviteRecord = {
    id: randomId("inv"),
    groupId: group.id,
    groupName: group.name,
    host: toParticipant(identity),
    preKeyPublicKey: preKey.publicKey,
    preKeySecretKey: preKey.secretKey,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 1000 * 60 * 60 * 24).toISOString()
  };
  await saveInvite(invite);

  const link = buildInviteLink(invite);
  const qrDataUrl = await QRCode.toDataURL(link, {
    margin: 1,
    width: 240,
    color: {
      dark: "#14211b",
      light: "#f6f2e8"
    }
  });

  return { invite, link, qrDataUrl };
}

export async function createJoinRequestCapsule(
  invite: InvitePayload,
  identity: IdentityRecord
): Promise<string> {
  const mlsKeyPackage = await import("../mls/mls").then((mls) =>
    mls.createMlsKeyPackage(identity)
  );
  const pendingJoin: PendingJoinRecord = {
    id: randomId("join"),
    inviteId: invite.inviteId,
    groupId: invite.groupId,
    publicKeyPackage: mlsKeyPackage.publicKeyPackage,
    privateKeyPackage: mlsKeyPackage.privateKeyPackage,
    createdAt: new Date().toISOString()
  };
  await savePendingJoin(pendingJoin);

  const payload: JoinRequestPayload = {
    v: 1,
    type: "cipher-join-request",
    inviteId: invite.inviteId,
    groupId: invite.groupId,
    requester: toParticipant(identity),
    publicKeyPackage: mlsKeyPackage.publicKeyPackage,
    createdAt: new Date().toISOString()
  };

  return sealedBoxEncryptJson(invite.preKeyPublicKey, payload);
}

export async function openJoinRequestCapsule(capsule: string): Promise<{
  invite: InviteRecord;
  request: JoinRequestPayload;
}> {
  const maybeDecodedInvite = await findInviteForCapsule(capsule);
  if (!maybeDecodedInvite) {
    throw new Error("No matching one-time pre-key found in this browser.");
  }

  const validity = checkInviteValidity(maybeDecodedInvite.invite);
  if (!validity.ok) {
    if (validity.reason === "used") {
      throw new Error(
        `This invite was already accepted on ${new Date(validity.usedAt).toLocaleString()}. ` +
          "Create a fresh invite for the new joiner — pre-keys are single-use."
      );
    }
    throw new Error(
      `This invite expired on ${new Date(validity.expiresAt).toLocaleString()}. ` +
        "Create a fresh invite; the old one's one-time pre-key is no longer accepted."
    );
  }

  return maybeDecodedInvite;
}

export async function createWelcomeCapsule(
  group: GroupRecord,
  request: JoinRequestPayload,
  docState: string | undefined
): Promise<{ nextGroup: GroupRecord; capsule: string }> {
  const invite = await getInvite(request.inviteId);
  if (!invite) throw new Error("Invite pre-key is not present in this browser.");

  const mls = group.mlsState
    ? await import("../mls/mls").then((module) =>
        module.addMlsMember(group.mlsState!, request.publicKeyPackage)
      )
    : undefined;
  const nextGroup: GroupRecord = {
    ...group,
    participants: group.participants.some((item) => item.id === request.requester.id)
      ? group.participants
      : [...group.participants, request.requester],
    mlsState: mls?.nextState ?? group.mlsState,
    yState: docState ?? group.yState,
    updatedAt: new Date().toISOString()
  };

  await saveGroup(nextGroup);
  await saveInvite({ ...invite, usedAt: new Date().toISOString() });

  const payload: WelcomePayload = {
    v: 1,
    type: "cipher-welcome",
    inviteId: request.inviteId,
    group: {
      id: nextGroup.id,
      name: nextGroup.name,
      createdAt: nextGroup.createdAt,
      updatedAt: nextGroup.updatedAt,
      groupKey: nextGroup.groupKey,
      ownerId: nextGroup.ownerId,
      participants: nextGroup.participants,
      yState: docState ?? nextGroup.yState
    },
    host: invite.host,
    mlsWelcome: mls?.welcome,
    mlsRatchetTree: mls?.ratchetTree,
    createdAt: new Date().toISOString()
  };

  return {
    nextGroup,
    capsule: await sealedBoxEncryptJson(request.requester.boxPublicKey, payload)
  };
}

export async function openWelcomeCapsule(
  capsule: string,
  identity: IdentityRecord
): Promise<GroupRecord> {
  const payload = welcomePayloadSchema.parse(
    await sealedBoxDecryptJson(identity.boxPublicKey, identity.boxSecretKey, capsule)
  );
  const pendingJoin = await getPendingJoinByInvite(payload.inviteId);
  const mlsState =
    payload.mlsWelcome && payload.mlsRatchetTree && pendingJoin
      ? await import("../mls/mls").then((module) =>
          module.joinMlsGroupState(
            pendingJoin.publicKeyPackage,
            pendingJoin.privateKeyPackage,
            payload.mlsWelcome!,
            payload.mlsRatchetTree!
          )
        )
      : undefined;

  const group: GroupRecord = {
    ...payload.group,
    mlsState
  };
  await saveGroup(group);
  return group;
}

export function parseJoinRequest(value: unknown): JoinRequestPayload {
  return joinRequestPayloadSchema.parse(value);
}

async function findInviteForCapsule(
  capsule: string
): Promise<{ invite: InviteRecord; request: JoinRequestPayload } | undefined> {
  const groups = await listGroups();

  for (const group of groups) {
    const invites = await listInvitesForGroup(group.id);
    for (const invite of invites) {
      try {
        const request = joinRequestPayloadSchema.parse(
          await sealedBoxDecryptJson(
            invite.preKeyPublicKey,
            invite.preKeySecretKey,
            capsule.trim()
          )
        );
        if (request.inviteId === invite.id) return { invite, request };
      } catch {
        // Try the next one-time pre-key.
      }
    }
  }

  return undefined;
}
