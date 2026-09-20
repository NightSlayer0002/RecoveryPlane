import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  PlugZap,
  Plus,
  ShieldCheck,
} from "lucide-react";
import {
  api,
  type Credentials,
  type InputSchema,
  type Integration,
  type Session,
} from "./api";
import { age, Badge, Busy, Empty, ErrorBox, Modal } from "./ui";
export function Integrations({ session }: { session: Session }) {
  const query = useQuery({
    queryKey: ["integrations"],
    queryFn: api.integrations,
  });
  const cache = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [create, setCreate] = useState(false);
  const [register, setRegister] = useState(false);
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState<unknown>(null);
  const admin = session.user.role === "ADMIN";
  const integration = query.data?.integrations.find(
    (item) => item.id === selected,
  );
  async function toggle(key: string, operation: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await operation();
      await cache.invalidateQueries();
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy("");
    }
  }
  return (
    <>
      {selected && (
        <button
          className="back-link text-button"
          onClick={() => setSelected(null)}
        >
          <ArrowLeft size={15} /> All integrations
        </button>
      )}
      <div className="page-heading">
        <div>
          <p className="eyebrow">CONNECTED SYSTEMS. CONTROLLED RECOVERY.</p>
          <h1>{integration?.name || "Integrations"}</h1>
          <p>
            {integration
              ? "Manage the connection and recovery actions registered by this source."
              : "Bring exceptions and recovery actions from your systems into one workspace."}
          </p>
        </div>
        <button
          className="primary"
          disabled={!admin}
          title={!admin ? "Admin access required" : ""}
          onClick={() => (integration ? setRegister(true) : setCreate(true))}
        >
          <Plus size={16} />
          {integration ? "Register action" : "Add integration"}
        </button>
      </div>
      {!admin && (
        <div className="notice">
          <ShieldCheck size={17} /> Integration settings require an admin
          session. You can explore connections and registered actions here.
        </div>
      )}
      {error != null && <ErrorBox error={error} />}
      {query.isLoading ? (
        <Busy />
      ) : query.error ? (
        <ErrorBox error={query.error} retry={() => void query.refetch()} />
      ) : integration ? (
        <>
          <section className="panel padded">
            <div className="row-between">
              <h2>Connection details</h2>
              <label className="switch-label">
                <input
                  type="checkbox"
                  role="switch"
                  checked={integration.enabled}
                  disabled={!admin || !!busy}
                  onChange={(event) =>
                    void toggle(integration.id, () =>
                      api.enableIntegration(
                        integration.id,
                        event.target.checked,
                      ),
                    )
                  }
                />
                <span>{integration.enabled ? "Enabled" : "Disabled"}</span>
              </label>
            </div>
            <dl className="integration-facts">
              <dt>Callback URL</dt>
              <dd className="mono">{integration.callbackUrl}</dd>
              <dt>Environment</dt>
              <dd>{integration.environment}</dd>
              <dt>Integration ID</dt>
              <dd className="mono">{integration.id}</dd>
              <dt>Last report</dt>
              <dd>
                {integration.lastEventAt
                  ? age(integration.lastEventAt)
                  : "No reports yet"}
              </dd>
              <dt>Cases</dt>
              <dd>{integration.caseCount}</dd>
            </dl>
          </section>
          <section className="panel section-gap">
            <div className="panel-heading">
              <h2>Registered actions</h2>
              <span className="count-chip">{integration.actions.length}</span>
            </div>
            {integration.actions.length ? (
              <div className="action-list">
                {integration.actions.map((action) => (
                  <article className="action-card" key={action.id}>
                    <div className="row-between">
                      <h3>{action.label}</h3>
                      <label className="switch-label">
                        <input
                          type="checkbox"
                          role="switch"
                          aria-label={`Enable ${action.label}`}
                          checked={action.enabled}
                          disabled={!admin || !!busy}
                          onChange={(event) =>
                            void toggle(action.id, () =>
                              api.enableAction(
                                integration.id,
                                action.id,
                                event.target.checked,
                              ),
                            )
                          }
                        />
                        <span>{action.enabled ? "Enabled" : "Disabled"}</span>
                      </label>
                    </div>
                    <p>{action.description}</p>
                    <div className="action-metadata">
                      <code>{action.actionKey}</code>
                      <Badge value={action.riskLevel} />
                      <span>Version {action.version}</span>
                      {action.requiresConfirmation && (
                        <span>Confirmation required</span>
                      )}
                    </div>
                    <details>
                      <summary>Input JSON Schema</summary>
                      <pre>{JSON.stringify(action.inputSchema, null, 2)}</pre>
                    </details>
                  </article>
                ))}
              </div>
            ) : (
              <Empty title="Ready for your first recovery action">
                Register an action with a clear label, input schema, and risk
                level.
              </Empty>
            )}
          </section>
        </>
      ) : !query.data?.integrations.length ? (
        <section className="panel">
          <Empty title="Connect your first system">
            An admin can add a callback URL and register actions to get started.
          </Empty>
        </section>
      ) : (
        <div className="integration-grid">
          {query.data.integrations.map((item) => (
            <button
              className="panel integration-card"
              key={item.id}
              onClick={() => setSelected(item.id)}
            >
              <div className="row-between">
                <span className="integration-icon">
                  <PlugZap size={23} />
                </span>
                <Badge value={item.enabled ? "ACTIVE" : "DISABLED"} />
              </div>
              <h2>{item.name}</h2>
              <p>{item.environment}</p>
              <div className="integration-stats">
                <span>
                  <strong>{item.actions.length}</strong> actions
                </span>
                <span>
                  <strong>{item.caseCount}</strong> cases
                </span>
              </div>
              <div className="integration-card-bottom">
                <span>
                  {item.lastEventAt
                    ? `Last report ${age(item.lastEventAt)}`
                    : "Awaiting first report"}
                </span>
                <ArrowRight size={17} />
              </div>
            </button>
          ))}
        </div>
      )}
      {create && (
        <CreateIntegration
          onClose={() => setCreate(false)}
          onCreated={(result) => {
            setCreate(false);
            setCredentials(result);
            setSelected(result.integration.id);
            void cache.invalidateQueries();
          }}
        />
      )}
      {register && integration && (
        <RegisterAction
          integration={integration}
          onClose={() => setRegister(false)}
          onCreated={() => {
            setRegister(false);
            void cache.invalidateQueries();
          }}
        />
      )}
      {credentials && (
        <Modal
          title="Save your integration credentials"
          onClose={() => setCredentials(null)}
        >
          <div className="notice">
            <ShieldCheck size={18} /> These credentials are shown once. Copy
            them to your origin system before closing.
          </div>
          <Secret label="Reporting key" value={credentials.reportingKey} />
          <Secret
            label="Callback signing secret"
            value={credentials.signingSecret}
          />
          <p className="helper">
            Use the reporting key to submit exceptions. Verify callback
            signatures with the signing secret. Do not put either credential in
            a URL.
          </p>
          <button className="primary full" onClick={() => setCredentials(null)}>
            I’ve saved these credentials <Check size={16} />
          </button>
        </Modal>
      )}
    </>
  );
}
function Secret({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  return (
    <div className="secret">
      <label>
        {label}
        <textarea readOnly value={value} />
      </label>
      <button
        onClick={() => {
          void navigator.clipboard.writeText(value).then(
            () => {
              setCopied(true);
              setError(false);
            },
            () => setError(true),
          );
        }}
      >
        {copied ? <Check size={15} /> : <Copy size={15} />}
        {copied ? "Copied" : "Copy"}
      </button>
      {error && (
        <p className="helper">
          Clipboard unavailable. Select and copy the credential above.
        </p>
      )}
    </div>
  );
}
function CreateIntegration({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (result: Credentials) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      onCreated(
        await api.createIntegration({
          name: String(values.get("name")).trim(),
          environment: String(values.get("environment")).trim(),
          callbackUrl: String(values.get("callbackUrl")).trim(),
        }),
      );
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Add an integration" onClose={() => !busy && onClose()}>
      <p>
        Connect an origin system that reports exceptions and accepts signed
        recovery commands.
      </p>
      <form onSubmit={submit}>
        <label>
          Integration name
          <input
            name="name"
            placeholder="Vendor onboarding"
            required
            maxLength={120}
            disabled={busy}
          />
        </label>
        <label>
          Environment
          <input
            name="environment"
            placeholder="production"
            required
            maxLength={50}
            disabled={busy}
          />
        </label>
        <label>
          Callback URL
          <input
            name="callbackUrl"
            type="url"
            placeholder="https://your-system.example/recovery"
            required
            disabled={busy}
          />
        </label>
        {error != null && <ErrorBox error={error} />}
        <div className="modal-actions">
          <button type="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "Creating…" : "Create integration"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function validateSchema(value: unknown): asserts value is InputSchema {
  if (!value || typeof value !== "object")
    throw new Error("Input schema must be a JSON object.");
  const schema = value as InputSchema;
  if (
    schema.type !== "object" ||
    !schema.properties ||
    typeof schema.properties !== "object" ||
    Array.isArray(schema.properties)
  )
    throw new Error('Schema must use type "object" and a properties object.');
  for (const [name, field] of Object.entries(schema.properties)) {
    if (!field || !["string", "number", "boolean"].includes(field.type))
      throw new Error(
        `Property "${name}" must have type string, number, or boolean.`,
      );
    if (
      field.enum &&
      (!Array.isArray(field.enum) ||
        field.enum.some((item) => typeof item !== "string") ||
        field.type !== "string")
    )
      throw new Error(
        `Property "${name}" enum must contain strings and use type string.`,
      );
    for (const key of ["minLength", "maxLength", "minimum", "maximum"] as const)
      if (field[key] !== undefined && typeof field[key] !== "number")
        throw new Error(`Property "${name}" ${key} must be a number.`);
  }
  if (
    schema.required &&
    (!Array.isArray(schema.required) ||
      schema.required.some(
        (key) => typeof key !== "string" || !(key in schema.properties),
      ))
  )
    throw new Error("Required must be an array of existing property names.");
}
function RegisterAction({
  integration,
  onClose,
  onCreated,
}: {
  integration: Integration;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [schema, setSchema] = useState(
    '{\n  "type": "object",\n  "properties": {},\n  "required": []\n}',
  );
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setError(null);
    try {
      const parsed: unknown = JSON.parse(schema);
      validateSchema(parsed);
      setBusy(true);
      await api.registerAction(integration.id, {
        actionKey: String(values.get("actionKey")),
        label: String(values.get("label")),
        description: String(values.get("description")),
        riskLevel: String(values.get("riskLevel")),
        requiresConfirmation: values.get("requiresConfirmation") === "on",
        inputSchema: parsed,
      });
      onCreated();
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Register recovery action" onClose={() => !busy && onClose()}>
      <p>
        Define an action that {integration.name} can execute. Inputs become a
        validated operator form.
      </p>
      <form onSubmit={submit}>
        <div className="form-row">
          <label>
            Action key
            <input
              name="actionKey"
              placeholder="patch_country"
              pattern="[a-zA-Z0-9_.-]+"
              required
              disabled={busy}
            />
          </label>
          <label>
            Operator label
            <input
              name="label"
              placeholder="Patch country"
              required
              disabled={busy}
            />
          </label>
        </div>
        <label>
          Description
          <textarea
            name="description"
            placeholder="Explain what changes in the origin system."
            required
            disabled={busy}
          />
        </label>
        <div className="form-row">
          <label>
            Risk level
            <select name="riskLevel" disabled={busy}>
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
            </select>
          </label>
          <label className="checkbox-label">
            <input
              name="requiresConfirmation"
              type="checkbox"
              defaultChecked
              disabled={busy}
            />{" "}
            Require confirmation
          </label>
        </div>
        <label>
          Input JSON Schema
          <textarea
            className="schema-editor"
            spellCheck={false}
            value={schema}
            onChange={(event) => setSchema(event.target.value)}
            required
            disabled={busy}
          />
        </label>
        <p className="helper">
          Use object properties with string, number, or boolean types. Supports
          required, enum, lengths, and numeric bounds.
        </p>
        {error != null && <ErrorBox error={error} />}
        <div className="modal-actions">
          <button type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "Registering…" : "Register action"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
