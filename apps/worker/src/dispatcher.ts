import {
  ResultSchema,
  type RecoveryEnvelope,
} from "../../../packages/contracts/src/index.js";
import {
  RecoveryService,
  activeStatuses,
  audit,
  saveCase,
} from "../../api/src/domain/service.js";
import { id, now } from "../../api/src/domain/utils.js";
import { createTransport } from "./transport.js";
type Transport = (
  url: string,
  envelope: RecoveryEnvelope,
  secret: string,
) => Promise<unknown>;
export class Dispatcher {
  private running = false;
  constructor(
    private service: RecoveryService,
    private transport: Transport = createTransport(),
    private options: {
      maxAttempts?: number;
      leaseMs?: number;
      retryMs?: number;
    } = {},
  ) {}
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const candidates = (
        await this.service.db.query(
          `SELECT b.command_id,c.org_id FROM rp_outbox b JOIN rp_commands c ON c.id=b.command_id WHERE b.done=false AND b.available_at<=now() AND (b.lease_until IS NULL OR b.lease_until<now()) ORDER BY b.available_at LIMIT 10`,
        )
      ).rows;
      for (const candidate of candidates) {
        const claim = await this.service.locked(
          candidate.org_id,
          async (tx) => {
            const box = (
              await tx.query(
                "SELECT * FROM rp_outbox WHERE command_id=$1 FOR UPDATE",
                [candidate.command_id],
              )
            ).rows[0];
            if (
              !box ||
              box.done ||
              new Date(box.available_at).getTime() > Date.now() ||
              (box.lease_until &&
                new Date(box.lease_until).getTime() > Date.now())
            )
              return;
            const cmd = (
              await tx.query("SELECT * FROM rp_commands WHERE id=$1", [
                candidate.command_id,
              ])
            ).rows[0];
            if (!activeStatuses.includes(cmd.status)) {
              await tx.query(
                "UPDATE rp_outbox SET done=true WHERE command_id=$1",
                [cmd.id],
              );
              return;
            }
            const integration = await this.service.integration(
              tx,
              cmd.org_id,
              cmd.integration_id,
            );
            const a = (
              await tx.query("SELECT enabled FROM rp_actions WHERE id=$1", [
                cmd.action_id,
              ])
            ).rows[0];
            const c = (await this.service.caseRow(tx, cmd.org_id, cmd.case_id))
              .data;
            if (!integration.data.enabled || !a.enabled) {
              const status = box.attempts ? "OUTCOME_UNKNOWN" : "BLOCKED";
              await tx.query("UPDATE rp_commands SET status=$2 WHERE id=$1", [
                cmd.id,
                status,
              ]);
              await tx.query(
                "UPDATE rp_outbox SET done=true,lease_token=NULL,lease_until=NULL WHERE command_id=$1",
                [cmd.id],
              );
              c.recoveryStatus = box.attempts ? "OUTCOME_UNKNOWN" : "FAILED";
              await saveCase(tx, c);
              await audit(
                tx,
                cmd.org_id,
                cmd.case_id,
                "Dispatcher",
                "DISPATCH_BLOCKED",
                box.attempts
                  ? "Redelivery blocked by current revocation. Previous delivery outcome remains unknown."
                  : "Dispatch blocked because the action or integration is disabled",
              );
              return;
            }
            const leaseToken = id("lease"),
              attempt = box.attempts + 1;
            await tx.query(
              "UPDATE rp_outbox SET lease_token=$2,lease_until=$3,attempts=$4 WHERE command_id=$1",
              [
                cmd.id,
                leaseToken,
                new Date(Date.now() + (this.options.leaseMs ?? 30000)),
                attempt,
              ],
            );
            await tx.query(
              "UPDATE rp_commands SET status='AWAITING_CONFIRMATION' WHERE id=$1",
              [cmd.id],
            );
            c.recoveryStatus = "AWAITING_CONFIRMATION";
            await saveCase(tx, c);
            await audit(
              tx,
              cmd.org_id,
              cmd.case_id,
              "Dispatcher",
              "DELIVERY_STARTED",
              `Delivery ${attempt} started; awaiting origin confirmation`,
            );
            return { cmd, integration, leaseToken, attempt };
          },
        );
        if (!claim) continue;
        let result: unknown, failure: string | undefined;
        try {
          const { cmd } = claim;
          result = ResultSchema.parse(
            await this.transport(
              claim.integration.data.callbackUrl,
              {
                commandId: cmd.id,
                integrationId: cmd.integration_id,
                caseId: cmd.case_id,
                actionKey: cmd.data.actionKey,
                actionVersion: cmd.data.actionVersion,
                entity: cmd.data.entity,
                input: cmd.data.input,
              },
              claim.integration.secret,
            ),
          );
        } catch (error) {
          failure =
            error instanceof Error
              ? error.message.slice(0, 500)
              : "Delivery outcome unconfirmed";
        }
        await this.service.locked(candidate.org_id, async (tx) => {
          const box = (
            await tx.query(
              "SELECT * FROM rp_outbox WHERE command_id=$1 FOR UPDATE",
              [candidate.command_id],
            )
          ).rows[0];
          // A callback or a newer lease wins over this delivery. Stale workers cannot regress state.
          if (box.lease_token !== claim.leaseToken || box.done) return;
          const delivery = {
            id: id("del"),
            attempt: claim.attempt,
            status: failure ? "OUTCOME_UNKNOWN" : "CONFIRMED",
            error: failure,
            createdAt: now(),
          };
          await tx.query(
            "INSERT INTO rp_deliveries(id,command_id,data) VALUES($1,$2,$3)",
            [delivery.id, claim.cmd.id, delivery],
          );
          if (failure) {
            await tx.query(
              "UPDATE rp_commands SET status='OUTCOME_UNKNOWN' WHERE id=$1",
              [claim.cmd.id],
            );
            const c = (
              await this.service.caseRow(
                tx,
                claim.cmd.org_id,
                claim.cmd.case_id,
              )
            ).data;
            c.recoveryStatus = "OUTCOME_UNKNOWN";
            await saveCase(tx, c);
            const done = claim.attempt >= (this.options.maxAttempts ?? 3);
            await tx.query(
              "UPDATE rp_outbox SET done=$2,lease_token=NULL,lease_until=NULL,available_at=$3 WHERE command_id=$1",
              [
                claim.cmd.id,
                done,
                new Date(
                  Date.now() +
                    (this.options.retryMs ?? 5000) *
                      Math.min(12, claim.attempt),
                ),
              ],
            );
            await audit(
              tx,
              claim.cmd.org_id,
              claim.cmd.case_id,
              "Dispatcher",
              "OUTCOME_UNKNOWN",
              `${failure}. ${done ? "Automatic delivery paused; reconcile the same command." : "The same command will be redelivered."}`,
            );
          } else
            await this.service.resultInTransaction(
              tx,
              claim.cmd.integration_id,
              claim.cmd.id,
              result,
            );
        });
      }
    } finally {
      this.running = false;
    }
  }
}
