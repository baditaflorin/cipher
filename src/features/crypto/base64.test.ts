import { describe, expect, it } from "vitest";

import { base64UrlToJson, jsonToBase64Url } from "./base64";

describe("base64url helpers", () => {
  it("round-trips json payloads", () => {
    const encoded = jsonToBase64Url({ hello: "cipher", count: 2 });
    expect(encoded).not.toContain("+");
    expect(base64UrlToJson(encoded)).toEqual({ hello: "cipher", count: 2 });
  });
});
