import {
  createApplicationMessage,
  createCommit,
  createGroup,
  decodeGroupState,
  decodeMlsMessage,
  defaultCapabilities,
  defaultLifetime,
  emptyPskIndex,
  encodeGroupState,
  encodeMlsMessage,
  generateKeyPackage,
  getCiphersuiteFromName,
  getCiphersuiteImpl,
  joinGroup,
  processPrivateMessage,
  zeroOutUint8Array,
  type ClientState,
  type Credential,
  type PrivateKeyPackage,
  type Proposal
} from "ts-mls";
import { defaultClientConfig } from "ts-mls/clientConfig.js";
import { decodeRatchetTree, encodeRatchetTree } from "ts-mls/ratchetTree.js";

import type { IdentityRecord, MlsPrivatePackage } from "../chat/types";
import {
  base64UrlToBytes,
  bytesToBase64Url,
  bytesToUtf8,
  utf8ToBytes
} from "../crypto/base64";

const ciphersuiteName = "MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519";

async function impl() {
  return getCiphersuiteImpl(getCiphersuiteFromName(ciphersuiteName));
}

function credentialFor(identity: IdentityRecord): Credential {
  return {
    credentialType: "basic",
    identity: utf8ToBytes(`${identity.displayName}:${identity.id}`)
  };
}

function decodeOrThrow<T>(result: [T, number] | undefined, label: string): T {
  if (!result) throw new Error(`Unable to decode ${label}.`);
  return result[0];
}

function serializePrivatePackage(value: PrivateKeyPackage): MlsPrivatePackage {
  return {
    initPrivateKey: bytesToBase64Url(value.initPrivateKey),
    hpkePrivateKey: bytesToBase64Url(value.hpkePrivateKey),
    signaturePrivateKey: bytesToBase64Url(value.signaturePrivateKey)
  };
}

function deserializePrivatePackage(value: MlsPrivatePackage): PrivateKeyPackage {
  return {
    initPrivateKey: base64UrlToBytes(value.initPrivateKey),
    hpkePrivateKey: base64UrlToBytes(value.hpkePrivateKey),
    signaturePrivateKey: base64UrlToBytes(value.signaturePrivateKey)
  };
}

export async function createMlsKeyPackage(identity: IdentityRecord): Promise<{
  publicKeyPackage: string;
  privateKeyPackage: MlsPrivatePackage;
}> {
  const cs = await impl();
  const keyPackage = await generateKeyPackage(
    credentialFor(identity),
    defaultCapabilities(),
    defaultLifetime,
    [],
    cs
  );

  const encoded = encodeMlsMessage({
    keyPackage: keyPackage.publicPackage,
    wireformat: "mls_key_package",
    version: "mls10"
  });

  return {
    publicKeyPackage: bytesToBase64Url(encoded),
    privateKeyPackage: serializePrivatePackage(keyPackage.privatePackage)
  };
}

export async function createMlsGroupState(
  identity: IdentityRecord,
  groupId: string
): Promise<string> {
  const cs = await impl();
  const keyPackage = await generateKeyPackage(
    credentialFor(identity),
    defaultCapabilities(),
    defaultLifetime,
    [],
    cs
  );
  const state = await createGroup(
    utf8ToBytes(groupId),
    keyPackage.publicPackage,
    keyPackage.privatePackage,
    [],
    cs
  );

  return bytesToBase64Url(encodeGroupState(state));
}

export async function addMlsMember(
  mlsState: string,
  publicKeyPackage: string
): Promise<{
  nextState: string;
  welcome: string;
  ratchetTree: string;
}> {
  const cs = await impl();
  const state = restoreState(mlsState);
  const decodedMessage = decodeOrThrow(
    decodeMlsMessage(base64UrlToBytes(publicKeyPackage), 0),
    "MLS key package"
  );

  if (decodedMessage.wireformat !== "mls_key_package") {
    throw new Error("Join request did not contain an MLS key package.");
  }

  const addProposal: Proposal = {
    proposalType: "add",
    add: {
      keyPackage: decodedMessage.keyPackage
    }
  };

  const commit = await createCommit(
    { state, cipherSuite: cs },
    { extraProposals: [addProposal] }
  );
  commit.consumed.forEach(zeroOutUint8Array);

  if (!commit.welcome) {
    throw new Error("MLS commit did not produce a welcome message.");
  }

  const welcome = encodeMlsMessage({
    welcome: commit.welcome,
    wireformat: "mls_welcome",
    version: "mls10"
  });

  return {
    nextState: bytesToBase64Url(encodeGroupState(commit.newState)),
    welcome: bytesToBase64Url(welcome),
    ratchetTree: bytesToBase64Url(encodeRatchetTree(commit.newState.ratchetTree))
  };
}

