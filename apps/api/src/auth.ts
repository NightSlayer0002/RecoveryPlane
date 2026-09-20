import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Request, RequestHandler } from "express";
import { z } from "zod";
import {
  RoleSchema,
  type User,
} from "../../../packages/contracts/src/index.js";
import { hashToken } from "./domain/utils.js";
import { AppError } from "./domain/errors.js";

export const demoUsers: User[] = [
  {
    id: "demo-operator",
    name: "Alex Morgan",
    role: "OPERATOR",
    organizationId: "demo-workspace",
    organizationName: "Acme Operations",
  },
  {
    id: "demo-admin",
    name: "Jordan Lee",
    role: "ADMIN",
    organizationId: "demo-workspace",
    organizationName: "Acme Operations",
  },
  {
    id: "demo-viewer",
    name: "Sam Taylor",
    role: "VIEWER",
    organizationId: "demo-workspace",
    organizationName: "Acme Operations",
  },
];
export type AuthRequest = Request & { user: User; rawBody: Buffer };
const CredentialSchema = z
  .object({
    tokenHash: z.string().regex(/^[a-f0-9]{64}$/),
    user: z
      .object({
        id: z.string().min(1),
        name: z.string().min(1),
        role: RoleSchema,
        organizationId: z.string().min(1),
        organizationName: z.string().min(1),
      })
      .strict(),
  })
  .strict();
export function createAuth(demo: boolean, configured = "[]") {
  const credentials = z.array(CredentialSchema).parse(JSON.parse(configured));
  if (!demo && !credentials.length)
    throw new Error(
      "Set ACCESS_TOKENS_JSON to provision pilot access tokens, or explicitly enable DEMO_MODE locally",
    );
  const sessions = new Map<string, { user: User; expires: number }>();
  const members = [
    ...credentials.map((c) => c.user),
    ...(demo ? demoUsers : []),
  ];
  const lookup = (raw: string): User | undefined => {
    const tokenHash = hashToken(raw);
    for (const c of credentials)
      if (
        timingSafeEqual(
          Buffer.from(c.tokenHash, "hex"),
          Buffer.from(tokenHash, "hex"),
        )
      )
        return c.user;
    const session = sessions.get(tokenHash);
    if (session && session.expires > Date.now()) return session.user;
    if (session) sessions.delete(tokenHash);
  };
  const middleware: RequestHandler = (req, res, next) => {
    const raw = req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
    const user = raw && lookup(raw);
    if (!user) {
      res
        .status(401)
        .json({
          error: "Sign in with a valid access token",
          code: "UNAUTHORIZED",
        });
      return;
    }
    (req as AuthRequest).user = user;
    next();
  };
  return {
    members,
    middleware,
    login(role: unknown) {
      if (!demo) throw new AppError(404, "Demo login is disabled");
      const parsed = RoleSchema.parse(role);
      const user = demoUsers.find((u) => u.role === parsed)!;
      const raw = randomBytes(32).toString("hex");
      for (const [key, session] of sessions)
        if (session.expires < Date.now()) sessions.delete(key);
      if (sessions.size >= 500)
        throw new AppError(429, "Too many demo sessions. Try again later.");
      sessions.set(hashToken(raw), { user, expires: Date.now() + 8 * 3600000 });
      return { token: raw, user, demo };
    },
  };
}
