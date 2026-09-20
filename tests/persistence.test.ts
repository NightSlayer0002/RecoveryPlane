import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { openDatabase } from "../packages/database/src/store.js";
import { RecoveryService } from "../apps/api/src/domain/service.js";

test("cases, command identity and audit survive a database restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "recoveryplane-test-"));
  const dataDir = join(directory, "database");
  let db = await openDatabase(dataDir);
  const user = {
    id: "admin",
    name: "Admin",
    role: "ADMIN" as const,
    organizationId: "persistence",
    organizationName: "Persistence",
  };
  let caseId: string, commandId: string;
  try {
    let service = new RecoveryService(db);
    await service.ensureTenant(user.organizationId, user.organizationName);
    const { integration } = await service.createIntegration(user, {
      name: "Test",
      environment: "test",
      callbackUrl: "https://example.com/recovery",
    });
    const action = await service.registerAction(user, integration.id, {
      actionKey: "retry",
      label: "Retry",
      inputSchema: { type: "object", properties: {} },
    });
    const c = await service.report(integration.id, {
      idempotencyKey: "durable",
      correlationKey: "durable",
      fingerprint: "error",
      workflow: "test",
      entity: { type: "job", id: "durable" },
      exception: { type: "error" },
      availableActions: ["retry"],
    });
    caseId = c.id;
    const { command } = await service.invoke(user, c.id, action.id, {
      version: 1,
      input: {},
      idempotencyKey: "durable-command",
    });
    commandId = command.id;
    await db.close();
    db = await openDatabase(dataDir);
    service = new RecoveryService(db);
    const restored = await service.getCase(user, caseId);
    assert.equal(restored.commands[0].id, commandId);
    assert.equal(restored.recoveryStatus, "QUEUED");
    assert.equal(restored.timeline.length, 2);
    assert.equal(
      (
        await db.query("SELECT done FROM rp_outbox WHERE command_id=$1", [
          commandId,
        ])
      ).rows[0].done,
      false,
    );
  } finally {
    await db.close();
    // Delete only the unique directory this test created, after verifying its resolved boundary.
    if (
      !resolve(directory).startsWith(resolve(tmpdir()) + sep) ||
      !directory.includes("recoveryplane-test-")
    )
      throw new Error("Unexpected test directory");
    await rm(directory, { recursive: true, force: true });
  }
});
