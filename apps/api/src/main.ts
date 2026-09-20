import "dotenv/config";
import { resolve } from "node:path";
import { openDatabase } from "../../../packages/database/src/store.js";
import { RecoveryService } from "./domain/service.js";
import { createApp } from "./server.js";
import { prepareDemo } from "./demo.js";
import { Dispatcher } from "../../worker/src/dispatcher.js";
import { createTransport } from "../../worker/src/transport.js";
import { startDispatcher } from "../../worker/src/lifecycle.js";

const demo = process.env.DEMO_MODE === "true";
const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 3000),
  originPort = Number(process.env.DEMO_PORT ?? 3001);
if (demo && host !== "127.0.0.1" && process.env.ALLOW_PUBLIC_DEMO !== "true")
  throw new Error(
    "Demo mode binds to loopback. Set ALLOW_PUBLIC_DEMO=true only for an isolated sample deployment.",
  );
const db = await openDatabase(
  process.env.DATABASE_URL ?? resolve(".data/recoveryplane"),
);
const service = new RecoveryService(db);
const demoService = demo
  ? await prepareDemo(service, `http://127.0.0.1:${port}`, originPort)
  : undefined;
const localDestinations = demo
  ? [`http://127.0.0.1:${originPort}/recovery`]
  : [];
const { app, auth } = createApp(service, {
  demo,
  tokens: process.env.ACCESS_TOKENS_JSON,
  localDestinations,
  demoService,
  staticDir: resolve("apps/web/dist"),
});
for (const member of auth.members)
  await service.ensureTenant(member.organizationId, member.organizationName);
await demoService?.start();
const server = app.listen(port, host, () =>
  console.log(
    `RecoveryPlane API ready at http://${host}:${port} (${db.mode}${demo ? ", demo workspace" : ""})`,
  ),
);
await new Promise<void>((resolve, reject) => {
  if (server.listening) resolve();
  else server.once("listening", resolve);
  server.once("error", reject);
});
await demoService?.seed();
const dispatcher = new Dispatcher(service, createTransport(localDestinations));
const loop =
  process.env.DISPATCHER_ENABLED === "false"
    ? undefined
    : startDispatcher(dispatcher, (error) =>
        console.error(
          JSON.stringify({
            level: "error",
            component: "dispatcher",
            message: error.message,
          }),
        ),
      );
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  await loop?.stop();
  await demoService?.close();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.close();
}
process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});
