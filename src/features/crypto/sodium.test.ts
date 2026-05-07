import { describe, expect, it } from "vitest";

import {
  createBoxKeyPair,
  createSigningKeyPair,
  sealedBoxDecryptJson,
  sealedBoxEncryptJson,
  signDetached,
  verifyDetached
} from "./sodium";

describe("libsodium envelope helpers", () => {
  it("encrypts sealed capsules and verifies signatures", async () => {
    const box = await createBoxKeyPair();
    const signing = await createSigningKeyPair();
    const capsule = await sealedBoxEncryptJson(box.publicKey, { message: "hello" });

    await expect(
      sealedBoxDecryptJson(box.publicKey, box.secretKey, capsule)
    ).resolves.toEqual({ message: "hello" });

    const signature = await signDetached(signing.secretKey, capsule);
    await expect(verifyDetached(signing.publicKey, signature, capsule)).resolves.toBe(
      true
    );
  });
});
