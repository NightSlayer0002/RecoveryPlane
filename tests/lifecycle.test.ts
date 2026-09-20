import { test } from "node:test";
import assert from "node:assert/strict";
import { approvedDestination } from "../apps/worker/src/transport.js";
import { startDispatcher } from "../apps/worker/src/lifecycle.js";
test("DNS lookup is bounded before opening any socket", async () => {
  await assert.rejects(
    approvedDestination(
      "https://example.test/recovery",
      [],
      20,
      async () => new Promise(() => {}),
    ),
    /resolution timed out/,
  );
});
test("shutdown waits for the actual outstanding delivery despite multiple timer intervals", async () => {
  let release!: () => void, entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const loop = startDispatcher(
    {
      async tick() {
        calls++;
        entered();
        await pending;
      },
    },
    () => {},
    5,
  );
  await started;
  await new Promise((resolve) => setTimeout(resolve, 25));
  let stopped = false;
  const stop = loop.stop().then(() => {
    stopped = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(stopped, false);
  assert.equal(calls, 1);
  release();
  await stop;
  assert.equal(stopped, true);
});
