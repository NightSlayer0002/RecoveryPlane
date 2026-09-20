import { RecoveryService } from "./domain/service.js";
import { demoUsers } from "./auth.js";
import { hashToken } from "./domain/utils.js";
import { RecoveryPlane } from "../../../packages/sdk/src/index.js";
import { createOrigin } from "../../vendor-onboarding-demo/src/origin.js";
import type { Server } from "node:http";

const demoKey = "rp_demo_reporting_local_only";
export async function prepareDemo(
  service: RecoveryService,
  apiUrl: string,
  originPort: number,
) {
  const admin = demoUsers.find((u) => u.role === "ADMIN")!;
  await service.ensureTenant(admin.organizationId, admin.organizationName);
  let integration = (
    await service.db.query(
      "SELECT * FROM rp_integrations WHERE org_id=$1 ORDER BY data->>'createdAt' LIMIT 1",
      [admin.organizationId],
    )
  ).rows[0];
  if (!integration) {
    const created = await service.createIntegration(admin, {
      name: "Vendor onboarding",
      environment: "sandbox",
      callbackUrl: `http://127.0.0.1:${originPort}/recovery`,
    });
    await service.db.query(
      "UPDATE rp_integrations SET reporting_hash=$2 WHERE id=$1",
      [created.integration.id, hashToken(demoKey)],
    );
    const country = {
      type: "object",
      properties: {
        country: {
          type: "string",
          title: "Vendor country",
          description: "Country used for vendor verification.",
          enum: ["IN", "US", "GB", "DE", "CA", "AU", "SG"],
        },
      },
      required: ["country"],
    };
    await service.registerAction(admin, created.integration.id, {
      actionKey: "patch_vendor",
      label: "Update vendor details",
      description:
        "Supply the missing country. Verification is a separate step.",
      riskLevel: "MEDIUM",
      requiresConfirmation: true,
      inputSchema: country,
    });
    await service.registerAction(admin, created.integration.id, {
      actionKey: "retry_verification",
      label: "Retry verification",
      description: "Ask the origin to verify the vendor and resume onboarding.",
      inputSchema: { type: "object", properties: {} },
    });
    await service.registerAction(admin, created.integration.id, {
      actionKey: "cancel_onboarding",
      label: "Cancel onboarding",
      description:
        "Stop this onboarding operation. Cancellation is not recovery.",
      riskLevel: "MEDIUM",
      requiresConfirmation: true,
      inputSchema: {
        type: "object",
        properties: {
          reason: {
            type: "string",
            title: "Cancellation reason",
            minLength: 3,
            maxLength: 500,
          },
        },
        required: ["reason"],
      },
    });
    integration = (
      await service.db.query("SELECT * FROM rp_integrations WHERE id=$1", [
        created.integration.id,
      ])
    ).rows[0];
  }
  const origin = await createOrigin(service.db, integration.secret);
  const sdk = new RecoveryPlane({ apiKey: demoKey, baseUrl: apiUrl });
  let sequence = (await origin.vendors()).length;
  const names = [
    "Northstar Supplies",
    "Atlas Manufacturing",
    "Evergreen Logistics",
    "Meridian Studio",
    "Copper & Co.",
    "Harbor Technologies",
  ];
  const scenario = async (type: string) => {
    const name = names[sequence++ % names.length];
    const vendor = await origin.addVendor(name, type === "lost_response");
    const report = {
      idempotencyKey: `${vendor.id}:missing-country`,
      correlationKey: `${vendor.id}:onboarding`,
      fingerprint: "vendor-country-required-v1",
      title: `${name} is missing a country`,
      priority: sequence % 3 === 0 ? ("HIGH" as const) : ("MEDIUM" as const),
      workflow: "Vendor onboarding",
      step: "Verify business details",
      entity: { type: "vendor", id: vendor.id },
      exception: {
        type: "missing_country",
        message:
          "Vendor verification is blocked because the business country is missing. Update the vendor details, then retry verification.",
      },
      context: {
        vendorName: name,
        vendorEmail: `onboarding@${name.toLowerCase().replace(/[^a-z]/g, "")}.example`,
        country: null,
        source: "Supplier portal",
        businessImpact: "Vendor cannot receive purchase orders",
        scenario: type,
      },
      availableActions: [
        "patch_vendor",
        "retry_verification",
        "cancel_onboarding",
      ],
    };
    const result = await sdk.exceptions.report(report);
    if (type === "duplicate_reports")
      await Promise.all(
        Array.from({ length: 9 }, () => sdk.exceptions.report(report)),
      );
    return {
      caseId: result.id,
      message:
        type === "duplicate_reports"
          ? "Ten reports delivered. One occurrence created."
          : type === "lost_response"
            ? "On the first action, the origin will commit then drop its response. The same command will be reconciled."
            : "A vendor exception was reported by the origin service.",
    };
  };
  let server: Server;
  return {
    scenario,
    vendors: origin.vendors,
    async start() {
      server = await new Promise<Server>((resolve, reject) => {
        const s = origin.app.listen(originPort, "127.0.0.1", () => resolve(s));
        s.on("error", reject);
      });
    },
    async seed() {
      if (!(await service.listCases(admin, {})).cases.length)
        for (let i = 0; i < 3; i++) await scenario("missing_country");
    },
    async close() {
      if (server)
        await new Promise<void>((resolve, reject) => {
          server.closeAllConnections();
          server.close((e) => (e ? reject(e) : resolve()));
        });
    },
  };
}
