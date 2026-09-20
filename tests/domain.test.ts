import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openDatabase } from "../packages/database/src/store.js";
import { RecoveryService } from "../apps/api/src/domain/service.js";

let db: Awaited<ReturnType<typeof openDatabase>>;
let service: RecoveryService;
const admin = {
  id: "alice",
  name: "Alice",
  organizationId: `test-a-${randomUUID()}`,
  organizationName: "Test A",
  role: "ADMIN" as const,
};
const other = { ...admin, organizationId: `test-b-${randomUUID()}` };
let integration: any;
let action: any;
const report = (key: string, extra = {}) => ({
  idempotencyKey: key,
  correlationKey: key,
  fingerprint: "missing-country",
  workflow: "onboarding",
  entity: { type: "vendor", id: key },
  exception: { type: "missing_data", message: "Country is missing" },
  context: { vendorName: key },
  availableActions: ["patch_vendor"],
  ...extra,
});
before(async () => {
  db = await openDatabase(process.env.TEST_DATABASE_URL || ":memory:");
  service = new RecoveryService(db);
  await service.ensureTenant(admin.organizationId, admin.organizationName);
  await service.ensureTenant(other.organizationId, other.organizationName);
  integration = await service.createIntegration(admin, {
    name: "Vendors",
    environment: "test",
    callbackUrl: "http://127.0.0.1:3001/recovery",
  });
  action = await service.registerAction(admin, integration.integration.id, {
    actionKey: "patch_vendor",
    label: "Update country",
    description: "Correct vendor country",
    riskLevel: "MEDIUM",
    requiresConfirmation: true,
    inputSchema: {
      type: "object",
      properties: { country: { type: "string", minLength: 2 } },
      required: ["country"],
    },
  });
});
after(async () => {
  await db?.close();
});
const ingest = (body: any) => service.report(integration.integration.id, body);
test("duplicates are one occurrence; full payload mismatch conflicts even with same fingerprint", async () => {
  const body = report("dedupe");
  const results = await Promise.all(
    Array.from({ length: 10 }, () => ingest(body)),
  );
  assert.equal(new Set(results.map((r) => r.id)).size, 1);
  assert.equal(
    (await service.getCase(admin, results[0].id)).occurrenceCount,
    1,
  );
  await assert.rejects(
    ingest({ ...body, context: { vendorName: "changed" } }),
    /Idempotency/,
  );
});
test("correlation merges unresolved problem but fingerprint never merges entities", async () => {
  const first = await ingest(report("correlation-a"));
  const second = await ingest(
    report("correlation-b", {
      correlationKey: "correlation-a",
      entity: { type: "vendor", id: "correlation-a" },
    }),
  );
  const third = await ingest(report("different-entity"));
  assert.equal(first.id, second.id);
  assert.notEqual(first.id, third.id);
  assert.equal((await service.getCase(admin, first.id)).occurrenceCount, 2);
});
test("cross tenant reads and mutations are denied", async () => {
  const c = await ingest(report("isolation"));
  await assert.rejects(service.getCase(other, c.id), /not found/);
  await assert.rejects(
    service.invoke(other, c.id, action.id, {
      version: c.version,
      input: { country: "IN" },
      idempotencyKey: "x",
      confirmed: true,
    }),
    /not found/,
  );
  assert.equal((await service.listCases(other, {})).cases.length, 0);
});
test("correlation reuse across different steps or exception types conflicts", async () => {
  await ingest(
    report("problem-identity", { step: "address", executionId: "run-1" }),
  );
  await assert.rejects(
    ingest(
      report("problem-identity-2", {
        correlationKey: "problem-identity",
        entity: { type: "vendor", id: "problem-identity" },
        step: "payment",
        executionId: "run-2",
        exception: { type: "invalid_bank_account" },
      }),
    ),
    /different business problem/,
  );
});
test("simultaneous operators create one active command; replay returns same command", async () => {
  const c = await ingest(report("concurrency"));
  const request = {
    version: c.version,
    input: { country: "IN" },
    idempotencyKey: "click-one",
    confirmed: true,
  };
  const results = await Promise.allSettled([
    service.invoke(admin, c.id, action.id, request),
    service.invoke(admin, c.id, action.id, {
      ...request,
      idempotencyKey: "click-two",
    }),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const replay = await service.invoke(admin, c.id, action.id, request);
  const detail = await service.getCase(admin, c.id);
  assert.equal(detail.commands.length, 1);
  assert.equal(replay.command.id, detail.commands[0].id);
});
test("patch success stays open; confirmed origin recovery resolves; duplicate result is safe", async () => {
  const c = await ingest(report("outcomes"));
  const invocation = await service.invoke(admin, c.id, action.id, {
    version: c.version,
    input: { country: "IN" },
    idempotencyKey: "patch",
    confirmed: true,
  });
  const result = {
    outcome: "SUCCEEDED",
    caseDisposition: "UNCHANGED",
    message: "Country updated",
  };
  await service.acceptResult(
    integration.integration.id,
    invocation.command.id,
    result,
  );
  let detail = await service.getCase(admin, c.id);
  assert.equal(detail.status, "OPEN");
  assert.equal(detail.commands[0].status, "SUCCEEDED");
  await service.acceptResult(
    integration.integration.id,
    invocation.command.id,
    result,
  );
  await assert.rejects(
    service.acceptResult(integration.integration.id, invocation.command.id, {
      ...result,
      caseDisposition: "RESOLVED",
    }),
    /Conflicting/,
  );
  const verify = await service.invoke(admin, c.id, action.id, {
    version: detail.version,
    input: { country: "IN" },
    idempotencyKey: "verify",
    confirmed: true,
  });
  await service.acceptResult(integration.integration.id, verify.command.id, {
    outcome: "SUCCEEDED",
    caseDisposition: "RESOLVED",
    message: "Verified",
  });
  detail = await service.getCase(admin, c.id);
  assert.equal(detail.status, "RESOLVED");
});
test("another integration cannot submit result", async () => {
  const c = await ingest(report("result-scope"));
  const { command } = await service.invoke(admin, c.id, action.id, {
    version: c.version,
    input: { country: "IN" },
    idempotencyKey: "scope",
    confirmed: true,
  });
  await assert.rejects(
    service.acceptResult("foreign", command.id, {
      outcome: "SUCCEEDED",
      caseDisposition: "RESOLVED",
      message: "x",
    }),
    /not found/,
  );
});
test("invalid action input and missing confirmation do not queue commands", async () => {
  const c = await ingest(report("validation"));
  await assert.rejects(
    service.invoke(admin, c.id, action.id, {
      version: c.version,
      input: { country: "I" },
      idempotencyKey: "bad-input",
      confirmed: true,
    }),
    /country/,
  );
  await assert.rejects(
    service.invoke(admin, c.id, action.id, {
      version: c.version,
      input: { country: "IN" },
      idempotencyKey: "bad-confirm",
      confirmed: false,
    }),
    /confirmation/i,
  );
  assert.equal((await service.getCase(admin, c.id)).commands.length, 0);
});
test("viewer cannot mutate and operator cannot provision", async () => {
  const c = await ingest(report("roles"));
  await assert.rejects(
    service.updateCase({ ...admin, role: "VIEWER" }, c.id, {
      version: c.version,
      priority: "HIGH",
    }),
    /permission/i,
  );
  await assert.rejects(
    service.createIntegration(
      { ...admin, role: "OPERATOR" },
      {
        name: "x",
        environment: "test",
        callbackUrl: "https://example.com/callback",
      },
    ),
    /permission/i,
  );
});
test("current disable blocks action on historical case", async () => {
  const c = await ingest(report("revoked"));
  await service.setActionEnabled(
    admin,
    integration.integration.id,
    action.id,
    false,
  );
  await assert.rejects(
    service.invoke(admin, c.id, action.id, {
      version: c.version,
      input: { country: "IN" },
      idempotencyKey: "revoked",
      confirmed: true,
    }),
    /disabled/i,
  );
  await service.setActionEnabled(
    admin,
    integration.integration.id,
    action.id,
    true,
  );
});