export async function joinMlsGroupState(
  publicKeyPackage: string,
  privateKeyPackage: MlsPrivatePackage,
  welcome: string,
  ratchetTree: string
): Promise<string> {
  const cs = await impl();
  const decodedKeyPackage = decodeOrThrow(
    decodeMlsMessage(base64UrlToBytes(publicKeyPackage), 0),
    "MLS key package"
  );
  const decodedWelcome = decodeOrThrow(
    decodeMlsMessage(base64UrlToBytes(welcome), 0),
    "MLS welcome"
  );

  if (decodedKeyPackage.wireformat !== "mls_key_package") {
    throw new Error("Pending join did not contain an MLS key package.");
  }
  if (decodedWelcome.wireformat !== "mls_welcome") {
    throw new Error("Welcome capsule did not contain an MLS welcome.");
  }

  const state = await joinGroup(
    decodedWelcome.welcome,
    decodedKeyPackage.keyPackage,
    deserializePrivatePackage(privateKeyPackage),
    emptyPskIndex,
    cs,
    decodeOrThrow(decodeRatchetTree(base64UrlToBytes(ratchetTree), 0), "ratchet tree")
  );

  return bytesToBase64Url(encodeGroupState(state));
}

export async function createMlsApplicationMessage(
  mlsState: string,
  message: string
): Promise<{ nextState: string; encodedMessage: string }> {
  const cs = await impl();
  const result = await createApplicationMessage(
    restoreState(mlsState),
    utf8ToBytes(message),
    cs
  );
  result.consumed.forEach(zeroOutUint8Array);

  return {
    nextState: bytesToBase64Url(encodeGroupState(result.newState)),
    encodedMessage: bytesToBase64Url(
      encodeMlsMessage({
        privateMessage: result.privateMessage,
        wireformat: "mls_private_message",
        version: "mls10"
      })
    )
  };
}

export async function processMlsApplicationMessage(
  mlsState: string,
  encodedMessage: string
): Promise<{ nextState: string; message: string }> {
  const cs = await impl();
  const decoded = decodeOrThrow(
    decodeMlsMessage(base64UrlToBytes(encodedMessage), 0),
    "MLS private message"
  );

  if (decoded.wireformat !== "mls_private_message") {
    throw new Error("Expected an MLS private message.");
  }

  const result = await processPrivateMessage(
    restoreState(mlsState),
    decoded.privateMessage,
    emptyPskIndex,
    cs
  );
  result.consumed.forEach(zeroOutUint8Array);

  if (result.kind !== "applicationMessage") {
    throw new Error("MLS message updated state but did not contain app data.");
  }

  return {
    nextState: bytesToBase64Url(encodeGroupState(result.newState)),
    message: bytesToUtf8(result.message)
  };
}

export async function mlsSelfTest(): Promise<boolean> {
  const now = new Date().toISOString();
  const alice: IdentityRecord = {
    id: "alice",
    displayName: "Alice",
    boxPublicKey: "",
    boxSecretKey: "",
    signPublicKey: "",
    signSecretKey: "",
    createdAt: now,
    joinedAt: now
  };
  const bob: IdentityRecord = { ...alice, id: "bob", displayName: "Bob" };

  const aliceState = await createMlsGroupState(alice, "self-test");
  const bobPackage = await createMlsKeyPackage(bob);
  const add = await addMlsMember(aliceState, bobPackage.publicKeyPackage);
  const bobState = await joinMlsGroupState(
    bobPackage.publicKeyPackage,
    bobPackage.privateKeyPackage,
    add.welcome,
    add.ratchetTree
  );
  const encrypted = await createMlsApplicationMessage(add.nextState, "MLS online");
  const decrypted = await processMlsApplicationMessage(
    bobState,
    encrypted.encodedMessage
  );

  return decrypted.message === "MLS online";
}

function restoreState(mlsState: string): ClientState {
  const groupState = decodeOrThrow(
    decodeGroupState(base64UrlToBytes(mlsState), 0),
    "MLS group state"
  );

  return {
    ...groupState,
    clientConfig: defaultClientConfig
  };
}
