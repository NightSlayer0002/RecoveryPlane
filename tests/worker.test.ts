import { test } from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../packages/database/src/store.js";
import { RecoveryService } from "../apps/api/src/domain/service.js";
import { Dispatcher } from "../apps/worker/src/dispatcher.js";
import { isPublicAddress } from "../apps/worker/src/transport.js";
const user = {
  id: "w",
  name: "Worker test",
  organizationId: "worker-test",
  organizationName: "Worker",
  role: "ADMIN" as const,
};
async function setup() {
  const db = await openDatabase(":memory:");
  const service = new RecoveryService(db);
  await service.ensureTenant(user.organizationId, "Worker");
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
    idempotencyKey: "w",
    correlationKey: "w",
    fingerprint: "w",
    workflow: "test",
    entity: { type: "vendor", id: "w" },
    exception: { type: "error" },
    availableActions: ["retry"],
  });
  const { command } = await service.invoke(user, c.id, action.id, {
    version: c.version,
    input: {},
    idempotencyKey: "cmd",
  });
  return { db, service, integration, action, c, command };
}
test("uncertain delivery preserves command identity and recovers through reconciliation", async () => {
  const { db, service, c, command } = await setup();
  try {
    const identities: string[] = [];
    let mutations = 0;
    const receipts = new Set();
    const worker = new Dispatcher(
      service,
      async (_url, envelope) => {
        identities.push(envelope.commandId);
        if (!receipts.has(envelope.commandId)) {
          receipts.add(envelope.commandId);
          mutations++;
          throw new Error("Response lost after commit");
        }
        return {
          outcome: "SUCCEEDED",
          caseDisposition: "RESOLVED",
          message: "Recovered",
        };
      },
      { maxAttempts: 1 },
    );
    await worker.tick();
    assert.equal(
      (await service.getCase(user, c.id)).recoveryStatus,
      "OUTCOME_UNKNOWN",
    );
    await assert.rejects(
      service.invoke(
        user,
        c.id,
        (await service.getCase(user, c.id)).actions[0].id,
        {
          version: (await service.getCase(user, c.id)).version,
          input: {},
          idempotencyKey: "new",
        },
      ),
      /active command/,
    );
    await service.retry(user, command.id);
    await worker.tick();
    assert.equal((await service.getCase(user, c.id)).status, "RESOLVED");
    assert.deepEqual(identities, [command.id, command.id]);
    assert.equal(mutations, 1);
  } finally {
    await db.close();
  }
});
test("revocation is checked again after queueing", async () => {
  const { db, service, c, integration, action } = await setup();
  try {
    let delivered = false;
    const worker = new Dispatcher(service, async () => {
      delivered = true;
      return {};
    });
    await service.setActionEnabled(user, integration.id, action.id, false);
    await worker.tick();
    assert.equal(delivered, false);
    assert.equal(
      (await service.getCase(user, c.id)).commands[0].status,
      "BLOCKED",
    );
  } finally {
    await db.close();
  }
});
test("private, loopback, mapped and special addresses are not public", () => {
  for (const address of [
    "127.0.0.1",
    "10.1.2.3",
    "169.254.169.254",
    "192.168.1.2",
    "172.16.0.1",
    "0.0.0.0",
    "100.64.1.1",
    "224.1.1.1",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "fe80::1",
    "2001:db8::1",
  ])
    assert.equal(isPublicAddress(address), false, address);
  assert.equal(isPublicAddress("8.8.8.8"), true);
  assert.equal(isPublicAddress("2606:4700:4700::1111"), true);
});
test("an expired lease is reclaimed and a stale worker cannot overwrite the confirmed outcome", async () => {
  const { db, service, c, command } = await setup();
  try {
    let release!: (result: unknown) => void, signal!: () => void;
    const started = new Promise<void>((resolve) => {
      signal = resolve;
    });
    const oldWorker = new Dispatcher(service, async () => {
      signal();
      return new Promise((resolve) => {
        release = resolve;
      });
    });
    const original = oldWorker.tick();
    await started;
    await db.query(
      "UPDATE rp_outbox SET lease_until=now()-interval '1 second' WHERE command_id=$1",
      [command.id],
    );
    const newWorker = new Dispatcher(service, async () => ({
      outcome: "SUCCEEDED",
      caseDisposition: "RESOLVED",
      message: "Origin confirmed",
    }));
    await newWorker.tick();
    release({
      outcome: "FAILED",
      caseDisposition: "UNCHANGED",
      message: "Stale response",
    });
    await original;
    const detail = await service.getCase(user, c.id);
    assert.equal(detail.status, "RESOLVED");
    assert.equal(detail.commands[0].result.message, "Origin confirmed");
  } finally {
    await db.close();
  }
});
