import { randomBytes, createHash } from "node:crypto";
const raw = randomBytes(32).toString("hex");
const user = {
  id: "pilot-admin",
  name: "Workspace Admin",
  role: "ADMIN",
  organizationId: "pilot",
  organizationName: "My Workspace",
};
console.log("Access token (save privately; enter in the console):\n" + raw);
console.log(
  "\nACCESS_TOKENS_JSON=" +
    JSON.stringify([
      { tokenHash: createHash("sha256").update(raw).digest("hex"), user },
    ]),
);
