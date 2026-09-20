# Connect an origin service

RecoveryPlane owns exception state. Your service owns business state and executes only the actions you register. Any HTTP-capable workflow can report exceptions; the SDK is optional.

## 1. Provision an integration

Sign into the console as an ADMIN. Open Integrations → Add integration, supply its environment and a public HTTPS callback, and save the one-time reporting key and signing secret. The local demo is the only permitted HTTP/loopback destination. Use a separate integration for each environment.

Register an action such as `patch_vendor`. Registration creates an immutable version; disabling the action disables all its versions. Historical cases keep their original version. Supported input fields are strings, numbers, booleans, and string enums inside a simple object. Required fields and length/range bounds are validated. Arrays, nested objects, arbitrary JSON Schema keywords, high-risk actions and independent approvals are intentionally rejected.

The reporting key cannot register or change actions. Provisioning requires a human ADMIN access token. See [HTTP-CONTRACT.md](HTTP-CONTRACT.md) for the console endpoints.

## 2. Report a problem

Send `POST /v1/exceptions` with `Authorization: Bearer <reporting-key>` and JSON:

```json
{
  "idempotencyKey": "vendor-42:onboarding-7:missing-country:report-1",
  "correlationKey": "vendor-42:onboarding-7:missing-country",
  "fingerprint": "vendor-missing-country-v1",
  "workflow": "vendor-onboarding",
  "executionId": "onboarding-7",
  "step": "verify-vendor",
  "entity": { "type": "vendor", "id": "vendor-42" },
  "exception": {
    "type": "missing_country",
    "message": "Vendor country is missing"
  },
  "context": { "vendorName": "Northstar Supplies" },
  "availableActions": ["patch_vendor", "retry_verification"]
}
```

Register both referenced actions before reporting. The entire validated report is hashed for deduplication. Reusing its idempotency key with any changed payload returns 409. A new report key may join an existing open case with the same correlation key, but entity, workflow, step, execution ID and exception type must agree. Fingerprints group similar cases; they never merge business problems.

In this monorepo, use the SDK as follows after building contracts/SDK:

```ts
import { RecoveryPlane } from "@recoveryplane/sdk";

const recovery = new RecoveryPlane({
  baseUrl: process.env.RECOVERYPLANE_URL!,
  apiKey: process.env.RECOVERYPLANE_REPORTING_KEY!,
});
await recovery.exceptions.report(report);
```

The SDK is included as a workspace package; no public npm release is claimed. For an external service, use the HTTP contract or package the SDK from this repository. Retry report delivery with exactly the same key and body after network errors.

## 3. Accept signed commands

Your registered callback receives this body:

```json
{
  "commandId": "cmd_example",
  "integrationId": "int_example",
  "caseId": "case_example",
  "actionKey": "patch_vendor",
  "actionVersion": 1,
  "entity": { "type": "vendor", "id": "vendor-42" },
  "input": { "country": "IN" }
}
```

Headers are `x-recoveryplane-command-id`, `x-recoveryplane-timestamp` (Unix milliseconds), and `x-recoveryplane-signature` (hex HMAC-SHA256). The signed bytes are `timestamp + '.' + commandId + '.' + rawBody`. Preserve the raw request bytes:

```ts
app.use(
  express.json({
    limit: "64kb",
    verify(req, _res, bytes) {
      req.rawBody = bytes;
    },
  }),
);
app.post(
  "/recovery",
  recovery.middleware.verifySignature(signingSecret),
  handler,
);
```

The middleware requires a Buffer `rawBody`, binds the header identity to the body’s `commandId`, checks a five-minute timestamp window, and uses constant-time signature comparison. It does **not** replace durable deduplication.

Inside one origin transaction:

1. Lock the target entity and find a receipt for this command ID.
2. If a receipt exists, reject changed payload reuse; otherwise return its exact saved result.
3. Validate the action version, inputs, and current business preconditions.
4. Apply the mutation and persist the command hash/result atomically.
5. Commit before sending the response.

For external side effects, use the external system’s idempotency key support or an explicit reconciliation process. A receipt in your DB alone cannot make an unrelated external payment/API atomic. The [vendor origin](../apps/vendor-onboarding-demo/src/origin.ts) is a complete example for local database mutations.

## 4. Confirm the actual outcome

Return a 2xx response with this exact result shape:

```json
{
  "outcome": "SUCCEEDED",
  "caseDisposition": "UNCHANGED",
  "message": "Country updated. Verification is still required."
}
```

`outcome` is `SUCCEEDED` or `FAILED`. `caseDisposition` is `UNCHANGED`, `RESOLVED`, or `CANCELLED`; failed actions cannot close a case. Only return `RESOLVED` when the blocked business operation really recovered. Cancellation is not included in recovery metrics. A plain 200/202 with no valid result leaves the outcome unknown.

For asynchronous completion, send a signed POST to `/v1/integrations/:integrationId/commands/:commandId/result`. Sign with `timestamp + '.' + integrationId + ':' + commandId + '.' + rawBody`. Or use `recovery.reportResult(integrationId, commandId, result, signingSecret)`. Duplicate identical results are accepted; conflicting results return 409. No reporting credential can submit arbitrary unsigned results.

The dispatcher attempts delivery up to three times automatically, using the same command ID and fresh signature timestamps. After exhausted attempts the unknown command stays active. Operators can request reconciliation of that same command; they cannot silently replace it with a new business action. Your durable receipt should always be able to replay a confirmed result.

## HTTP-only workflow example

In n8n or another HTTP workflow, configure an HTTP Request node with the report URL, JSON body above, and a reporting key stored in its credential store. Supply unique execution-specific keys from the workflow. A separate recovery callback must implement raw-body signature verification, durable receipts and explicit outcome reporting before enabling any action. This recipe demonstrates the HTTP contract; it is not a prebuilt or tested n8n connector.
