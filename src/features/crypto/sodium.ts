import sodium from "libsodium-wrappers";

import { utf8ToBytes } from "./base64";

export async function sodiumReady(): Promise<typeof sodium> {
  await sodium.ready;
  return sodium;
}

export async function createBoxKeyPair(): Promise<{
  publicKey: string;
  secretKey: string;
}> {
  const s = await sodiumReady();
  const pair = s.crypto_box_keypair();
  return {
    publicKey: toBase64(pair.publicKey),
    secretKey: toBase64(pair.privateKey)
  };
}

export async function createSigningKeyPair(): Promise<{
  publicKey: string;
  secretKey: string;
}> {
  const s = await sodiumReady();
  const pair = s.crypto_sign_keypair();
  return {
    publicKey: toBase64(pair.publicKey),
    secretKey: toBase64(pair.privateKey)
  };
}

export async function randomSecretKey(): Promise<string> {
  const s = await sodiumReady();
  return toBase64(s.randombytes_buf(s.crypto_secretbox_KEYBYTES));
}

export async function sealedBoxEncryptJson(
  recipientPublicKey: string,
  value: unknown
): Promise<string> {
  const s = await sodiumReady();
  const ciphertext = s.crypto_box_seal(
    s.from_string(JSON.stringify(value)),
    fromBase64(recipientPublicKey)
  );
  return toBase64(ciphertext);
}

export async function sealedBoxDecryptJson<T>(
  recipientPublicKey: string,
  recipientSecretKey: string,
  capsule: string
): Promise<T> {
  const s = await sodiumReady();
  const plaintext = s.crypto_box_seal_open(
    fromBase64(capsule),
    fromBase64(recipientPublicKey),
    fromBase64(recipientSecretKey)
  );

  if (!plaintext) {
    throw new Error("Unable to decrypt capsule for this browser identity.");
  }

  return JSON.parse(s.to_string(plaintext)) as T;
}

export async function encryptJsonWithKey(
  key: string,
  value: unknown,
  additionalData = ""
): Promise<{ ciphertext: string; nonce: string }> {
  const s = await sodiumReady();
  const nonce = s.randombytes_buf(s.crypto_secretbox_NONCEBYTES);
  const ciphertext = s.crypto_secretbox_easy(
    s.from_string(JSON.stringify({ value, additionalData })),
    nonce,
    fromBase64(key)
  );

  return {
    ciphertext: toBase64(ciphertext),
    nonce: toBase64(nonce)
  };
}

export async function decryptJsonWithKey<T>(
  key: string,
  encrypted: { ciphertext: string; nonce: string },
  additionalData = ""
): Promise<T> {
  const s = await sodiumReady();
  const decoded = JSON.parse(
    s.to_string(
      s.crypto_secretbox_open_easy(
        fromBase64(encrypted.ciphertext),
        fromBase64(encrypted.nonce),
        fromBase64(key)
      )
    )
  ) as { value: unknown; additionalData: unknown };

  if (decoded.additionalData !== additionalData) {
    throw new Error("Encrypted payload was not bound to this context.");
  }

  return decoded.value as T;
}

export async function signDetached(
  secretKey: string,
  message: string | Uint8Array
): Promise<string> {
  const s = await sodiumReady();
  const payload = typeof message === "string" ? utf8ToBytes(message) : message;
  return toBase64(s.crypto_sign_detached(payload, fromBase64(secretKey)));
}

export async function verifyDetached(
  publicKey: string,
  signature: string,
  message: string | Uint8Array
): Promise<boolean> {
  const s = await sodiumReady();
  const payload = typeof message === "string" ? utf8ToBytes(message) : message;
  return s.crypto_sign_verify_detached(
    fromBase64(signature),
    payload,
    fromBase64(publicKey)
  );
}

function toBase64(value: Uint8Array): string {
  return sodium.to_base64(value, sodium.base64_variants.URLSAFE_NO_PADDING);
}

function fromBase64(value: string): Uint8Array {
  return sodium.from_base64(value, sodium.base64_variants.URLSAFE_NO_PADDING);
}
