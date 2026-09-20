import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Inbox,
  Layers3,
  Loader2,
  Play,
  PlugZap,
  Plus,
  Radio,
  RefreshCw,
  Search,
  ShieldCheck,
} from "lucide-react";
import { api, type Session } from "./api";
import { RecoveryWalkthrough } from "./recovery-story";
import {
  age,
  Badge,
  Busy,
  Empty,
  ErrorBox,
  go,
  Modal,
  Timeline,
  titleCase,
} from "./ui";
export function InboxPage({ session }: { session: Session }) {
  const [status, setStatus] = useState("OPEN");
  const [q, setQ] = useState("");
  const [priority, setPriority] = useState("");
  const [source, setSource] = useState("");
  const [simulate, setSimulate] = useState(false);
  const filters = new URLSearchParams({
    status,
    ...(q ? { q } : {}),
    ...(priority ? { priority } : {}),
    ...(source ? { integrationId: source } : {}),
  }).toString();
  const cases = useQuery({
    queryKey: ["cases", filters],
    queryFn: () => api.cases(`?${filters}`),
  });
  const integrations = useQuery({
    queryKey: ["integrations"],
    queryFn: api.integrations,
  });
  const stats = cases.data?.stats;
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">A CLEAR PATH FROM EXCEPTION TO RESOLUTION</p>
          <h1>Exception inbox</h1>
          <p>Triage what needs attention. Get every workflow moving again.</p>
        </div>
        {session.demo && (
          <button
            className="primary"
            disabled={session.user.role === "VIEWER"}
            title={
              session.user.role === "VIEWER" ? "Operator access required" : ""
            }
            onClick={() => setSimulate(true)}
          >
            <Plus size={17} /> Simulate exception
          </button>
        )}
      </div>
      <div className="metrics">
        <Metric
          label="Open exceptions"
          value={stats?.open}
          icon={<Inbox size={17} />}
          note="Waiting for a way forward"
          accent="amber"
        />
        <Metric
          label="Awaiting confirmation"
          value={stats?.awaitingConfirmation}
          icon={<Clock3 size={17} />}
          note="Recovery in progress"
        />
        <Metric
          label="Recovered"
          value={stats?.recovered}
          icon={<CheckCircle2 size={17} />}
          note="Workflows back on track"
          accent="teal"
        />
        <Metric
          label="Total cases"
          value={stats?.total}
          icon={<Layers3 size={17} />}
          note="Across your workspace"
        />
      </div>
      <section className="panel inbox-panel">
        <div className="panel-top">
          <div className="tabs" aria-label="Case status">
            {[
              ["OPEN", "Open"],
              ["RESOLVED", "Recovered"],
              ["DISMISSED", "Dismissed"],
              ["CANCELLED", "Cancelled"],
              ["all", "All cases"],
            ].map(([value, label]) => (
              <button
                key={value}
                aria-pressed={status === value}
                className={status === value ? "selected" : ""}
                onClick={() => setStatus(value!)}
              >
                {label}
                {value === "OPEN" && stats && <span>{stats.open}</span>}
              </button>
            ))}
          </div>
          <span className="live-label">
            <Radio size={13} /> Updates live
          </span>
        </div>
        <div className="filterbar">
          <label className="search-field">
            <Search size={17} />
            <input
              aria-label="Search exceptions"
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder="Search exceptions, entities, workflows…"
            />
          </label>
          <select
            aria-label="Filter priority"
            value={priority}
            onChange={(event) => setPriority(event.target.value)}
          >
            <option value="">All priorities</option>
            {["CRITICAL", "HIGH", "MEDIUM", "LOW"].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
          <select
            aria-label="Filter integration"
            value={source}
            onChange={(event) => setSource(event.target.value)}
          >
            <option value="">All sources</option>
            {integrations.data?.integrations.map((value) => (
              <option key={value.id} value={value.id}>
                {value.name}
              </option>
            ))}
          </select>
          <button
            className="icon-button"
            aria-label="Refresh exceptions"
            disabled={cases.isFetching}
            onClick={() => void cases.refetch()}
          >
            <RefreshCw size={16} className={cases.isFetching ? "spin" : ""} />
          </button>
        </div>
        {cases.isLoading ? (
          <Busy />
        ) : cases.error ? (
          <ErrorBox error={cases.error} retry={() => void cases.refetch()} />
        ) : !cases.data?.cases.length ? (
          <Empty
            title={
              status === "OPEN" && !q && !source && !priority
                ? "You’re all caught up"
                : "No matching exceptions"
            }
          >
            {q || source || priority
              ? "Adjust your filters to find the cases you need."
              : session.demo
                ? "Simulate an exception to explore a complete recovery workflow."
                : "New exceptions will appear here when your integrations report them."}
          </Empty>
        ) : (
          <div className="table-scroll">
            <table className="case-table">
              <thead>
                <tr>
                  <th>Exception</th>
                  <th>Source / workflow</th>
                  <th>Priority</th>
                  <th>Owner</th>
                  <th>Created</th>
                  <th>
                    <span className="sr-only">Open case</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {cases.data.cases.map((item) => (
                  <tr key={item.id} onClick={() => go(`/cases/${item.id}`)}>
                    <td>
                      <a className="case-link" href={`#/cases/${item.id}`}>
                        <span className="case-number">RP-{item.number}</span>
                        <strong>{item.title}</strong>
                      </a>
                      <span className="case-subline">
                        {item.entity.type} <span>·</span> {item.entity.id}
                        {item.occurrenceCount > 1 && (
                          <span className="repeat-count">
                            {item.occurrenceCount} occurrences
                          </span>
                        )}
                        {item.recoveryStatus === "OUTCOME_UNKNOWN" && (
                          <Badge value="OUTCOME_UNKNOWN" />
                        )}
                      </span>
                    </td>
                    <td>
                      <div className="source-name">
                        <span className="source-icon">
                          <PlugZap size={14} />
                        </span>
                        {item.integrationName}
                      </div>
                      <span className="table-secondary">{item.workflow}</span>
                    </td>
                    <td>
                      <span
                        className={`priority priority-${item.priority.toLowerCase()}`}
                      >
                        <i />
                        {titleCase(item.priority)}
                      </span>
                    </td>
                    <td>
                      <span className="owner">
                        {item.ownerId ? (
                          <>
                            <span className="mini-avatar">
                              {(
                                cases.data.members.find(
                                  (member) => member.id === item.ownerId,
                                )?.name || "?"
                              ).slice(0, 1)}
                            </span>
                            {cases.data.members.find(
                              (member) => member.id === item.ownerId,
                            )?.name || "Assigned"}
                          </>
                        ) : (
                          <span className="unassigned">Unassigned</span>
                        )}
                      </span>
                    </td>
                    <td className="nowrap">
                      <span title={new Date(item.createdAt).toLocaleString()}>
                        {age(item.createdAt)}
                      </span>
                    </td>
                    <td>
                      <ChevronRight size={16} className="muted" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="table-footer">
          <span>
            {cases.data?.cases.length ?? 0}{" "}
            {status === "all" ? "" : titleCase(status).toLowerCase()} cases
          </span>
          <span>Recovery begins with context.</span>
        </div>
      </section>
      <div className="inbox-note">
        <ShieldCheck size={16} />
        <span>
          Every action is authorized, delivered to your origin system, and
          recorded in the audit trail.
        </span>
      </div>
      {simulate && <ScenarioModal onClose={() => setSimulate(false)} />}
    </>
  );
}
function Metric({
  label,
  value,
  icon,
  note,
  accent = "",
}: {
  label: string;
  value?: number;
  icon: ReactNode;
  note: string;
  accent?: string;
}) {
  return (
    <div className={`metric ${accent}`}>
      <div>
        <span>{label}</span>
        {icon}
      </div>
      <strong>{value ?? "—"}</strong>
      <small>{note}</small>
    </div>
  );
}
const scenarios = [
  {
    id: "missing_country",
    title: "Missing vendor country",
    description:
      "A vendor’s onboarding is blocked. Patch the missing country, then retry verification.",
    icon: PlugZap,
  },
  {
    id: "duplicate_reports",
    title: "Duplicate exception reports",
    description:
      "Repeated origin reports converge on one case. Inspect its occurrences and audit trail.",
    icon: Layers3,
  },
  {
    id: "lost_response",
    title: "A response lost in transit",
    description:
      "The origin commits the action but its response is lost. Retry the same command safely.",
    icon: Radio,
  },
];
export function ScenarioModal({ onClose }: { onClose: () => void }) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState<unknown>(null);
  const cache = useQueryClient();
  async function run(id: string) {
    setBusy(id);
    setError(null);
    try {
      const result = await api.scenario(id);
      await cache.invalidateQueries();
      onClose();
      go(`/cases/${result.caseId}`);
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy("");
    }
  }
  return (
    <Modal title="Simulate an exception" onClose={() => !busy && onClose()}>
      <p>
        These scenarios create real cases and durable vendor records in your
        demo workspace.
      </p>
      <div className="scenario-options">
        {scenarios.map((scenario) => (
          <button
            key={scenario.id}
            className="scenario-option"
            disabled={!!busy}
            onClick={() => void run(scenario.id)}
          >
            <span className="scenario-icon">
              <scenario.icon size={21} />
            </span>
            <span>
              <strong>{scenario.title}</strong>
              <small>{scenario.description}</small>
            </span>
            {busy === scenario.id ? (
              <Loader2 className="spin" size={18} />
            ) : (
              <ArrowRight size={18} />
            )}
          </button>
        ))}
      </div>
      {error != null && <ErrorBox error={error} />}
    </Modal>
  );
}
export function DemoLab({ session }: { session: Session }) {
  const vendors = useQuery({ queryKey: ["vendors"], queryFn: api.vendors });
  const [simulate, setSimulate] = useState(false);
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">REAL WORKFLOWS. A SAFE PLACE TO EXPLORE.</p>
          <h1>Demo lab</h1>
          <p>
            Follow an exception all the way back to a healthy origin system.
          </p>
        </div>
        <button
          className="primary"
          disabled={session.user.role === "VIEWER"}
          onClick={() => setSimulate(true)}
        >
          <Play size={16} /> Run a scenario
        </button>
      </div>
      <div className="scenario-grid">
        {scenarios.map((scenario, index) => (
          <section className="panel scenario-card" key={scenario.id}>
            <span className="section-kicker">SCENARIO 0{index + 1}</span>
            <scenario.icon size={25} />
            <h2>{scenario.title}</h2>
            <p>{scenario.description}</p>
          </section>
        ))}
      </div>
      <RecoveryWalkthrough />
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Origin vendor state</h2>
            <p>
              Persisted data from the demo origin. Watch it change as you
              recover cases.
            </p>
          </div>
          <span className="live-label">
            <Radio size={13} /> Live state
          </span>
        </div>
        {vendors.isLoading ? (
          <Busy />
        ) : vendors.error ? (
          <ErrorBox
            error={vendors.error}
            retry={() => void vendors.refetch()}
          />
        ) : !vendors.data?.vendors.length ? (
          <Empty title="No vendors yet">
            Run a scenario to create a vendor in the origin system.
          </Empty>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Vendor</th>
                  <th>Country</th>
                  <th>Status</th>
                  <th>Applied mutations</th>
                </tr>
              </thead>
              <tbody>
                {vendors.data.vendors.map((vendor) => (
                  <tr key={vendor.id}>
                    <td>
                      <strong>{vendor.name}</strong>
                      <span className="table-secondary mono">{vendor.id}</span>
                    </td>
                    <td>
                      {vendor.country || (
                        <span className="missing">Missing</span>
                      )}
                    </td>
                    <td>
                      <Badge value={vendor.status} />
                    </td>
                    <td>{vendor.mutationCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {simulate && <ScenarioModal onClose={() => setSimulate(false)} />}
    </>
  );
}
export function ActivityPage() {
  const activity = useQuery({ queryKey: ["activity"], queryFn: api.activity });
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">THE FULL STORY, IN ORDER</p>
          <h1>Workspace activity</h1>
          <p>
            One canonical audit trail for reports, actions, outcomes, and
            operator decisions.
          </p>
        </div>
        <button
          onClick={() => void activity.refetch()}
          disabled={activity.isFetching}
        >
          <RefreshCw size={16} /> Refresh
        </button>
      </div>
      <section className="panel padded">
        {activity.isLoading ? (
          <Busy />
        ) : activity.error ? (
          <ErrorBox
            error={activity.error}
            retry={() => void activity.refetch()}
          />
        ) : activity.data?.events.length ? (
          <Timeline events={activity.data.events} />
        ) : (
          <Empty title="A clean slate">
            Workspace events will appear here as your integrations report
            exceptions.
          </Empty>
        )}
      </section>
    </>
  );
}
