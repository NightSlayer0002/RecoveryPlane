import express from "express";
import type { Request, Response, NextFunction } from "express";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { ZodError, z } from "zod";
import { RecoveryService } from "./domain/service.js";
import { AppError, requireRole } from "./domain/errors.js";
import { createAuth, type AuthRequest } from "./auth.js";
import { approvedDestination } from "../../worker/src/transport.js";
import { verifyPayload } from "../../../packages/sdk/src/signing.js";
type Demo = {
  scenario: (scenario: string) => Promise<any>;
  vendors: () => Promise<any[]>;
};
type Options = {
  demo: boolean;
  tokens?: string;
  localDestinations?: string[];
  demoService?: Demo;
  staticDir?: string;
  quiet?: boolean;
};
export function createApp(service: RecoveryService, options: Options) {
  const app = express(),
    auth = createAuth(options.demo, options.tokens);
  service.members = auth.members;
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    const requestId = randomUUID();
    res.setHeader("x-request-id", requestId);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
    );
    if (!options.quiet)
      res.on("finish", () =>
        console.log(
          JSON.stringify({
            level: "info",
            requestId,
            method: req.method,
            path: req.path,
            status: res.statusCode,
          }),
        ),
      );
    next();
  });
  const rates = new Map<string, { count: number; since: number }>();
  app.use((req, res, next) => {
    const key = `${req.ip}:${req.path === "/api/auth/demo" ? "login" : "api"}`,
      time = Date.now();
    if (rates.size > 10000)
      for (const [k, r] of rates) if (time - r.since > 60000) rates.delete(k);
    let r = rates.get(key);
    if (!r || time - r.since > 60000) {
      r = { count: 0, since: time };
      rates.set(key, r);
    }
    if (++r.count > (req.path === "/api/auth/demo" ? 30 : 600)) {
      res.setHeader("Retry-After", "60");
      res
        .status(429)
        .json({ error: "Request limit reached. Try again shortly." });
      return;
    }
    next();
  });
  app.use(
    express.json({
      limit: "64kb",
      verify: (req: any, _res, bytes) => {
        req.rawBody = bytes;
      },
    }),
  );
  const route =
    (fn: (req: AuthRequest, res: Response) => Promise<any> | any) =>
    (req: Request, res: Response, next: NextFunction) =>
      Promise.resolve()
        .then(() => fn(req as AuthRequest, res))
        .then((value) => {
          if (!res.headersSent && value !== undefined) res.json(value);
        })
        .catch(next);
  app.get(
    "/api/health",
    route(async () => {
      await service.db.query("SELECT 1");
      return { status: "ok", mode: service.db.mode, demo: options.demo };
    }),
  );
  app.post(
    "/api/auth/demo",
    route((req) => auth.login(req.body.role)),
  );
  app.post(
    "/v1/exceptions",
    route(async (req) => {
      const identity = await service.reportingIdentity(
        req.headers.authorization?.replace(/^Bearer /, "") ?? "",
      );
      return service.report(identity.id, req.body);
    }),
  );
  app.post(
    "/v1/integrations/:integrationId/commands/:commandId/result",
    route(async (req) => {
      const { integrationId, commandId } = req.params;
      const row = (
        await service.db.query(
          "SELECT secret FROM rp_integrations WHERE id=$1",
          [integrationId],
        )
      ).rows[0];
      if (
        !row ||
        !verifyPayload(
          row.secret,
          req.headers["x-recoveryplane-timestamp"],
          `${integrationId}:${commandId}`,
          req.rawBody,
          req.headers["x-recoveryplane-signature"],
        )
      )
        throw new AppError(401, "Invalid result signature");
      await service.acceptResult(integrationId, commandId, req.body);
      return { accepted: true };
    }),
  );
  app.use("/api", auth.middleware);
  app.get(
    "/api/session",
    route((req) => ({ user: req.user, demo: options.demo })),
  );
  app.get(
    "/api/cases",
    route((req) => service.listCases(req.user, req.query)),
  );
  app.get(
    "/api/cases/:id",
    route((req) => service.getCase(req.user, req.params.id)),
  );
  app.patch(
    "/api/cases/:id",
    route((req) => service.updateCase(req.user, req.params.id, req.body)),
  );
  app.post(
    "/api/cases/:id/notes",
    route((req) => service.addNote(req.user, req.params.id, req.body.text)),
  );
  app.post(
    "/api/cases/:id/actions/:actionId",
    route((req) =>
      service.invoke(req.user, req.params.id, req.params.actionId, req.body),
    ),
  );
  app.post(
    "/api/commands/:id/retry",
    route((req) => service.retry(req.user, req.params.id)),
  );
  app.get(
    "/api/integrations",
    route((req) => service.listIntegrations(req.user)),
  );
  app.post(
    "/api/integrations",
    route(async (req) => {
      requireRole(req.user.role, ["ADMIN"]);
      try {
        await approvedDestination(
          z.string().url().parse(req.body.callbackUrl),
          options.localDestinations,
        );
      } catch (error) {
        throw new AppError(400, (error as Error).message);
      }
      return service.createIntegration(req.user, req.body);
    }),
  );
  app.patch(
    "/api/integrations/:id",
    route((req) => {
      const body = z.object({ enabled: z.boolean() }).strict().parse(req.body);
      return service.setIntegrationEnabled(
        req.user,
        req.params.id,
        body.enabled,
      );
    }),
  );
  app.post(
    "/api/integrations/:id/actions",
    route((req) => service.registerAction(req.user, req.params.id, req.body)),
  );
  app.patch(
    "/api/integrations/:id/actions/:actionId",
    route((req) => {
      const body = z.object({ enabled: z.boolean() }).strict().parse(req.body);
      return service.setActionEnabled(
        req.user,
        req.params.id,
        req.params.actionId,
        body.enabled,
      );
    }),
  );
  app.get(
    "/api/activity",
    route((req) => service.activity(req.user)),
  );
  app.get(
    "/api/metrics",
    route((req) => service.metrics(req.user)),
  );
  app.post(
    "/api/demo/scenarios",
    route(async (req) => {
      requireRole(req.user.role, ["ADMIN", "OPERATOR"]);
      if (
        !options.demo ||
        !options.demoService ||
        req.user.organizationId !== "demo-workspace"
      )
        throw new AppError(404, "Demo is unavailable");
      return options.demoService.scenario(
        z
          .enum(["missing_country", "duplicate_reports", "lost_response"])
          .parse(req.body.scenario),
      );
    }),
  );
  app.get(
    "/api/demo/vendors",
    route(async (req) => {
      if (
        !options.demo ||
        !options.demoService ||
        req.user.organizationId !== "demo-workspace"
      )
        throw new AppError(404, "Demo is unavailable");
      return { vendors: await options.demoService.vendors() };
    }),
  );
  app.get("/api/events", (req, res) => {
    const user = (req as AuthRequest).user;
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write('data: {"type":"invalidate"}\n\n');
    let previous = "",
      busy = false;
    const timer = setInterval(async () => {
      if (busy) return;
      busy = true;
      try {
        const rows = (
          await service.db.query(
            "SELECT count(*)::text AS revision FROM rp_audit WHERE org_id=$1",
            [user.organizationId],
          )
        ).rows;
        const revision = rows[0].revision;
        if (previous !== revision) {
          previous = revision;
          res.write('data: {"type":"invalidate"}\n\n');
        } else res.write(": heartbeat\n\n");
      } catch {
        res.end();
      } finally {
        busy = false;
      }
    }, 3000);
    const expiry = setTimeout(() => res.end(), 15 * 60000);
    res.on("close", () => {
      clearInterval(timer);
      clearTimeout(expiry);
    });
  });
  app.use(["/api", "/v1"], (_req, res) =>
    res.status(404).json({ error: "Endpoint not found" }),
  );
  if (
    options.staticDir &&
    existsSync(resolve(options.staticDir, "index.html"))
  ) {
    app.use(express.static(options.staticDir));
    app.get("*", (_req, res) =>
      res.sendFile(resolve(options.staticDir!, "index.html")),
    );
  }
  app.use((error: any, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return res.end();
    if (error instanceof ZodError)
      return res
        .status(400)
        .json({
          error: error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; "),
          code: "VALIDATION_ERROR",
        });
    if (error instanceof AppError)
      return res
        .status(error.status)
        .json({ error: error.message, code: error.code });
    if (error.type === "entity.parse.failed")
      return res.status(400).json({ error: "Invalid JSON body" });
    if (error.type === "entity.too.large")
      return res.status(413).json({ error: "Request exceeds 64 KB" });
    console.error(
      JSON.stringify({
        level: "error",
        message: "Unexpected request error",
        name: error.name,
        code: error.code,
      }),
    );
    res
      .status(500)
      .json({ error: "An internal error occurred. Check the server logs." });
  });
  return { app, auth };
}
