import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Play,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { api, ApiError, type Action, type Session } from "./api";
import {
  age,
  Badge,
  Busy,
  Empty,
  ErrorBox,
  Modal,
  Timeline,
  titleCase,
} from "./ui";
interface PendingAction {
  action: Action;
  input: Record<string, unknown>;
  idempotencyKey: string;
  version: number;
}
export function CasePage({ id, session }: { id: string; session: Session }) {
  const data = useQuery({
    queryKey: ["case", id],
    queryFn: () => api.case(id),
  });
  const members = useQuery({
    queryKey: ["cases", "summary"],
    queryFn: () => api.cases(),
  });
  const cache = useQueryClient();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState("");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [dismiss, setDismiss] = useState(false);
  const [dismissReason, setDismissReason] = useState("");
  const viewer = session.user.role === "VIEWER";
  const item = data.data;
  async function mutate(
    key: string,
    operation: () => Promise<unknown>,
    success: string,
    after?: () => void,
  ) {
    setBusy(key);
    setError(null);
    setMessage("");
    try {
      await operation();
      setMessage(success);
      after?.();
      await cache.invalidateQueries();
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        setError(
          new Error(
            "This case changed while you were working. The latest version has been loaded. Review the current state and try again.",
          ),
        );
        setPending(null);
        setDismiss(false);
        await cache.invalidateQueries();
      } else setError(cause);
    } finally {
      setBusy("");
    }
  }
  function update(fields: { priority?: string; ownerId?: string | null }) {
    if (item)
      void mutate(
        "update",
        () => api.updateCase(id, { version: item.version, ...fields }),
        "Case details updated.",
      );
  }
  function execute() {
    if (!pending) return;
    void mutate(
      "action",
      () =>
        api.action(id, pending.action.id, {
          version: pending.version,
          input: pending.input,
          idempotencyKey: pending.idempotencyKey,
          confirmed: true,
        }),
      "Recovery command submitted. The origin system determines its outcome and whether the case closes.",
      () => setPending(null),
    );
  }
  if (data.isLoading) return <Busy />;
  if (data.error || !item)
    return (
      <>
        <a className="back-link" href="#/inbox">
          <ArrowLeft size={15} /> Back to inbox
        </a>
        <ErrorBox
          error={data.error || "Case not found"}
          retry={() => void data.refetch()}
        />
      </>
    );
  const activeCommand = item.commands.some((command) =>
    ["QUEUED", "AWAITING_CONFIRMATION", "OUTCOME_UNKNOWN"].includes(
      command.status,
    ),
  );
  return (
    <>
      <a className="back-link" href="#/inbox">
        <ArrowLeft size={15} /> Exception inbox <ChevronRight size={14} /> RP-
        {item.number}
      </a>
      <div className="page-heading case-heading">
        <div>
          <div className="case-title-meta">
            <span className="mono">RP-{item.number}</span>
            <Badge value={item.status} />
            <Badge value={item.recoveryStatus} />
          </div>
          <h1>{item.title}</h1>
          <p>
            {item.integrationName} <span> / </span> {item.workflow}{" "}
            <span> / </span> {item.step}
          </p>
        </div>
        <button
          disabled={viewer || !!busy || item.status !== "OPEN"}
          title={viewer ? "Operator access required" : ""}
          onClick={() => {
            setDismissReason("");
            setError(null);
            setDismiss(true);
          }}
        >
          Dismiss case
        </button>
      </div>
      {error != null && <ErrorBox error={error} />}
      {message && (
        <div className="notice success" role="status">
          <CheckCircle2 size={17} />
          {message}
        </div>
      )}
      <div className="case-layout">
        <div className="case-main">
          <section className="panel">
            <div className="panel-heading">
              <h2>Exception context</h2>
              <span className="environment">{item.environment}</span>
            </div>
            <div className="exception-message">
              <TriangleAlert size={18} />
              <div>
                <strong>What needs attention</strong>
                <p>{item.message}</p>
              </div>
            </div>
            <dl className="context-grid">
              <div>
                <dt>Entity</dt>
                <dd>
                  {item.entity.type}{" "}
                  <span className="mono">{item.entity.id}</span>
                </dd>
              </div>
              <div>
                <dt>Occurrences</dt>
                <dd>{item.occurrenceCount} reports</dd>
              </div>
              {Object.entries(item.context).map(([key, value]) => (
                <div key={key}>
                  <dt>{titleCase(key.replace(/-/g, " "))}</dt>
                  <dd>
                    {value == null
                      ? "Not provided"
                      : typeof value === "object"
                        ? JSON.stringify(value)
                        : String(value)}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>Recovery actions</h2>
                <p>
                  Registered by your origin system. Delivered with a durable
                  command ID.
                </p>
              </div>
              <ShieldCheck size={20} className="teal-text" />
            </div>
            {activeCommand && (
              <div className="notice inset">
                <Clock3 size={17} /> A command is awaiting an outcome. Review
                delivery history below before starting another recovery.
              </div>
            )}
            {!item.actions.length ? (
              <Empty title="No recovery actions registered">
                An admin can register recovery actions in this integration’s
                settings.
              </Empty>
            ) : (
              <div className="action-list">
                {item.actions.map((action) => (
                  <ActionForm
                    key={action.id}
                    action={action}
                    disabled={
                      viewer ||
                      !!busy ||
                      !action.enabled ||
                      item.status !== "OPEN" ||
                      activeCommand
                    }
                    reason={
                      viewer
                        ? "Operator access required"
                        : !action.enabled
                          ? "This action is disabled"
                          : item.status !== "OPEN"
                            ? "This case is closed"
                            : activeCommand
                              ? "Wait for the active command or retry its delivery below"
                              : ""
                    }
                    onRun={(input) => {
                      setError(null);
                      setPending({
                        action,
                        input,
                        idempotencyKey: crypto.randomUUID(),
                        version: item.version,
                      });
                    }}
                  />
                ))}
              </div>
            )}
            <div className="panel-footnote">
              A successful patch can leave the case open. Only an
              origin-confirmed recovery resolves the workflow.
            </div>
          </section>
          <section className="panel">
            <div className="panel-heading">
              <h2>Commands & delivery</h2>
              <span className="count-chip">{item.commands.length}</span>
            </div>
            {!item.commands.length ? (
              <div className="quiet-empty">
                No commands yet. Run a recovery action to get started.
              </div>
            ) : (
              <div className="command-list">
                {item.commands.map((command) => (
                  <article className="command" key={command.id}>
                    <div className="row-between">
                      <strong>{command.actionLabel}</strong>
                      <Badge value={command.status} />
                    </div>
                    <span className="helper mono">{command.id}</span>
                    {command.result && (
                      <div className="command-result">
                        <p>{command.result.message}</p>
                        <small>
                          Outcome: {command.result.outcome} · Case disposition:{" "}
                          {command.result.caseDisposition}
                        </small>
                        {command.status === "SUCCEEDED" &&
                          item.status === "OPEN" && (
                            <p className="teal-text">
                              <CheckCircle2 size={14} /> Action succeeded. This
                              case is still open.
                            </p>
                          )}
                      </div>
                    )}
                    {command.status === "OUTCOME_UNKNOWN" && (
                      <div className="unknown-outcome">
                        <p>
                          <strong>
                            The origin may have already applied this action.
                          </strong>{" "}
                          Redeliver this same command to reconcile the outcome
                          without creating a new operation.
                        </p>
                        <button
                          disabled={viewer || !!busy}
                          onClick={() =>
                            void mutate(
                              command.id,
                              () => api.retry(command.id),
                              "The same command was redelivered. Review its confirmed outcome below.",
                            )
                          }
                        >
                          <RefreshCw size={15} /> Retry same command
                        </button>
                      </div>
                    )}
                    <details>
                      <summary>
                        {command.deliveries.length} delivery{" "}
                        {command.deliveries.length === 1
                          ? "attempt"
                          : "attempts"}{" "}
                        <span>· {age(command.createdAt)}</span>
                      </summary>
                      <ul className="deliveries">
                        {command.deliveries.map((delivery) => (
                          <li key={delivery.id}>
                            <div>
                              <strong>Attempt {delivery.attempt}</strong>
                              <Badge value={delivery.status} />
                              <span>{age(delivery.createdAt)}</span>
                            </div>
                            {delivery.error && <p>{delivery.error}</p>}
                          </li>
                        ))}
                      </ul>
                      <pre>{JSON.stringify(command.input, null, 2)}</pre>
                    </details>
                  </article>
                ))}
              </div>
            )}
          </section>
          <section className="panel">
            <div className="panel-heading">
              <h2>Activity & notes</h2>
              <span className="live-label">Canonical audit trail</span>
            </div>
            <div className="padded">
              <Timeline events={item.timeline} />
              <form
                className="note-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void mutate(
                    "note",
                    () => api.note(id, note.trim()),
                    "Note added to the audit trail.",
                    () => setNote(""),
                  );
                }}
              >
                <label>
                  Add an operator note
                  <textarea
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder={
                      viewer
                        ? "Operator access is required to add notes."
                        : "Share context for the next person…"
                    }
                    disabled={viewer || !!busy}
                    required
                    maxLength={2000}
                  />
                </label>
                <button disabled={viewer || !!busy || !note.trim()}>
                  <PlusNote /> Add note
                </button>
              </form>
            </div>
          </section>
        </div>
        <aside className="case-aside">
          <section className="panel padded">
            <h2>Case details</h2>
            <label>
              Priority
              <select
                value={item.priority}
                onChange={(event) => update({ priority: event.target.value })}
                disabled={viewer || !!busy}
              >
                {["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <label>
              Owner
              <select
                value={item.ownerId || ""}
                onChange={(event) =>
                  update({ ownerId: event.target.value || null })
                }
                disabled={viewer || !!busy}
              >
                <option value="">Unassigned</option>
                {members.data?.members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
            </label>
            <dl className="case-facts">
              <dt>Reported</dt>
              <dd>{new Date(item.createdAt).toLocaleString()}</dd>
              <dt>Last updated</dt>
              <dd>{age(item.updatedAt)}</dd>
              <dt>Version</dt>
              <dd>{item.version}</dd>
              <dt>Source</dt>
              <dd>{item.integrationName}</dd>
            </dl>
          </section>
          <section className="panel padded">
            <h2>Related cases</h2>
            {item.relatedCases.length ? (
              item.relatedCases.map((related) => (
                <a
                  className="related-case"
                  key={related.id}
                  href={`#/cases/${related.id}`}
                >
                  <span>
                    RP-{related.number} <Badge value={related.status} />
                  </span>
                  <strong>{related.title}</strong>
                  <ArrowRight size={15} />
                </a>
              ))
            ) : (
              <p className="helper">No similar cases in this integration.</p>
            )}
          </section>
          <div className="aside-note">
            <ShieldCheck size={20} />
            <p>
              Recovery is a conversation with your origin system. Every step
              stays in the audit trail.
            </p>
          </div>
        </aside>
      </div>
      {pending && (
        <Modal
          title="Confirm recovery action"
          onClose={() => !busy && setPending(null)}
        >
          <div className="confirmation-risk">
            <ShieldCheck size={20} />
            <div>
              <strong>{pending.action.label}</strong>
              <p>
                {pending.action.riskLevel === "MEDIUM"
                  ? "This action can change the origin system. Review the target and inputs before continuing."
                  : "Review this command before sending it to the origin system."}
              </p>
            </div>
          </div>
          <dl className="confirmation-details">
            <dt>Target</dt>
            <dd>
              {item.entity.type} / {item.entity.id}
            </dd>
            <dt>Source</dt>
            <dd>
              {item.integrationName} · {item.environment}
            </dd>
            <dt>Case version</dt>
            <dd>{pending.version}</dd>
          </dl>
          <div className="code-label">INPUTS</div>
          <pre>{JSON.stringify(pending.input, null, 2)}</pre>
          <p className="helper">
            This command uses a unique idempotency key. If the request fails,
            retrying here preserves that key.
          </p>
          {error != null && <ErrorBox error={error} />}
          <div className="modal-actions">
            <button disabled={!!busy} onClick={() => setPending(null)}>
              Cancel
            </button>
            <button className="primary" disabled={!!busy} onClick={execute}>
              <Play size={15} />{" "}
              {busy ? "Sending command…" : "Confirm & run action"}
            </button>
          </div>
        </Modal>
      )}
      {dismiss && (
        <Modal
          title="Dismiss this case?"
          onClose={() => !busy && setDismiss(false)}
        >
          <p>
            Dismissing RP-{item.number} removes it from the open inbox. It
            records an operator decision; it does not repair the origin
            workflow.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (
                busy ||
                viewer ||
                dismissReason.trim().length < 3 ||
                dismissReason.trim().length > 2000
              )
                return;
              void mutate(
                "dismiss",
                () =>
                  api.updateCase(id, {
                    version: item.version,
                    status: "DISMISSED",
                    note: dismissReason.trim(),
                  }),
                "Case dismissed and recorded in the audit trail.",
                () => {
                  setDismiss(false);
                  setDismissReason("");
                },
              );
            }}
          >
            <label>
              Reason for dismissal
              <textarea
                value={dismissReason}
                onChange={(event) => setDismissReason(event.target.value)}
                placeholder="Explain why this exception no longer needs recovery."
                required
                minLength={3}
                maxLength={2000}
                disabled={!!busy}
                aria-describedby="dismiss-reason-help"
              />
            </label>
            <p className="helper" id="dismiss-reason-help">
              Enter 3–2,000 characters. Your reason will be recorded in the
              audit trail.
            </p>
            {error != null && <ErrorBox error={error} />}
            <div className="modal-actions">
              <button
                type="button"
                disabled={!!busy}
                onClick={() => setDismiss(false)}
              >
                Keep open
              </button>
              <button
                className="danger"
                disabled={!!busy || dismissReason.trim().length < 3}
              >
                {busy ? "Dismissing…" : "Dismiss case"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
function PlusNote() {
  return <span aria-hidden="true">+</span>;
}
function ActionForm({
  action,
  disabled,
  reason,
  onRun,
}: {
  action: Action;
  disabled: boolean;
  reason: string;
  onRun: (input: Record<string, unknown>) => void;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const input: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(action.inputSchema.properties)) {
      const value = form.get(key);
      if (field.type === "boolean") input[key] = value === "on";
      else if (value !== null && value !== "")
        input[key] = field.type === "number" ? Number(value) : String(value);
    }
    onRun(input);
  }
  return (
    <form className="action-card" onSubmit={submit}>
      <div className="row-between">
        <h3>{action.label}</h3>
        <span className="risk-label">{titleCase(action.riskLevel)} risk</span>
      </div>
      <p>{action.description}</p>
      <div className="action-inputs">
        {Object.entries(action.inputSchema.properties).map(([key, field]) => (
          <label
            className={field.type === "boolean" ? "checkbox-label" : ""}
            key={key}
          >
            {field.type !== "boolean" && (
              <span>
                {field.title || titleCase(key)}
                {action.inputSchema.required?.includes(key) ? " *" : ""}
              </span>
            )}
            {field.enum ? (
              <select
                name={key}
                required={action.inputSchema.required?.includes(key)}
                disabled={disabled}
                defaultValue=""
              >
                <option value="">Select {field.title || key}</option>
                {field.enum.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            ) : (
              <input
                name={key}
                type={
                  field.type === "boolean"
                    ? "checkbox"
                    : field.type === "number"
                      ? "number"
                      : "text"
                }
                step={field.type === "number" ? "any" : undefined}
                required={
                  field.type !== "boolean" &&
                  action.inputSchema.required?.includes(key)
                }
                minLength={field.minLength}
                maxLength={field.maxLength}
                min={field.minimum}
                max={field.maximum}
                disabled={disabled}
              />
            )}
            {field.type === "boolean" && (
              <span>{field.title || titleCase(key)}</span>
            )}
            {field.description && (
              <small className="helper">{field.description}</small>
            )}
          </label>
        ))}
      </div>
      <div className="action-footer">
        <small>
          {reason ||
            (action.requiresConfirmation
              ? "Requires confirmation"
              : "Recorded in the audit trail")}
        </small>
        <button disabled={disabled} title={reason}>
          <Play size={14} /> {action.label}
        </button>
      </div>
    </form>
  );
}
