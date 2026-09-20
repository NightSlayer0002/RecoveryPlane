import "dotenv/config";
import { openDatabase } from "../../../packages/database/src/store.js";
import { RecoveryService } from "../../api/src/domain/service.js";
import { Dispatcher } from "./dispatcher.js";
if (!process.env.DATABASE_URL?.startsWith("postgres"))
  throw new Error(
    "A standalone worker requires server PostgreSQL; local PGlite is single-process",
  );
const db = await openDatabase(process.env.DATABASE_URL);
const dispatcher = new Dispatcher(new RecoveryService(db));
let stopping = false;
process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});
while (!stopping) {
  try {
    await dispatcher.tick();
  } catch (error) {
    console.error(error);
  }
  await new Promise((r) => setTimeout(r, 1000));
}
await db.close();
