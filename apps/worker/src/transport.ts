import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import https from "node:https";
import http from "node:http";
import type { RecoveryEnvelope } from "../../../packages/contracts/src/index.js";
import { signPayload } from "../../../packages/sdk/src/signing.js";

export function isPublicAddress(address: string) {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  // Restrict IPv6 to global unicast, excluding IETF special and documentation ranges.
  if (isIP(address) === 6)
    return (
      /^[23][0-9a-f]{3}:/i.test(address) &&
      !/^2001:(?:0{0,3}[012]?[0-9a-f]{0,2}:|db8:)/i.test(address) &&
      !/^2002:/i.test(address) &&
      !/^3fff:/i.test(address)
    );
  return false;
}
export async function approvedDestination(
  raw: string,
  localDestinations: string[] = [],
  timeoutMs = 3000,
  resolver: (
    host: string,
    options: { all: true },
  ) => Promise<{ address: string; family: number }[]> = lookup,
) {
  const url = new URL(raw);
  if (url.username || url.password || url.hash)
    throw new Error("Callback URL cannot include credentials or fragments");
  if (localDestinations.includes(url.href)) {
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1")
      throw new Error("Demo destination must be explicit IPv4 loopback HTTP");
    return { url, address: "127.0.0.1", family: 4 };
  }
  if (url.protocol !== "https:")
    throw new Error("Callback URL must use public HTTPS");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let addresses: { address: string; family: number }[];
  try {
    addresses = isIP(hostname)
      ? [{ address: hostname, family: isIP(hostname) }]
      : await Promise.race([
          resolver(hostname, { all: true }),
          new Promise<never>((_resolve, reject) => {
            deadline = setTimeout(
              () => reject(new Error("Callback DNS resolution timed out")),
              timeoutMs,
            );
          }),
        ]);
  } finally {
    clearTimeout(deadline);
  }
  if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address)))
    throw new Error(
      "Callback destination must resolve only to public addresses",
    );
  return { url, ...addresses[0] };
}
export function createTransport(
  localDestinations: string[] = [],
  timeoutMs = 8000,
) {
  return async (
    rawUrl: string,
    envelope: RecoveryEnvelope,
    secret: string,
  ): Promise<unknown> => {
    const started = Date.now();
    const { url, address, family } = await approvedDestination(
      rawUrl,
      localDestinations,
      Math.min(3000, timeoutMs),
    );
    const rawBody = JSON.stringify(envelope),
      timestamp = String(Date.now());
    return new Promise((resolve, reject) => {
      const request = (url.protocol === "https:" ? https : http).request(
        url,
        {
          method: "POST",
          agent: false,
          // The socket uses the exact validated IP. TLS still verifies the original hostname.
          lookup: ((_host: string, options: any, callback: any) =>
            options?.all
              ? callback(null, [{ address, family }])
              : callback(null, address, family)) as any,
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(rawBody),
            "x-recoveryplane-command-id": envelope.commandId,
            "x-recoveryplane-timestamp": timestamp,
            "x-recoveryplane-signature": signPayload(
              secret,
              timestamp,
              envelope.commandId,
              rawBody,
            ),
          },
        },
        (response) => {
          const chunks: Buffer[] = [];
          let size = 0;
          response.on("data", (chunk) => {
            size += chunk.length;
            if (size > 65536) {
              response.destroy();
              request.destroy(new Error("Origin response exceeded 64 KB"));
            } else chunks.push(chunk);
          });
          response.on("error", reject);
          response.on("end", () => {
            if (
              !response.statusCode ||
              response.statusCode < 200 ||
              response.statusCode >= 300
            )
              return reject(
                new Error(
                  `Origin returned HTTP ${response.statusCode}; outcome unconfirmed`,
                ),
              );
            try {
              resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
            } catch {
              reject(new Error("Origin returned no valid business result"));
            }
          });
        },
      );
      const deadline = setTimeout(
        () =>
          request.destroy(
            new Error("Origin delivery timed out; outcome unconfirmed"),
          ),
        Math.max(1, timeoutMs - (Date.now() - started)),
      );
      request.on("close", () => clearTimeout(deadline));
      request.on("error", reject);
      request.end(rawBody);
    });
  };
}
