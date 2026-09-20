export type Role = "ADMIN" | "OPERATOR" | "VIEWER";
export interface User {
  id: string;
  name: string;
  role: Role;
  organizationId: string;
  organizationName: string;
}
export interface Session {
  user: User;
  demo: boolean;
}
export interface Property {
  type: "string" | "number" | "boolean";
  title?: string;
  description?: string;
  enum?: string[];
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
}
export interface InputSchema {
  type: "object";
  properties: Record<string, Property>;
  required?: string[];
}
export interface Action {
  id: string;
  actionKey: string;
  label: string;
  description: string;
  version: number;
  riskLevel: "LOW" | "MEDIUM";
  requiresConfirmation: boolean;
  enabled: boolean;
  inputSchema: InputSchema;
}
export interface Case {
  id: string;
  number: number;
  title: string;
  message: string;
  organizationId: string;
  integrationId: string;
  integrationName: string;
  environment: string;
  workflow: string;
  step: string;
  entity: { type: string; id: string };
  context: Record<string, unknown>;
  priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  status: "OPEN" | "RESOLVED" | "CANCELLED" | "DISMISSED";
  recoveryStatus: string;
  ownerId: string | null;
  version: number;
  occurrenceCount: number;
  createdAt: string;
  updatedAt: string;
}
export interface Audit {
  id: string;
  eventType: string;
  actorName: string;
  message: string;
  createdAt: string;
}
export interface Command {
  id: string;
  actionKey: string;
  actionLabel: string;
  status: string;
  input: Record<string, unknown>;
  createdAt: string;
  result?: { message: string; outcome: string; caseDisposition: string };
  deliveries: {
    id: string;
    attempt: number;
    status: string;
    error?: string;
    createdAt: string;
  }[];
}
export interface CaseDetail extends Case {
  actions: Action[];
  commands: Command[];
  timeline: Audit[];
  relatedCases: Case[];
}
export interface CaseList {
  cases: Case[];
  stats: {
    open: number;
    awaitingConfirmation: number;
    recovered: number;
    total: number;
  };
  members: User[];
}
export interface Integration {
  id: string;
  name: string;
  environment: string;
  callbackUrl: string;
  enabled: boolean;
  createdAt: string;
  lastEventAt: string | null;
  actions: Action[];
  caseCount: number;
}
export interface Vendor {
  id: string;
  name: string;
  country: string | null;
  status: string;
  mutationCount: number;
}
export interface Credentials {
  integration: Integration;
  reportingKey: string;
  signingSecret: string;
}
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}
const tokenKey = "recoveryplane.session";
export const tokenStore = {
  get: () => sessionStorage.getItem(tokenKey),
  set: (token: string) => sessionStorage.setItem(tokenKey, token),
  clear: () => sessionStorage.removeItem(tokenKey),
};
export async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = tokenStore.get();
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new ApiError(
      payload.error || `Request failed (${response.status})`,
      response.status,
      payload.code,
    );
  return payload as T;
}
const post = <T>(path: string, body: unknown) =>
  request<T>(path, { method: "POST", body: JSON.stringify(body) });
const patch = <T>(path: string, body: unknown) =>
  request<T>(path, { method: "PATCH", body: JSON.stringify(body) });
export const api = {
  health: () =>
    request<{ status: string; mode: string; demo: boolean }>("/health"),
  session: () => request<Session>("/session"),
  login: (role: Role) =>
    post<Session & { token: string }>("/auth/demo", { role }),
  cases: (query = "") => request<CaseList>(`/cases${query}`),
  case: (id: string) => request<CaseDetail>(`/cases/${encodeURIComponent(id)}`),
  updateCase: (
    id: string,
    body: {
      version: number;
      priority?: string;
      ownerId?: string | null;
      status?: "DISMISSED";
      note?: string;
    },
  ) => patch<CaseDetail>(`/cases/${encodeURIComponent(id)}`, body),
  note: (id: string, text: string) =>
    post<CaseDetail>(`/cases/${encodeURIComponent(id)}/notes`, { text }),
  action: (
    id: string,
    actionId: string,
    body: {
      version: number;
      input: Record<string, unknown>;
      idempotencyKey: string;
      confirmed: boolean;
    },
  ) =>
    post<{ command: Command; case: CaseDetail }>(
      `/cases/${encodeURIComponent(id)}/actions/${encodeURIComponent(actionId)}`,
      body,
    ),
  retry: (id: string) =>
    post<CaseDetail>(`/commands/${encodeURIComponent(id)}/retry`, {}),
  integrations: () => request<{ integrations: Integration[] }>("/integrations"),
  createIntegration: (body: {
    name: string;
    environment: string;
    callbackUrl: string;
  }) => post<Credentials>("/integrations", body),
  enableIntegration: (id: string, enabled: boolean) =>
    patch<Integration>(`/integrations/${encodeURIComponent(id)}`, { enabled }),
  registerAction: (
    id: string,
    body: {
      actionKey: string;
      label: string;
      description: string;
      inputSchema: InputSchema;
      riskLevel: string;
      requiresConfirmation: boolean;
    },
  ) => post<Action>(`/integrations/${encodeURIComponent(id)}/actions`, body),
  enableAction: (id: string, actionId: string, enabled: boolean) =>
    patch<Action>(
      `/integrations/${encodeURIComponent(id)}/actions/${encodeURIComponent(actionId)}`,
      { enabled },
    ),
  scenario: (scenario: string) =>
    post<{ caseId: string; message: string }>("/demo/scenarios", { scenario }),
  vendors: () => request<{ vendors: Vendor[] }>("/demo/vendors"),
  activity: () => request<{ events: Audit[] }>("/activity"),
};
