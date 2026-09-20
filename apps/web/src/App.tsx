import { useEffect, useState } from "react";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Activity,
  ArrowRight,
  ChevronRight,
  CircleHelp,
  Code2,
  FlaskConical,
  Inbox,
  Loader2,
  LogOut,
  PlugZap,
  ShieldCheck,
} from "lucide-react";
import { api, tokenStore, type Role, type Session } from "./api";
import { Busy, ErrorBox, Logo, Modal, go, titleCase } from "./ui";
import { InboxPage, DemoLab, ActivityPage } from "./pages";
import { CasePage } from "./case-page";
import { Integrations } from "./integrations";
import { MotionConfig } from "motion/react";
import { RouteEntrance } from "./motion";
import { RecoveryFlow } from "./recovery-story";
import "./styles.css";
import "./recovery-story.css";
const client = new QueryClient({
  defaultOptions: {
    queries: { refetchInterval: 5000, refetchOnWindowFocus: true, retry: 1 },
  },
});
function useRoute() {
  const [route, setRoute] = useState(location.hash.slice(1) || "/inbox");
  useEffect(() => {
    const update = () => setRoute(location.hash.slice(1) || "/inbox");
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  return route;
}
function useLiveInvalidation() {
  const cache = useQueryClient();
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    (async () => {
      try {
        const response = await fetch("/api/events", {
          headers: { Authorization: `Bearer ${tokenStore.get()}` },
          signal: controller.signal,
        });
        if (!response.ok || !response.body) return;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let pending = "";
        while (active) {
          const chunk = await reader.read();
          if (chunk.done) break;
          pending += decoder
            .decode(chunk.value, { stream: true })
            .replace(/\r\n/g, "\n");
          const events = pending.split("\n\n");
          pending = events.pop() || "";
          if (events.some((event) => event.includes("invalidate")))
            await cache.invalidateQueries();
        }
      } catch {
        /* Polling remains active if the stream is interrupted. */
      }
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, [cache]);
}
export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <QueryClientProvider client={client}>
        <SessionGate />
      </QueryClientProvider>
    </MotionConfig>
  );
}
function SessionGate() {
  const [hasToken, setHasToken] = useState(Boolean(tokenStore.get()));
  const session = useQuery({
    queryKey: ["session"],
    queryFn: api.session,
    enabled: hasToken,
    retry: false,
    refetchInterval: false,
  });
  const cache = useQueryClient();
  function signOut() {
    tokenStore.clear();
    setHasToken(false);
    cache.clear();
    go("/inbox");
  }
  if (!hasToken)
    return (
      <Launch
        onLogin={() => {
          cache.removeQueries({ queryKey: ["session"] });
          setHasToken(true);
        }}
      />
    );
  if (session.isLoading)
    return (
      <div className="session-loading">
        <Logo />
        <Busy />
      </div>
    );
  if (session.error)
    return (
      <div className="session-loading">
        <Logo />
        <ErrorBox error={session.error} retry={() => void session.refetch()} />
        <button onClick={signOut}>Return to sign in</button>
      </div>
    );
  return session.data ? (
    <Workspace session={session.data} onSignOut={signOut} />
  ) : null;
}
function Launch({ onLogin }: { onLogin: () => void }) {
  const health = useQuery({
    queryKey: ["health"],
    queryFn: api.health,
    refetchInterval: 15000,
  });
  const [role, setRole] = useState<Role>("OPERATOR");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function login(demo: boolean) {
    setBusy(true);
    setError(null);
    try {
      if (demo) {
        const result = await api.login(role);
        tokenStore.set(result.token);
      } else {
        tokenStore.set(token.trim());
        await api.session();
      }
      onLogin();
    } catch (cause) {
      tokenStore.clear();
      setError(cause);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="launch">
      <section className="launch-story">
        <Logo />
        <div>
          <p className="eyebrow">THE OPERATIONS RECOVERY LAYER</p>
          <h1>
            Every exception.
            <br />A way forward.
          </h1>
          <p className="launch-copy">
            Bring operations back on track. Turn workflow failures into clear,
            controlled recovery actions — with the full story in one place.
          </p>
          <RecoveryFlow />
          <div className="launch-proof">
            <ShieldCheck size={20} /> Governed actions <span /> Durable outcomes{" "}
            <span /> Complete audit trail
          </div>
        </div>
        <span className="launch-footer">
          BUILT FOR THE MOMENTS BETWEEN FAILED AND FIXED
        </span>
      </section>
      <section className="launch-panel">
        <div className="launch-card">
          <span className="section-kicker">YOUR WORKSPACE AWAITS</span>
          <h2>Welcome to RecoveryPlane</h2>
          <p>
            Get hands-on with real recovery workflows in the demo workspace.
          </p>
          {health.isLoading ? (
            <Busy />
          ) : health.error ? (
            <ErrorBox
              error={health.error}
              retry={() => void health.refetch()}
            />
          ) : health.data?.demo ? (
            <>
              <label>
                Explore as
                <select
                  value={role}
                  onChange={(event) => setRole(event.target.value as Role)}
                >
                  <option value="OPERATOR">
                    Operator — triage and recover
                  </option>
                  <option value="ADMIN">Admin — configure integrations</option>
                  <option value="VIEWER">
                    Viewer — explore in read-only mode
                  </option>
                </select>
              </label>
              <button
                className="primary full"
                disabled={busy}
                onClick={() => void login(true)}
              >
                {busy ? (
                  <Loader2 size={17} className="spin" />
                ) : (
                  <ArrowRight size={17} />
                )}{" "}
                Open demo workspace
              </button>
              <p className="helper center">
                A real API. Persisted cases. No setup required.
              </p>
            </>
          ) : (
            <div className="notice">
              Demo access is disabled on this server.
            </div>
          )}
          <div className="divider">
            <span>OR CONNECT YOUR WORKSPACE</span>
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void login(false);
            }}
          >
            <label>
              Workspace access token
              <input
                autoComplete="off"
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder="Enter your provisioned token"
                required
              />
            </label>
            <button className="full" disabled={busy || !token.trim()}>
              Connect workspace <ArrowRight size={16} />
            </button>
          </form>
          {error != null && <ErrorBox error={error} />}
        </div>
        <p className="launch-security">
          <ShieldCheck size={15} /> Tokens stay in this browser session.
        </p>
      </section>
    </div>
  );
}
function Workspace({
  session,
  onSignOut,
}: {
  session: Session;
  onSignOut: () => void;
}) {
  useLiveInvalidation();
  const route = useRoute();
  const section = route.split("/")[1] || "inbox";
  const [help, setHelp] = useState(false);
  const health = useQuery({ queryKey: ["health"], queryFn: api.health });
  const list = useQuery({
    queryKey: ["cases", "summary"],
    queryFn: () => api.cases(),
  });
  const navigation = [
    { id: "inbox", label: "Inbox", icon: Inbox },
    { id: "activity", label: "Activity", icon: Activity },
    { id: "integrations", label: "Integrations", icon: PlugZap },
    ...(session.demo
      ? [{ id: "demo", label: "Demo lab", icon: FlaskConical }]
      : []),
  ];
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Logo />
        <p className="tagline">Bring operations back on track.</p>
        <div className="workspace-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          {navigation.map((item) => (
            <a
              key={item.id}
              href={`#/${item.id}`}
              className={
                section === item.id ||
                (section === "cases" && item.id === "inbox")
                  ? "active"
                  : ""
              }
            >
              <item.icon size={18} />
              {item.label}
              {item.id === "inbox" && list.data && (
                <span className="nav-count">{list.data.stats.open}</span>
              )}
              {item.id === "demo" && <span className="nav-lab">SANDBOX</span>}
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="support-card">
            <span className="support-icon">
              <Code2 size={18} />
            </span>
            <strong>Made to fit your workflows</strong>
            <p>Connect an integration and bring your recovery actions here.</p>
            <button onClick={() => setHelp(true)}>
              API quick start <ArrowRight size={15} />
            </button>
          </div>
          <div className="workspace-account">
            <span className="org-avatar">
              {session.user.organizationName.slice(0, 1)}
            </span>
            <div>
              <strong>{session.user.organizationName}</strong>
              <small>{titleCase(session.user.role)} session</small>
            </div>
            <button aria-label="Sign out" title="Sign out" onClick={onSignOut}>
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <span>Workspace</span>
            <ChevronRight size={14} />
            <strong>
              {section === "cases"
                ? "Exception inbox"
                : navigation.find((item) => item.id === section)?.label ||
                  "Inbox"}
            </strong>
          </div>
          <div className="topbar-right">
            <span className={`connection ${health.isError ? "offline" : ""}`}>
              <i />
              {health.isError
                ? "Connection interrupted"
                : health.isLoading
                  ? "Connecting"
                  : "Connected"}
            </span>
            {session.demo && <span className="demo-chip">Demo workspace</span>}
            <span
              className="user-avatar"
              title={`${session.user.name} · ${titleCase(session.user.role)}`}
            >
              {session.user.name
                .split(" ")
                .map((n) => n[0])
                .slice(0, 2)
                .join("")}
            </span>
          </div>
        </header>
        <main>
          {session.user.role === "VIEWER" && (
            <div className="notice viewer">
              <ShieldCheck size={16} /> You’re viewing this workspace. Recovery
              and settings require an operator or admin.
            </div>
          )}
          <RouteEntrance key={route}>
            {section === "cases" && route.split("/")[2] ? (
              <CasePage
                key={route}
                id={decodeURIComponent(route.split("/")[2]!)}
                session={session}
              />
            ) : section === "integrations" ? (
              <Integrations session={session} />
            ) : section === "activity" ? (
              <ActivityPage />
            ) : section === "demo" && session.demo ? (
              <DemoLab session={session} />
            ) : (
              <InboxPage session={session} />
            )}
          </RouteEntrance>
        </main>
        <footer className="page-footer">
          <span>
            RecoveryPlane <span className="muted">/</span> Operations, back on
            track.
          </span>
          <button className="text-button" onClick={() => setHelp(true)}>
            <CircleHelp size={14} /> API quick start
          </button>
        </footer>
      </div>
      {help && (
        <Modal
          title="Connect your recovery workflow"
          onClose={() => setHelp(false)}
        >
          <p>
            Create an integration as an admin to receive a reporting key and
            callback signing secret. Register each recovery action with its
            input schema.
          </p>
          <ol className="help-steps">
            <li>
              <strong>Connect your origin system.</strong> Set a callback URL
              that receives recovery commands and verifies their signatures.
            </li>
            <li>
              <strong>Report exceptions.</strong> Use the SDK or reporting API
              with your integration’s reporting key.
            </li>
            <li>
              <strong>Recover with confidence.</strong> Operators run registered
              actions here. The origin system reports the outcome and case
              disposition.
            </li>
          </ol>
          <div className="code-label">CONSOLE API</div>
          <pre>
            GET /api/cases{"\n"}GET /api/cases/:id{"\n"}POST
            /api/cases/:id/actions/:actionId{"\n"}Authorization: Bearer
            &lt;session token&gt;
          </pre>
          <p className="helper">
            Action requests include version, input, idempotencyKey, and
            confirmed. Unknown outcomes retry the existing command. The origin
            decides whether a case resolves.
          </p>
          <button
            className="primary"
            onClick={() => {
              setHelp(false);
              go("/integrations");
            }}
          >
            View integrations <ArrowRight size={16} />
          </button>
        </Modal>
      )}
    </div>
  );
}
