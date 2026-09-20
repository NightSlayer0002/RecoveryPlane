import "dotenv/config";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
const require = createRequire(
  new URL("../apps/web/package.json", import.meta.url),
);
const vite = join(
  dirname(require.resolve("vite/package.json")),
  "bin",
  "vite.js",
);
const processes = [
  spawn(process.execPath, ["--import", "tsx", "apps/api/src/main.ts"], {
    stdio: "inherit",
    env: { ...process.env, DEMO_MODE: process.env.DEMO_MODE ?? "true" },
    windowsHide: true,
  }),
  spawn(process.execPath, [vite, "--host", "127.0.0.1"], {
    cwd: new URL("../apps/web/", import.meta.url),
    stdio: "inherit",
    windowsHide: true,
  }),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of processes) child.kill();
  process.exitCode = code;
}
for (const child of processes) child.on("exit", (code) => stop(code ?? 0));
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
