import type {
  ReportExceptionRequest,
  RegisterActionRequest,
  RecoveryResult,
} from "@recoveryplane/contracts";
import { verifyPayload, signPayload } from "./signing.js";
export { verifyPayload, signPayload } from "./signing.js";
export * from "@recoveryplane/contracts";
export class RecoveryPlaneError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly response?: unknown,
  ) {
    super(message);
    this.name = "RecoveryPlaneError";
  }
}
export class RecoveryPlane {
  constructor(
    private config: { apiKey: string; baseUrl: string; timeoutMs?: number },
  ) {}
  private async request<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(
      `${this.config.baseUrl.replace(/\/$/, "")}${path}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 10000),
      },
    );
    const text = await response.text();
    let result: any;
    try {
      result = JSON.parse(text);
    } catch {
      result = { error: text.slice(0, 500) };
    }
    if (!response.ok)
      throw new RecoveryPlaneError(
        result.error ?? `HTTP ${response.status}`,
        response.status,
        result,
      );
    return result as T;
  }
  readonly exceptions = {
    report: (request: ReportExceptionRequest) =>
      this.request<{ id: string }>("/v1/exceptions", request),
  };
  readonly actions = {
    register: (integrationId: string, request: RegisterActionRequest) =>
      this.request(
        `/api/integrations/${encodeURIComponent(integrationId)}/actions`,
        request,
      ),
  };
  async reportResult(
    integrationId: string,
    commandId: string,
    result: RecoveryResult,
    signingSecret: string,
  ) {
    const body = JSON.stringify(result),
      timestamp = String(Date.now()),
      identity = `${integrationId}:${commandId}`;
    const response = await fetch(
      `${this.config.baseUrl.replace(/\/$/, "")}/v1/integrations/${encodeURIComponent(integrationId)}/commands/${encodeURIComponent(commandId)}/result`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-recoveryplane-timestamp": timestamp,
          "x-recoveryplane-signature": signPayload(
            signingSecret,
            timestamp,
            identity,
            body,
          ),
        },
        body,
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 10000),
      },
    );
    if (!response.ok)
      throw new RecoveryPlaneError("Result submission failed", response.status);
  }
  readonly middleware = {
    verifySignature:
      (secret: string) => (req: any, res: any, next: () => void) => {
        const identity = req.headers["x-recoveryplane-command-id"];
        if (
          !Buffer.isBuffer(req.rawBody) ||
          !verifyPayload(
            secret,
            req.headers["x-recoveryplane-timestamp"],
            identity,
            req.rawBody,
            req.headers["x-recoveryplane-signature"],
          ) ||
          req.body?.commandId !== identity
        )
          return res.status(401).json({ error: "Invalid command signature" });
        next();
      },
  };
}
