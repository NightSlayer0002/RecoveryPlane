import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { openDatabase } from "../packages/database/src/store.js";
import { RecoveryService } from "../apps/api/src/domain/service.js";
import { createApp } from "../apps/api/src/server.js";
import { createOrigin } from "../apps/vendor-onboarding-demo/src/origin.js";
import { Dispatcher } from "../apps/worker/src/dispatcher.js";
import { createTransport } from "../apps/worker/src/transport.js";
import { RecoveryPlane, signPayload } from "../packages/sdk/src/index.js";
import { hashToken } from "../apps/api/src/domain/utils.js";

const listen = (app: any) =>
  new Promise<Server>((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
    server.on("error", reject);
  });
const url = (server: Server) =>
  `http://127.0.0.1:${(server.address() as any).port}`;
const close = (server: Server) =>
  new Promise<void>((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  });

test("real HTTP: role boundaries, signed origin, lost response, patch then verification, secrets and callback isolation", async () => {
  const db = await openDatabase(process.env.TEST_DATABASE_URL || ":memory:");
  const org = `http-${randomUUID()}`;
  const admin = {
    id: "admin",
    name: "Admin",
    organizationId: org,
    organizationName: "HTTP tests",
    role: "ADMIN" as const,
  };
  const service = new RecoveryService(db);
  await service.ensureTenant(org, "HTTP tests");
  const tokens = ["ADMIN", "OPERATOR", "VIEWER"].map((role) => ({
    tokenHash: hashToken(`test-${role}`),
    user: { ...admin, id: role, role },
  }));
  const destinations: string[] = [];
  const { app } = createApp(service, {
    demo: false,
    tokens: JSON.stringify(tokens),
    localDestinations: destinations,
    quiet: true,
  });
  const apiServer = await listen(app);
  let originServer: Server | undefined;
  const request = async (
    path: string,
    method = "GET",
    body?: any,
    credential = "test-ADMIN",
  ) => {
    const r = await fetch(`${url(apiServer)}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${credential}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, data: (await r.json()) as any };
  };
  try {
    assert.equal(
      (await request("/api/cases", "GET", undefined, "bad")).status,
      401,
    );
    assert.equal(
      (await request("/api/auth/demo", "POST", { role: "ADMIN" })).status,
      404,
    );
    assert.equal(
      (
        await request(
          "/api/integrations",
          "POST",
          { name: "bad" },
          "test-OPERATOR",
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await request("/api/integrations", "POST", {
          name: "SSRF",
          environment: "test",
          callbackUrl: "http://169.254.169.254/latest",
        })
      ).status,
      400,
    );
    const created = await service.createIntegration(admin, {
      name: "Vendors",
      environment: "test",
      callbackUrl: "https://example.com/recovery",
    });
    const origin = await createOrigin(db, created.signingSecret);
    originServer = await listen(origin.app);
    const callbackUrl = `${url(originServer)}/recovery`;
    destinations.push(callbackUrl);
    await db.query("UPDATE rp_integrations SET data=$2 WHERE id=$1", [
      created.integration.id,
      { ...created.integration, callbackUrl },
    ]);
    const patch = await service.registerAction(admin, created.integration.id, {
      actionKey: "patch_vendor",
      label: "Patch",
      riskLevel: "MEDIUM",
      inputSchema: {
        type: "object",
        properties: { country: { type: "string", enum: ["IN", "US"] } },
        required: ["country"],
      },
    });
    const verify = await service.registerAction(admin, created.integration.id, {
      actionKey: "retry_verification",
      label: "Verify",
      inputSchema: { type: "object", properties: {} },
    });
    const vendor = await origin.addVendor("Acme", true);
    const sdk = new RecoveryPlane({
      apiKey: created.reportingKey,
      baseUrl: url(apiServer),
    });
    const report = {
      idempotencyKey: vendor.id,
      correlationKey: vendor.id,
      fingerprint: "missing",
      workflow: "onboarding",
      entity: { type: "vendor", id: vendor.id },
      exception: { type: "missing" },
      availableActions: ["patch_vendor", "retry_verification"],
    };
    const c = await sdk.exceptions.report(report);
    assert.equal(
      (
        await request(
          "/api/cases/" + c.id,
          "PATCH",
          { version: 1, priority: "HIGH" },
          "test-VIEWER",
        )
      ).status,
      403,
    );
    const visible = JSON.stringify((await request("/api/integrations")).data);
    assert.equal(visible.includes(created.signingSecret), false);
    assert.equal(visible.includes(created.reportingKey), false);
    const invalid = await fetch(callbackUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(invalid.status, 401);
    const invoke = await request(
      `/api/cases/${c.id}/actions/${patch.id}`,
      "POST",
      {
        version: 1,
        input: { country: "IN" },
        confirmed: true,
        idempotencyKey: "patch",
      },
      "test-OPERATOR",
    );
    assert.equal(invoke.status, 200);
    const worker = new Dispatcher(service, createTransport(destinations), {
      maxAttempts: 1,
    });
    await worker.tick();
    let detail = (await request(`/api/cases/${c.id}`)).data;
    assert.equal(detail.recoveryStatus, "OUTCOME_UNKNOWN");
    assert.equal(
      (await origin.vendors()).find((v) => v.id === vendor.id).mutationCount,
      1,
    );
    await request(`/api/commands/${invoke.data.command.id}/retry`, "POST", {});
    await worker.tick();
    detail = (await request(`/api/cases/${c.id}`)).data;
    assert.equal(detail.status, "OPEN");
    assert.equal(detail.commands[0].status, "SUCCEEDED");
    assert.equal(
      (await origin.vendors()).find((v) => v.id === vendor.id).mutationCount,
      1,
    );
    const next = await request(
      `/api/cases/${c.id}/actions/${verify.id}`,
      "POST",
      { version: detail.version, input: {}, idempotencyKey: "verify" },
    );
    assert.equal(next.status, 200);
    await worker.tick();
    detail = (await request(`/api/cases/${c.id}`)).data;
    assert.equal(detail.status, "RESOLVED");
    const vendorFinal = (await origin.vendors()).find(
      (v) => v.id === vendor.id,
    );
    assert.equal(vendorFinal.status, "active");
    assert.equal(vendorFinal.mutationCount, 2);
    const result = detail.commands.find(
      (cmd: any) => cmd.id === next.data.command.id,
    ).result;
    await sdk.reportResult(
      created.integration.id,
      next.data.command.id,
      result,
      created.signingSecret,
    );
    const timestamp = String(Date.now()),
      body = JSON.stringify({ ...result, message: "Conflicting" }),
      identity = `${created.integration.id}:${next.data.command.id}`;
    const conflict = await fetch(
      `${url(apiServer)}/v1/integrations/${created.integration.id}/commands/${next.data.command.id}/result`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-recoveryplane-timestamp": timestamp,
          "x-recoveryplane-signature": signPayload(
            created.signingSecret,
            timestamp,
            identity,
            body,
          ),
        },
        body,
      },
    );
    assert.equal(conflict.status, 409);
    assert.equal((await request("/api/metrics")).data.recovered, 1);
    await assert.rejects(
      db.query("UPDATE rp_audit SET data=$1 WHERE org_id=$2", [{}, org]),
      /append-only/,
    );
  } finally {
    if (originServer) await close(originServer);
    await close(apiServer);
    await db.close();
  }
});
