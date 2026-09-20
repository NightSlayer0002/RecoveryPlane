import { test } from "node:test";
import assert from "node:assert/strict";
import { signPayload, verifyPayload } from "../packages/sdk/src/signing.js";
test("signatures bind raw bytes, timestamp and command identity", () => {
  const body = '{"country":"IN"}',
    timestamp = String(Date.now());
  const signature = signPayload("secret", timestamp, "cmd-a", body);
  assert.equal(
    verifyPayload("secret", timestamp, "cmd-a", body, signature),
    true,
  );
  assert.equal(
    verifyPayload("secret", timestamp, "cmd-b", body, signature),
    false,
  );
  assert.equal(
    verifyPayload(
      "secret",
      timestamp,
      "cmd-a",
      '{ "country": "IN" }',
      signature,
    ),
    false,
  );
  assert.equal(verifyPayload("secret", "NaN", "cmd-a", body, signature), false);
  assert.equal(
    verifyPayload(
      "secret",
      String(Date.now() - 600000),
      "cmd-a",
      body,
      signature,
    ),
    false,
  );
  assert.equal(verifyPayload("secret", timestamp, "cmd-a", body, "a"), false);
});
