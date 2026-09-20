import express from "express";
import { z } from "zod";
import type { Database } from "../../../packages/database/src/store.js";
import { RecoveryPlane } from "../../../packages/sdk/src/index.js";
import { hash, id } from "../../api/src/domain/utils.js";
import type { RecoveryResult } from "../../../packages/contracts/src/index.js";

export async function createOrigin(db: Database, secret: string) {
  await db.query(
    "CREATE TABLE IF NOT EXISTS demo_vendors(id text PRIMARY KEY,data jsonb NOT NULL)",
  );
  await db.query(
    "CREATE TABLE IF NOT EXISTS demo_receipts(id text PRIMARY KEY,payload_hash text NOT NULL,result jsonb NOT NULL)",
  );
  const app = express();
  app.use(
    express.json({
      limit: "64kb",
      verify: (req: any, _res, bytes) => {
        req.rawBody = bytes;
      },
    }),
  );
  const sdk = new RecoveryPlane({ apiKey: "", baseUrl: "http://127.0.0.1" });
  app.post(
    "/recovery",
    sdk.middleware.verifySignature(secret),
    async (req, res) => {
      try {
        const envelope = z
          .object({
            commandId: z.string(),
            integrationId: z.string(),
            caseId: z.string(),
            actionKey: z.enum([
              "patch_vendor",
              "retry_verification",
              "cancel_onboarding",
            ]),
            actionVersion: z.literal(1),
            entity: z.object({ type: z.literal("vendor"), id: z.string() }),
            input: z.record(z.unknown()),
          })
          .strict()
          .parse(req.body);
        const processed = await db.transaction(async (tx) => {
          // Lock the entity first: duplicate deliveries cannot race its mutation and receipt.
          const row = (
            await tx.query(
              "SELECT data FROM demo_vendors WHERE id=$1 FOR UPDATE",
              [envelope.entity.id],
            )
          ).rows[0];
          if (!row) throw new Error("Vendor does not exist");
          const receipt = (
            await tx.query("SELECT * FROM demo_receipts WHERE id=$1", [
              envelope.commandId,
            ])
          ).rows[0];
          if (receipt) {
            if (receipt.payload_hash !== hash(envelope))
              throw new Error(
                "Command identity reused with mismatched payload",
              );
            return { result: receipt.result as RecoveryResult, lose: false };
          }
          const vendor = row.data;
          let result: RecoveryResult;
          if (vendor.status !== "pending")
            result = {
              outcome: "FAILED",
              caseDisposition: "UNCHANGED",
              message:
                "Precondition changed: this onboarding is no longer pending",
            };
          else if (envelope.actionKey === "patch_vendor") {
            const input = z
              .object({
                country: z.enum(["IN", "US", "GB", "DE", "CA", "AU", "SG"]),
              })
              .strict()
              .parse(envelope.input);
            vendor.country = input.country;
            vendor.mutationCount++;
            result = {
              outcome: "SUCCEEDED",
              caseDisposition: "UNCHANGED",
              message: `Country updated to ${input.country}. Run verification to finish recovery.`,
            };
          } else if (envelope.actionKey === "retry_verification") {
            z.object({}).strict().parse(envelope.input);
            if (!vendor.country)
              result = {
                outcome: "FAILED",
                caseDisposition: "UNCHANGED",
                message:
                  "Country is still missing. Update vendor details before retrying verification.",
              };
            else {
              vendor.status = "active";
              vendor.mutationCount++;
              result = {
                outcome: "SUCCEEDED",
                caseDisposition: "RESOLVED",
                message: "Vendor verification passed. Onboarding has resumed.",
              };
            }
          } else {
            z.object({ reason: z.string().min(3).max(500) })
              .strict()
              .parse(envelope.input);
            vendor.status = "cancelled";
            vendor.mutationCount++;
            result = {
              outcome: "SUCCEEDED",
              caseDisposition: "CANCELLED",
              message: "Vendor onboarding cancelled by operator request.",
            };
          }
          const lose = !!vendor.loseNextResponse;
          vendor.loseNextResponse = false;
          await tx.query("UPDATE demo_vendors SET data=$2 WHERE id=$1", [
            vendor.id,
            vendor,
          ]);
          await tx.query(
            "INSERT INTO demo_receipts(id,payload_hash,result) VALUES($1,$2,$3)",
            [envelope.commandId, hash(envelope), result],
          );
          return { result, lose };
        });
        if (processed.lose) {
          req.socket.destroy();
          return;
        }
        res.json(processed.result);
      } catch (error) {
        res
          .status(409)
          .json({
            error:
              error instanceof Error
                ? error.message
                : "Origin rejected command",
          });
      }
    },
  );
  return {
    app,
    async addVendor(name: string, loseNextResponse = false) {
      const vendor = {
        id: id("vendor"),
        name,
        country: null,
        status: "pending",
        mutationCount: 0,
        loseNextResponse,
      };
      await db.query("INSERT INTO demo_vendors(id,data) VALUES($1,$2)", [
        vendor.id,
        vendor,
      ]);
      return vendor;
    },
    async vendors() {
      return (await db.query("SELECT data FROM demo_vendors")).rows.map(
        ({ data }) => {
          const { loseNextResponse, ...visible } = data;
          return visible;
        },
      );
    },
  };
}
