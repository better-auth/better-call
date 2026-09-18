# OpenTelemetry (`better-call/otel`)

Optional router `use` module for traces, metrics, and error logs.

## Install

```bash
pnpm add @opentelemetry/api
# app also needs an SDK / exporters (not bundled here)
```

## Usage

```ts
import { createRouter } from "better-call/http";
import { telemetry } from "better-call/otel";
import { trace, metrics } from "@opentelemetry/api";

createRouter(routes, {
  use: [
    telemetry({
      tracer: trace.getTracer("my-app"),
      meter: metrics.getMeter("my-app"),
      // logger: logs.getLogger("my-app"), // optional error LogRecords
      // include: ["auth."],
      // exclude: [/^internal\./],
    }),
  ],
});
```

Register an OTel **context manager** (Node SDK does this) so spans nest across `await`.

## What it does

| Signal | Behavior |
|--------|----------|
| **Traces** | SERVER span on `http.router.dispatch`; INTERNAL child span per `v.fn` (`c.fnKey`) |
| **Metrics** | `http.server.request.duration` / `.count`; `better_call.fn.duration` / `.errors` |
| **Logs** | When `logger` is passed: ERROR LogRecords for thrown errors (linked via active span) |
| **Propagation** | Extracts W3C `traceparent` from the incoming request (works without a global propagator) |
| **Errors** | `span.recordException` + status `ERROR`; HTTP ≥500 marks the request span |

Attributes include OTel HTTP conventions (`http.request.method`, `http.route`,
`http.response.status_code`, `url.path` / `url.scheme` / `url.query`,
`server.address` / `server.port`, `user_agent.original`) plus
`better_call.fn`, `better_call.route.path` / `.method` / `.invalidate` /
`.declared_status`, and `$schema` fields when present (`better_call.tags`,
`.summary`, `.idempotent`, `.deprecated`). Sensitive query keys
(`token`, `api_key`, …) are redacted in `url.query`.

Skipped for fn spans: `http.router.dispatch`, `http.from_request` (request span already covers dispatch).

## Options

```ts
telemetry({
  tracer?: Tracer;           // default: trace.getTracer("better-call")
  meter?: Meter;             // default: metrics.getMeter("better-call")
  logger?: TelemetryLogger;  // optional; no logs if omitted
  include?: Array<string | RegExp>;
  exclude?: Array<string | RegExp>;
});
```

## Settled design

| Topic | Choice |
|--------|--------|
| Mount | `telemetry()` in router `use` (like `openapi()`) |
| Package | `better-call/otel` |
| Deps | Peer `@opentelemetry/api` (optional peer so other entrypoints stay light) |
| Out of scope | Bundled SDK, outbound client inject, console log bridge |
