import { openDB, type DBSchema } from "idb";

import type {
  GroupRecord,
  IdentityRecord,
  InviteRecord,
  PendingJoinRecord
} from "../chat/types";

interface CipherDb extends DBSchema {
  identities: {
    key: string;
    value: IdentityRecord;
  };
  groups: {
    key: string;
    value: GroupRecord;
  };
  invites: {
    key: string;
    value: InviteRecord;
    indexes: { byGroup: string };
  };
  pendingJoins: {
    key: string;
    value: PendingJoinRecord;
    indexes: { byInvite: string };
  };
  settings: {
    key: string;
    value: { key: string; value: string };
  };
}

const dbPromise = openDB<CipherDb>("cipher-v1", 1, {
  upgrade(db) {
    db.createObjectStore("identities", { keyPath: "id" });
    db.createObjectStore("groups", { keyPath: "id" });

    const invites = db.createObjectStore("invites", { keyPath: "id" });
    invites.createIndex("byGroup", "groupId");

    const pendingJoins = db.createObjectStore("pendingJoins", { keyPath: "id" });
    pendingJoins.createIndex("byInvite", "inviteId");

    db.createObjectStore("settings", { keyPath: "key" });
  }
});

export async function getSetting(key: string): Promise<string | undefined> {
  const db = await dbPromise;
  return (await db.get("settings", key))?.value;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const db = await dbPromise;
  await db.put("settings", { key, value });
}

export async function saveIdentity(identity: IdentityRecord): Promise<void> {
  const db = await dbPromise;
  await db.put("identities", identity);
  await setSetting("activeIdentityId", identity.id);
}

export async function getActiveIdentity(): Promise<IdentityRecord | undefined> {
  const db = await dbPromise;
  const activeIdentityId = await getSetting("activeIdentityId");
  if (!activeIdentityId) return undefined;
  return db.get("identities", activeIdentityId);
}

export async function listGroups(): Promise<GroupRecord[]> {
  const db = await dbPromise;
  const groups = await db.getAll("groups");
  return groups.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function getGroup(id: string): Promise<GroupRecord | undefined> {
  const db = await dbPromise;
  return db.get("groups", id);
}

export async function saveGroup(group: GroupRecord): Promise<void> {
  const db = await dbPromise;
  await db.put("groups", { ...group, updatedAt: new Date().toISOString() });
}

export async function deleteGroup(id: string): Promise<void> {
  const db = await dbPromise;
  await db.delete("groups", id);
  // Also clean up any invites associated with this group.
  const invites = await db.getAllFromIndex("invites", "byGroup", id);
  for (const invite of invites) await db.delete("invites", invite.id);
}

export async function saveInvite(invite: InviteRecord): Promise<void> {
  const db = await dbPromise;
  await db.put("invites", invite);
}

export async function getInvite(id: string): Promise<InviteRecord | undefined> {
  const db = await dbPromise;
  return db.get("invites", id);
}

export async function listInvitesForGroup(groupId: string): Promise<InviteRecord[]> {
  const db = await dbPromise;
  return db.getAllFromIndex("invites", "byGroup", groupId);
}

export async function savePendingJoin(pendingJoin: PendingJoinRecord): Promise<void> {
  const db = await dbPromise;
  await db.put("pendingJoins", pendingJoin);
}

export async function getPendingJoinByInvite(
  inviteId: string
): Promise<PendingJoinRecord | undefined> {
  const db = await dbPromise;
  const joins = await db.getAllFromIndex("pendingJoins", "byInvite", inviteId);
  return joins.at(-1);
}
