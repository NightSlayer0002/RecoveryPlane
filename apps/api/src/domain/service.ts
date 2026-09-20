import { z } from "zod";
import type { Database, Sql } from "../../../../packages/database/src/store.js";
import {
  ReportExceptionRequestSchema,
  RegisterActionRequestSchema,
  InvokeActionRequestSchema,
  ResultSchema,
  PrioritySchema,
  validateInput,
  type User,
} from "../../../../packages/contracts/src/index.js";
import { AppError, requireRole } from "./errors.js";
import { hash, hashToken, id, now, token } from "./utils.js";

export const activeStatuses = [
  "QUEUED",
  "AWAITING_CONFIRMATION",
  "OUTCOME_UNKNOWN",
];
export async function audit(
  tx: Sql,
  org: string,
  caseId: string | null,
  actor: string,
  eventType: string,
  message: string,
) {
  const event = {
    id: id("evt"),
    eventType,
    actorName: actor,
    message,
    createdAt: now(),
    caseId,
  };
  await tx.query(
    "INSERT INTO rp_audit(id,org_id,case_id,data) VALUES($1,$2,$3,$4)",
    [event.id, org, caseId, event],
  );
}
export async function saveCase(tx: Sql, c: any) {
  c.version++;
  c.updatedAt = now();
  await tx.query(
    "UPDATE rp_cases SET status=$2,version=$3,data=$4 WHERE id=$1",
    [c.id, c.status, c.version, c],
  );
}
export class RecoveryService {
  constructor(
    public db: Database,
    public members: User[] = [],
  ) {}
  async ensureTenant(org: string, name: string) {
    await this.db.query(
      "INSERT INTO rp_tenants(id,name) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [org, name],
    );
  }
  async locked<T>(org: string, fn: (tx: Sql) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      const r = await tx.query(
        "SELECT id FROM rp_tenants WHERE id=$1 FOR UPDATE",
        [org],
      );
      if (!r.rows.length) throw new AppError(404, "Workspace not found");
      return fn(tx);
    });
  }
  async integration(tx: Sql, org: string, integrationId: string) {
    const r = await tx.query(
      "SELECT * FROM rp_integrations WHERE id=$1 AND org_id=$2",
      [integrationId, org],
    );
    if (!r.rows[0]) throw new AppError(404, "Integration not found");
    return r.rows[0];
  }
  async caseRow(tx: Sql, org: string, caseId: string) {
    const r = await tx.query(
      "SELECT * FROM rp_cases WHERE id=$1 AND org_id=$2",
      [caseId, org],
    );
    if (!r.rows[0]) throw new AppError(404, "Case not found");
    return r.rows[0];
  }
  async createIntegration(user: User, input: unknown) {
    requireRole(user.role, ["ADMIN"]);
    const data = z
      .object({
        name: z.string().trim().min(1).max(100),
        environment: z.string().trim().min(1).max(40),
        callbackUrl: z.string().url().max(2000),
      })
      .strict()
      .parse(input);
    const reportingKey = `rp_report_${token()}`,
      signingSecret = token();
    const integration = {
      ...data,
      id: id("int"),
      enabled: true,
      createdAt: now(),
      lastEventAt: null,
    };
    await this.locked(user.organizationId, async (tx) => {
      await tx.query(
        "INSERT INTO rp_integrations(id,org_id,data,reporting_hash,secret) VALUES($1,$2,$3,$4,$5)",
        [
          integration.id,
          user.organizationId,
          integration,
          hashToken(reportingKey),
          signingSecret,
        ],
      );
      await audit(
        tx,
        user.organizationId,
        null,
        user.name,
        "INTEGRATION_CREATED",
        `Connected ${data.name} (${data.environment})`,
      );
    });
    return { integration, reportingKey, signingSecret };
  }
  async registerAction(user: User, integrationId: string, input: unknown) {
    requireRole(user.role, ["ADMIN"]);
    const data = RegisterActionRequestSchema.parse(input);
    return this.locked(user.organizationId, async (tx) => {
      await this.integration(tx, user.organizationId, integrationId);
      const current = (
        await tx.query(
          "SELECT version,enabled FROM rp_actions WHERE integration_id=$1 AND action_key=$2 ORDER BY version DESC LIMIT 1",
          [integrationId, data.actionKey],
        )
      ).rows[0];
      const action = {
        ...data,
        id: id("act"),
        version: (current?.version ?? 0) + 1,
        enabled: current?.enabled ?? true,
        requiresConfirmation:
          data.requiresConfirmation || data.riskLevel === "MEDIUM",
      };
      await tx.query(
        "INSERT INTO rp_actions(id,org_id,integration_id,action_key,version,enabled,data) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          action.id,
          user.organizationId,
          integrationId,
          action.actionKey,
          action.version,
          action.enabled,
          action,
        ],
      );
      await audit(
        tx,
        user.organizationId,
        null,
        user.name,
        "ACTION_REGISTERED",
        `Registered ${action.label} v${action.version}`,
      );
      return action;
    });
  }
  async setIntegrationEnabled(
    user: User,
    integrationId: string,
    enabled: boolean,
  ) {
    requireRole(user.role, ["ADMIN"]);
    z.boolean().parse(enabled);
    await this.locked(user.organizationId, async (tx) => {
      const row = await this.integration(
        tx,
        user.organizationId,
        integrationId,
      );
      await tx.query("UPDATE rp_integrations SET data=$2 WHERE id=$1", [
        integrationId,
        { ...row.data, enabled },
      ]);
      await audit(
        tx,
        user.organizationId,
        null,
        user.name,
        "INTEGRATION_UPDATED",
        `${enabled ? "Enabled" : "Disabled"} ${row.data.name}`,
      );
    });
    return (await this.listIntegrations(user)).integrations.find(
      (i) => i.id === integrationId,
    );
  }
  async setActionEnabled(
    user: User,
    integrationId: string,
    actionId: string,
    enabled: boolean,
  ) {
    requireRole(user.role, ["ADMIN"]);
    z.boolean().parse(enabled);
    return this.locked(user.organizationId, async (tx) => {
      await this.integration(tx, user.organizationId, integrationId);
      const row = (
        await tx.query(
          "SELECT * FROM rp_actions WHERE id=$1 AND integration_id=$2",
          [actionId, integrationId],
        )
      ).rows[0];
      if (!row) throw new AppError(404, "Action not found");
      await tx.query(
        "UPDATE rp_actions SET enabled=$3 WHERE integration_id=$1 AND action_key=$2",
        [integrationId, row.action_key, enabled],
      );
      await audit(
        tx,
        user.organizationId,
        null,
        user.name,
        "ACTION_UPDATED",
        `${enabled ? "Enabled" : "Disabled"} ${row.data.label} across all versions`,
      );
      return { ...row.data, enabled };
    });
  }
  async listIntegrations(user: User) {
    const rows = (
      await this.db.query(
        "SELECT id,data FROM rp_integrations WHERE org_id=$1 ORDER BY data->>'createdAt'",
        [user.organizationId],
      )
    ).rows;
    const integrations = [];
    for (const row of rows) {
      const actions = (
        await this.db.query(
          "SELECT DISTINCT ON(action_key) data,enabled FROM rp_actions WHERE integration_id=$1 ORDER BY action_key,version DESC",
          [row.id],
        )
      ).rows.map((a) => ({ ...a.data, enabled: a.enabled }));
      const count = (
        await this.db.query(
          "SELECT count(*)::int AS count FROM rp_cases WHERE integration_id=$1",
          [row.id],
        )
      ).rows[0].count;
      integrations.push({ ...row.data, actions, caseCount: count });
    }
    return { integrations };
  }
  async reportingIdentity(key: string) {
    const row = (
      await this.db.query(
        "SELECT id,org_id,data FROM rp_integrations WHERE reporting_hash=$1",
        [hashToken(key)],
      )
    ).rows[0];
    if (!row || !row.data.enabled)
      throw new AppError(401, "Invalid or disabled reporting credential");
    return row;
  }
  async report(integrationId: string, input: unknown) {
    const data = ReportExceptionRequestSchema.parse(input),
      payloadHash = hash(data);
    const identity = (
      await this.db.query("SELECT org_id FROM rp_integrations WHERE id=$1", [
        integrationId,
      ])
    ).rows[0];
    if (!identity) throw new AppError(404, "Integration not found");
    return this.locked(identity.org_id, async (tx) => {
      const integration = await this.integration(
        tx,
        identity.org_id,
        integrationId,
      );
      if (!integration.data.enabled)
        throw new AppError(409, "Integration is disabled");
      const existing = (
        await tx.query(
          "SELECT * FROM rp_occurrences WHERE integration_id=$1 AND idempotency_key=$2",
          [integrationId, data.idempotencyKey],
        )
      ).rows[0];
      if (existing) {
        if (existing.payload_hash !== payloadHash)
          throw new AppError(
            409,
            "Idempotency key reused with a different report payload",
            "IDEMPOTENCY_CONFLICT",
          );
        return (await this.caseRow(tx, identity.org_id, existing.case_id)).data;
      }
      const match = (
        await tx.query(
          "SELECT * FROM rp_cases WHERE integration_id=$1 AND correlation_key=$2 AND status='OPEN'",
          [integrationId, data.correlationKey],
        )
      ).rows[0];
      let c: any;
      if (match) {
        c = match.data;
        if (
          hash(c.entity) !== hash(data.entity) ||
          c.workflow !== data.workflow
        )
          throw new AppError(
            409,
            "Correlation key belongs to a different business operation",
          );
        if (
          c.step !== (data.step ?? "") ||
          c.executionId !== (data.executionId ?? null) ||
          c.exceptionType !== data.exception.type
        )
          throw new AppError(
            409,
            "Correlation key belongs to a different business problem",
          );
        c.occurrenceCount++;
        await saveCase(tx, c);
        await audit(
          tx,
          identity.org_id,
          c.id,
          integration.data.name,
          "OCCURRENCE_REPORTED",
          "Another report received for this business problem",
        );
      } else {
        const actions = [];
        for (const actionKey of [...new Set(data.availableActions)]) {
          const a = (
            await tx.query(
              "SELECT * FROM rp_actions WHERE integration_id=$1 AND action_key=$2 ORDER BY version DESC LIMIT 1",
              [integrationId, actionKey],
            )
          ).rows[0];
          if (!a || !a.enabled)
            throw new AppError(
              400,
              `Action ${actionKey} is not registered or is disabled`,
            );
          actions.push(a);
        }
        const count = (
          await tx.query(
            "SELECT count(*)::int AS count FROM rp_cases WHERE org_id=$1",
            [identity.org_id],
          )
        ).rows[0].count;
        c = {
          id: id("case"),
          number: count + 1001,
          organizationId: identity.org_id,
          integrationId,
          integrationName: integration.data.name,
          environment: integration.data.environment,
          title:
            data.title ??
            `${data.context.vendorName ?? data.entity.id} · ${data.exception.type.replaceAll("_", " ")}`,
          message: data.exception.message ?? "",
          workflow: data.workflow,
          step: data.step ?? "",
          entity: data.entity,
          context: data.context,
          priority: data.priority,
          status: "OPEN",
          recoveryStatus: "PENDING",
          ownerId: null,
          version: 1,
          occurrenceCount: 1,
          createdAt: now(),
          updatedAt: now(),
        };
        c.executionId = data.executionId ?? null;
        c.exceptionType = data.exception.type;
        await tx.query(
          "INSERT INTO rp_cases(id,org_id,integration_id,correlation_key,fingerprint,data) VALUES($1,$2,$3,$4,$5,$6)",
          [
            c.id,
            identity.org_id,
            integrationId,
            data.correlationKey,
            data.fingerprint,
            c,
          ],
        );
        for (const a of actions)
          await tx.query(
            "INSERT INTO rp_case_actions(case_id,action_id,integration_id,org_id) VALUES($1,$2,$3,$4)",
            [c.id, a.id, integrationId, identity.org_id],
          );
        await audit(
          tx,
          identity.org_id,
          c.id,
          integration.data.name,
          "CASE_CREATED",
          `Exception reported at ${data.step ?? data.workflow}`,
        );
      }
      await tx.query(
        "INSERT INTO rp_occurrences(id,org_id,integration_id,case_id,idempotency_key,payload_hash) VALUES($1,$2,$3,$4,$5,$6)",
        [
          id("occ"),
          identity.org_id,
          integrationId,
          c.id,
          data.idempotencyKey,
          payloadHash,
        ],
      );
      await tx.query("UPDATE rp_integrations SET data=$2 WHERE id=$1", [
        integrationId,
        { ...integration.data, lastEventAt: now() },
      ]);
      return c;
    });
  }
  async listCases(user: User, filters: Record<string, any>) {
    const all = (
      await this.db.query(
        "SELECT data FROM rp_cases WHERE org_id=$1 ORDER BY data->>'createdAt' DESC",
        [user.organizationId],
      )
    ).rows.map((r) => r.data);
    const cases = all.filter(
      (c) =>
        (!filters.status ||
          filters.status === "all" ||
          c.status === filters.status) &&
        (!filters.priority || c.priority === filters.priority) &&
        (!filters.integrationId || c.integrationId === filters.integrationId) &&
        (!filters.owner ||
          (filters.owner === "me"
            ? c.ownerId === user.id
            : filters.owner === "unassigned"
              ? !c.ownerId
              : c.ownerId === filters.owner)) &&
        (!filters.q ||
          `${c.title} ${c.number} ${c.entity.id} ${c.message}`
            .toLowerCase()
            .includes(String(filters.q).toLowerCase())),
    );
    return {
      cases,
      stats: {
        open: all.filter((c) => c.status === "OPEN").length,
        awaitingConfirmation: all.filter((c) =>
          ["AWAITING_CONFIRMATION", "OUTCOME_UNKNOWN"].includes(
            c.recoveryStatus,
          ),
        ).length,
        recovered: all.filter((c) => c.status === "RESOLVED").length,
        total: all.length,
      },
      members: this.members.filter(
        (m) => m.organizationId === user.organizationId,
      ),
    };
  }
  async getCase(user: User, caseId: string) {
    const row = await this.caseRow(this.db, user.organizationId, caseId);
    const integration = await this.integration(
      this.db,
      user.organizationId,
      row.integration_id,
    );
    const actions = (
      await this.db.query(
        "SELECT a.data,a.enabled FROM rp_actions a JOIN rp_case_actions ca ON ca.action_id=a.id WHERE ca.case_id=$1",
        [caseId],
      )
    ).rows.map((r) => ({
      ...r.data,
      enabled: r.enabled && integration.data.enabled,
    }));
    const commands = (
      await this.db.query(
        "SELECT id,data,status,result FROM rp_commands WHERE case_id=$1 ORDER BY data->>'createdAt' DESC",
        [caseId],
      )
    ).rows;
    for (const cmd of commands)
      cmd.deliveries = (
        await this.db.query(
          "SELECT data FROM rp_deliveries WHERE command_id=$1 ORDER BY data->>'createdAt' DESC",
          [cmd.id],
        )
      ).rows.map((r) => r.data);
    const timeline = (
      await this.db.query(
        "SELECT data FROM rp_audit WHERE case_id=$1 ORDER BY data->>'createdAt' DESC",
        [caseId],
      )
    ).rows.map((r) => r.data);
    const relatedCases = (
      await this.db.query(
        "SELECT data FROM rp_cases WHERE org_id=$1 AND integration_id=$2 AND fingerprint=$3 AND id<>$4 ORDER BY data->>'createdAt' DESC LIMIT 5",
        [user.organizationId, row.integration_id, row.fingerprint, caseId],
      )
    ).rows.map((r) => r.data);
    return {
      ...row.data,
      actions,
      commands: commands.map((c) => ({
        ...c.data,
        status: c.status,
        result: c.result,
        deliveries: c.deliveries,
      })),
      timeline,
      relatedCases,
    };
  }
  async updateCase(user: User, caseId: string, input: unknown) {
    requireRole(user.role, ["ADMIN", "OPERATOR"]);
    const data = z
      .object({
        version: z.number().int().positive(),
        priority: PrioritySchema.optional(),
        ownerId: z.string().nullable().optional(),
        status: z.literal("DISMISSED").optional(),
        note: z.string().trim().min(1).max(2000).optional(),
      })
      .strict()
      .parse(input);
    await this.locked(user.organizationId, async (tx) => {
      const c = (await this.caseRow(tx, user.organizationId, caseId)).data;
      if (c.version !== data.version)
        throw new AppError(
          409,
          "Case changed. Refresh and try again.",
          "VERSION_CONFLICT",
        );
      if (
        data.ownerId &&
        !this.members.some(
          (m) =>
            m.id === data.ownerId && m.organizationId === user.organizationId,
        )
      )
        throw new AppError(400, "Owner is not a workspace member");
      if (data.status) {
        if (c.status !== "OPEN")
          throw new AppError(409, "Only open cases can be dismissed");
        if (
          (
            await tx.query(
              "SELECT id FROM rp_commands WHERE case_id=$1 AND status=ANY($2::text[])",
              [caseId, activeStatuses],
            )
          ).rows.length
        )
          throw new AppError(
            409,
            "Await the active command outcome before dismissing",
          );
        if (!data.note)
          throw new AppError(400, "A dismissal reason is required");
        c.status = data.status;
      }
      if (data.priority) c.priority = data.priority;
      if (data.ownerId !== undefined) c.ownerId = data.ownerId;
      await saveCase(tx, c);
      await audit(
        tx,
        user.organizationId,
        caseId,
        user.name,
        data.status ? "CASE_DISMISSED" : "CASE_UPDATED",
        data.note ??
          [
            data.priority
              ? `Priority set to ${data.priority.toLowerCase()}`
              : "",
            data.ownerId !== undefined
              ? data.ownerId
                ? `Assigned to ${this.members.find((m) => m.id === data.ownerId)?.name}`
                : "Assignment cleared"
              : "",
          ]
            .filter(Boolean)
            .join(". "),
      );
    });
    return this.getCase(user, caseId);
  }
  async addNote(user: User, caseId: string, text: unknown) {
    requireRole(user.role, ["ADMIN", "OPERATOR"]);
    const note = z.string().trim().min(1).max(2000).parse(text);
    await this.locked(user.organizationId, async (tx) => {
      await this.caseRow(tx, user.organizationId, caseId);
      await audit(
        tx,
        user.organizationId,
        caseId,
        user.name,
        "NOTE_ADDED",
        note,
      );
    });
    return this.getCase(user, caseId);
  }
  async invoke(user: User, caseId: string, actionId: string, input: unknown) {
    requireRole(user.role, ["ADMIN", "OPERATOR"]);
    const request = InvokeActionRequestSchema.parse(input);
    const payloadHash = hash({
      actionId,
      input: request.input,
      confirmed: request.confirmed,
    });
    const command = await this.locked(user.organizationId, async (tx) => {
      const c = (await this.caseRow(tx, user.organizationId, caseId)).data;
      const replay = (
        await tx.query(
          "SELECT * FROM rp_commands WHERE case_id=$1 AND idempotency_key=$2",
          [caseId, request.idempotencyKey],
        )
      ).rows[0];
      if (replay) {
        if (replay.payload_hash !== payloadHash)
          throw new AppError(
            409,
            "Idempotency key reused with different action inputs",
          );
        return { ...replay.data, status: replay.status };
      }
      if (c.version !== request.version)
        throw new AppError(
          409,
          "Case changed. Refresh and try again.",
          "VERSION_CONFLICT",
        );
      if (c.status !== "OPEN")
        throw new AppError(409, "This case is already closed");
      if (
        (
          await tx.query(
            "SELECT id FROM rp_commands WHERE case_id=$1 AND status=ANY($2::text[])",
            [caseId, activeStatuses],
          )
        ).rows.length
      )
        throw new AppError(409, "This case already has an active command");
      const a = (
        await tx.query(
          "SELECT a.* FROM rp_actions a JOIN rp_case_actions ca ON ca.action_id=a.id WHERE ca.case_id=$1 AND a.id=$2",
          [caseId, actionId],
        )
      ).rows[0];
      if (!a) throw new AppError(404, "Action not found for this case");
      const integration = await this.integration(
        tx,
        user.organizationId,
        c.integrationId,
      );
      if (!a.enabled || !integration.data.enabled)
        throw new AppError(409, "Action or integration is disabled");
      if (a.data.requiresConfirmation && !request.confirmed)
        throw new AppError(400, "Explicit confirmation is required");
      try {
        validateInput(a.data.inputSchema, request.input);
      } catch (e) {
        throw new AppError(400, (e as Error).message);
      }
      const cmd = {
        id: id("cmd"),
        caseId,
        integrationId: c.integrationId,
        actionKey: a.data.actionKey,
        actionVersion: a.version,
        actionLabel: a.data.label,
        status: "QUEUED",
        input: request.input,
        entity: c.entity,
        createdAt: now(),
        initiatorId: user.id,
      };
      await tx.query(
        "INSERT INTO rp_commands(id,org_id,integration_id,case_id,action_id,idempotency_key,payload_hash,status,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [
          cmd.id,
          user.organizationId,
          c.integrationId,
          caseId,
          actionId,
          request.idempotencyKey,
          payloadHash,
          cmd.status,
          cmd,
        ],
      );
      await tx.query("INSERT INTO rp_outbox(command_id) VALUES($1)", [cmd.id]);
      c.recoveryStatus = "QUEUED";
      await saveCase(tx, c);
      await audit(
        tx,
        user.organizationId,
        caseId,
        user.name,
        "ACTION_REQUESTED",
        `Requested ${a.data.label} v${a.version}`,
      );
      return cmd;
    });
    return { command, case: await this.getCase(user, caseId) };
  }
  async acceptResult(integrationId: string, commandId: string, input: unknown) {
    const result = ResultSchema.parse(input);
    const cmd = (
      await this.db.query(
        "SELECT * FROM rp_commands WHERE id=$1 AND integration_id=$2",
        [commandId, integrationId],
      )
    ).rows[0];
    if (!cmd) throw new AppError(404, "Command not found");
    await this.locked(cmd.org_id, async (tx) => {
      await this.resultInTransaction(tx, integrationId, commandId, result);
    });
  }
  async resultInTransaction(
    tx: Sql,
    integrationId: string,
    commandId: string,
    result: any,
  ) {
    const cmd = (
      await tx.query(
        "SELECT * FROM rp_commands WHERE id=$1 AND integration_id=$2",
        [commandId, integrationId],
      )
    ).rows[0];
    if (!cmd) throw new AppError(404, "Command not found");
    if (cmd.result) {
      if (hash(cmd.result) !== hash(result))
        throw new AppError(409, "Conflicting result for completed command");
      return;
    }
    if (!activeStatuses.includes(cmd.status))
      throw new AppError(409, "Command is not active");
    const c = (await this.caseRow(tx, cmd.org_id, cmd.case_id)).data;
    await tx.query("UPDATE rp_commands SET status=$2,result=$3 WHERE id=$1", [
      commandId,
      result.outcome,
      result,
    ]);
    await tx.query(
      "UPDATE rp_outbox SET done=true,lease_token=NULL,lease_until=NULL WHERE command_id=$1",
      [commandId],
    );
    c.recoveryStatus = result.outcome;
    if (result.caseDisposition !== "UNCHANGED") {
      c.status = result.caseDisposition;
      c.closedAt = now();
    }
    await saveCase(tx, c);
    await audit(
      tx,
      cmd.org_id,
      c.id,
      "Origin system",
      "ACTION_RESULT",
      result.message,
    );
    if (result.caseDisposition !== "UNCHANGED")
      await audit(
        tx,
        cmd.org_id,
        c.id,
        "Origin system",
        `CASE_${result.caseDisposition}`,
        result.caseDisposition === "RESOLVED"
          ? "Origin confirmed that the blocked operation recovered"
          : "Origin confirmed cancellation; this does not count as recovery",
      );
  }
  async retry(user: User, commandId: string) {
    requireRole(user.role, ["ADMIN", "OPERATOR"]);
    const caseId = await this.locked(user.organizationId, async (tx) => {
      const cmd = (
        await tx.query("SELECT * FROM rp_commands WHERE id=$1 AND org_id=$2", [
          commandId,
          user.organizationId,
        ])
      ).rows[0];
      if (!cmd) throw new AppError(404, "Command not found");
      if (!["OUTCOME_UNKNOWN", "AWAITING_CONFIRMATION"].includes(cmd.status))
        throw new AppError(409, "Only uncertain commands can be reconciled");
      const box = (
        await tx.query("SELECT * FROM rp_outbox WHERE command_id=$1", [
          commandId,
        ])
      ).rows[0];
      if (box.lease_until && new Date(box.lease_until).getTime() > Date.now())
        throw new AppError(409, "Delivery is already in progress");
      await tx.query(
        "UPDATE rp_outbox SET done=false,available_at=now(),lease_token=NULL,lease_until=NULL WHERE command_id=$1",
        [commandId],
      );
      await audit(
        tx,
        user.organizationId,
        cmd.case_id,
        user.name,
        "RECONCILIATION_REQUESTED",
        "Requested redelivery of the same command identity",
      );
      return cmd.case_id;
    });
    return this.getCase(user, caseId);
  }
  async activity(user: User) {
    return {
      events: (
        await this.db.query(
          "SELECT data FROM rp_audit WHERE org_id=$1 ORDER BY data->>'createdAt' DESC LIMIT 100",
          [user.organizationId],
        )
      ).rows.map((r) => r.data),
    };
  }
  async metrics(user: User) {
    const { cases } = await this.listCases(user, {});
    const recovered = cases.filter((c) => c.status === "RESOLVED");
    const durations = recovered
      .map((c) => (Date.parse(c.closedAt) - Date.parse(c.createdAt)) / 60000)
      .sort((a, b) => a - b);
    return {
      total: cases.length,
      open: cases.filter((c) => c.status === "OPEN").length,
      recovered: recovered.length,
      cancelled: cases.filter((c) => c.status === "CANCELLED").length,
      dismissed: cases.filter((c) => c.status === "DISMISSED").length,
      unknown: cases.filter((c) => c.recoveryStatus === "OUTCOME_UNKNOWN")
        .length,
      recoveryRate: cases.length ? recovered.length / cases.length : 0,
      medianRecoveryMinutes: durations.length
        ? durations[Math.floor(durations.length / 2)]
        : null,
    };
  }
}
