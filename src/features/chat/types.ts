export type Participant = {
  id: string;
  displayName: string;
  boxPublicKey: string;
  signPublicKey: string;
  joinedAt: string;
};

export type IdentityRecord = Participant & {
  boxSecretKey: string;
  signSecretKey: string;
  createdAt: string;
};

export type MlsPrivatePackage = {
  initPrivateKey: string;
  hpkePrivateKey: string;
  signaturePrivateKey: string;
};

export type GroupRecord = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  groupKey: string;
  ownerId: string;
  participants: Participant[];
  yState?: string;
  mlsState?: string;
};

export type InviteRecord = {
  id: string;
  groupId: string;
  groupName: string;
  host: Participant;
  preKeyPublicKey: string;
  preKeySecretKey: string;
  createdAt: string;
  expiresAt: string;
  usedAt?: string;
};

export type PendingJoinRecord = {
  id: string;
  inviteId: string;
  groupId: string;
  publicKeyPackage: string;
  privateKeyPackage: MlsPrivatePackage;
  createdAt: string;
};

export type InvitePayload = {
  v: 1;
  type: "cipher-invite";
  appUrl: string;
  inviteId: string;
  groupId: string;
  groupName: string;
  host: Participant;
  preKeyPublicKey: string;
  expiresAt: string;
};

export type JoinRequestPayload = {
  v: 1;
  type: "cipher-join-request";
  inviteId: string;
  groupId: string;
  requester: Participant;
  publicKeyPackage: string;
  createdAt: string;
};

export type WelcomePayload = {
  v: 1;
  type: "cipher-welcome";
  inviteId: string;
  group: Omit<GroupRecord, "mlsState">;
  host: Participant;
  mlsWelcome?: string;
  mlsRatchetTree?: string;
  createdAt: string;
};

/**
 * Room-link payload — the group key is embedded directly in the URL so the
 * receiver can join with a single click, no capsule exchange required.
 * Security model: link confidentiality. Anyone with the link can join and
 * read past messages. Use the invite flow for tighter access control.
 */
export type RoomLinkPayload = {
  v: 1;
  type: "cipher-room";
  id: string;
  name: string;
  groupKey: string;
  ownerId: string;
  createdAt: string;
  participants: Participant[];
};

export type ChatPlaintext = {
  id: string;
  groupId: string;
  body: string;
  senderId: string;
  senderName: string;
  createdAt: string;
  kind: "text" | "system" | "transcript";
};

export type EncryptedChatRecord = {
  id: string;
  groupId: string;
  senderId: string;
  nonce: string;
  ciphertext: string;
  signature: string;
  createdAt: string;
};

export type DecryptedChatRecord = ChatPlaintext & {
  verified: boolean;
};

export type SignalCapsule =
  | {
      v: 1;
      type: "webrtc-offer";
      groupId: string;
      from: Participant;
      description: RTCSessionDescriptionInit;
    }
  | {
      v: 1;
      type: "webrtc-answer";
      groupId: string;
      from: Participant;
      description: RTCSessionDescriptionInit;
    };
