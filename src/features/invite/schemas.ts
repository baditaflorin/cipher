import { z } from "zod";

const participantSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  boxPublicKey: z.string(),
  signPublicKey: z.string(),
  joinedAt: z.string()
});

export const invitePayloadSchema = z.object({
  v: z.literal(1),
  type: z.literal("cipher-invite"),
  appUrl: z.string(),
  inviteId: z.string(),
  groupId: z.string(),
  groupName: z.string(),
  host: participantSchema,
  preKeyPublicKey: z.string(),
  expiresAt: z.string()
});

export const joinRequestPayloadSchema = z.object({
  v: z.literal(1),
  type: z.literal("cipher-join-request"),
  inviteId: z.string(),
  groupId: z.string(),
  requester: participantSchema,
  publicKeyPackage: z.string(),
  createdAt: z.string()
});

export const roomLinkPayloadSchema = z.object({
  v: z.literal(1),
  type: z.literal("cipher-room"),
  id: z.string(),
  name: z.string(),
  groupKey: z.string(),
  ownerId: z.string(),
  createdAt: z.string(),
  participants: z.array(participantSchema)
});

export const welcomePayloadSchema = z.object({
  v: z.literal(1),
  type: z.literal("cipher-welcome"),
  inviteId: z.string(),
  group: z.object({
    id: z.string(),
    name: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
    groupKey: z.string(),
    ownerId: z.string(),
    participants: z.array(participantSchema),
    yState: z.string().optional()
  }),
  host: participantSchema,
  mlsWelcome: z.string().optional(),
  mlsRatchetTree: z.string().optional(),
  createdAt: z.string()
});
