import { createHmac, timingSafeEqual } from "node:crypto";
export function signPayload(
  secret: string,
  timestamp: string,
  identity: string,
  rawBody: string | Buffer,
) {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${identity}.`)
    .update(rawBody)
    .digest("hex");
}
export function verifyPayload(
  secret: string,
  timestamp: unknown,
  identity: unknown,
  rawBody: string | Buffer,
  signature: unknown,
  clock = Date.now(),
) {
  if (
    typeof timestamp !== "string" ||
    !/^\d{13}$/.test(timestamp) ||
    Math.abs(clock - Number(timestamp)) > 300000
  )
    return false;
  if (
    typeof identity !== "string" ||
    !identity ||
    typeof signature !== "string" ||
    !/^[a-f0-9]{64}$/.test(signature)
  )
    return false;
  const expected = Buffer.from(
    signPayload(secret, timestamp, identity, rawBody),
    "hex",
  );
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}
