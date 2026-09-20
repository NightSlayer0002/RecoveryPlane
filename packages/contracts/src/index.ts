import { z } from "zod";
const key = z.string().trim().min(1).max(200);
export const RoleSchema = z.enum(["ADMIN", "OPERATOR", "VIEWER"]);
export type Role = z.infer<typeof RoleSchema>;
export type User = {
  id: string;
  name: string;
  organizationId: string;
  organizationName: string;
  role: Role;
};
export const PrioritySchema = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
export const RiskLevelSchema = z.enum(["LOW", "MEDIUM"]);
export const ReportExceptionRequestSchema = z
  .object({
    idempotencyKey: key,
    correlationKey: key,
    fingerprint: key,
    workflow: key,
    executionId: key.optional(),
    step: key.optional(),
    title: z.string().min(1).max(200).optional(),
    priority: PrioritySchema.default("MEDIUM"),
    entity: z.object({ type: key, id: key }).strict(),
    exception: z
      .object({ type: key, message: z.string().max(4000).optional() })
      .strict(),
    context: z.record(z.unknown()).default({}),
    availableActions: z.array(key).max(20),
  })
  .strict();
export type ReportExceptionRequest = z.input<
  typeof ReportExceptionRequestSchema
>;
const field = z
  .object({
    type: z.enum(["string", "number", "boolean"]),
    title: z.string().max(100).optional(),
    description: z.string().max(500).optional(),
    enum: z.array(z.string()).min(1).max(100).optional(),
    minLength: z.number().int().min(0).max(4000).optional(),
    maxLength: z.number().int().min(1).max(4000).optional(),
    minimum: z.number().finite().optional(),
    maximum: z.number().finite().optional(),
  })
  .strict();
export const InputSchema = z
  .object({
    type: z.literal("object"),
    properties: z.record(field),
    required: z.array(z.string()).default([]),
    additionalProperties: z.literal(false).optional(),
  })
  .strict()
  .superRefine((s, ctx) => {
    if (Object.keys(s.properties).length > 20)
      ctx.addIssue({ code: "custom", message: "At most 20 fields" });
    for (const name of s.required)
      if (!s.properties[name])
        ctx.addIssue({
          code: "custom",
          message: `Unknown required field: ${name}`,
        });
    for (const [name, f] of Object.entries(s.properties)) {
      if (["__proto__", "constructor", "prototype"].includes(name))
        ctx.addIssue({ code: "custom", message: "Reserved field name" });
      if (f.enum && f.type !== "string")
        ctx.addIssue({
          code: "custom",
          message: `${name}: enums require string fields`,
        });
      if (
        (f.minLength !== undefined || f.maxLength !== undefined) &&
        f.type !== "string"
      )
        ctx.addIssue({
          code: "custom",
          message: `${name}: length requires string field`,
        });
      if (
        (f.minimum !== undefined || f.maximum !== undefined) &&
        f.type !== "number"
      )
        ctx.addIssue({
          code: "custom",
          message: `${name}: bounds require number field`,
        });
      if (
        (f.minLength ?? 0) > (f.maxLength ?? 4000) ||
        (f.minimum ?? -Infinity) > (f.maximum ?? Infinity)
      )
        ctx.addIssue({ code: "custom", message: `${name}: invalid bounds` });
    }
  });
export const RegisterActionRequestSchema = z
  .object({
    actionKey: key.regex(/^[a-z][a-z0-9_]*$/),
    label: z.string().trim().min(1).max(120),
    description: z.string().max(500).default(""),
    inputSchema: InputSchema,
    riskLevel: RiskLevelSchema.default("LOW"),
    requiresConfirmation: z.boolean().default(false),
    requiresApproval: z.literal(false).optional(),
  })
  .strict();
export type RegisterActionRequest = z.input<typeof RegisterActionRequestSchema>;
export const InvokeActionRequestSchema = z
  .object({
    version: z.number().int().positive(),
    input: z.record(z.unknown()).default({}),
    idempotencyKey: key,
    confirmed: z.boolean().default(false),
  })
  .strict();
export const ResultSchema = z
  .object({
    outcome: z.enum(["SUCCEEDED", "FAILED"]),
    caseDisposition: z.enum(["UNCHANGED", "RESOLVED", "CANCELLED"]),
    message: z.string().min(1).max(2000),
  })
  .strict()
  .refine(
    (r) => r.outcome === "SUCCEEDED" || r.caseDisposition === "UNCHANGED",
    "A failed action cannot close a case",
  );
export type RecoveryResult = z.infer<typeof ResultSchema>;
export type RecoveryEnvelope = {
  commandId: string;
  integrationId: string;
  caseId: string;
  actionKey: string;
  actionVersion: number;
  entity: { type: string; id: string };
  input: Record<string, unknown>;
};
export const WebhookHeaders = {
  COMMAND_ID: "x-recoveryplane-command-id",
  TIMESTAMP: "x-recoveryplane-timestamp",
  SIGNATURE: "x-recoveryplane-signature",
} as const;
export function validateInput(
  schema: z.infer<typeof InputSchema>,
  input: Record<string, unknown>,
) {
  for (const name of Object.keys(input))
    if (!Object.hasOwn(schema.properties, name))
      throw new Error(`Unknown input field: ${name}`);
  for (const [name, f] of Object.entries(schema.properties)) {
    const value = input[name];
    if (value === undefined) {
      if (schema.required.includes(name))
        throw new Error(`${name} is required`);
      continue;
    }
    if (typeof value !== f.type) throw new Error(`${name} must be a ${f.type}`);
    if (
      typeof value === "string" &&
      (value.length < (f.minLength ?? 0) ||
        value.length > (f.maxLength ?? 4000) ||
        (f.enum && !f.enum.includes(value)))
    )
      throw new Error(`${name} is outside the allowed values or length`);
    if (
      typeof value === "number" &&
      (!Number.isFinite(value) ||
        value < (f.minimum ?? -Infinity) ||
        value > (f.maximum ?? Infinity))
    )
      throw new Error(`${name} is outside the allowed range`);
  }
}
