import {
	type Counter,
	context,
	type Histogram,
	isSpanContextValid,
	type Meter,
	metrics,
	propagation,
	ROOT_CONTEXT,
	type Span,
	SpanKind,
	SpanStatusCode,
	TraceFlags,
	type Tracer,
	trace,
} from "@opentelemetry/api";
import { FnError, UnexpectedError, v } from "../../index";
import type { Module } from "../../module";

const INSTRUMENTATION_NAME = "better-call";
const ATTR_FN = "better_call.fn";
const ATTR_ROUTE_PATH = "better_call.route.path";
const ATTR_ROUTE_METHOD = "better_call.route.method";
const ATTR_ROUTE_INVALIDATE = "better_call.route.invalidate";
const ATTR_ROUTE_DECLARED_STATUS = "better_call.route.declared_status";
const ATTR_SUMMARY = "better_call.summary";
const ATTR_DESCRIPTION = "better_call.description";
const ATTR_IDEMPOTENT = "better_call.idempotent";
const ATTR_DEPRECATED = "better_call.deprecated";
const ATTR_TAGS = "better_call.tags";
/** Declared error tags (`errors: { … }`) — OpenAPI response keys. */
const ATTR_ERRORS = "better_call.errors";
const ATTR_HTTP_METHOD = "http.request.method";
const ATTR_HTTP_ROUTE = "http.route";
const ATTR_HTTP_STATUS = "http.response.status_code";
const ATTR_URL_PATH = "url.path";
const ATTR_URL_SCHEME = "url.scheme";
const ATTR_URL_QUERY = "url.query";
const ATTR_SERVER_ADDRESS = "server.address";
const ATTR_SERVER_PORT = "server.port";
const ATTR_USER_AGENT = "user_agent.original";
const ATTR_ERROR_TYPE = "error.type";
const ATTR_ERROR_CODE = "error.code";

/** Keys that get a dedicated request span — skip a second fn span. */
const SKIP_FN_SPAN = new Set(["http.router.dispatch", "http.from_request", ""]);

/** Query keys stripped from `url.query` (case-insensitive substring match). */
const REDACT_QUERY_KEYS = [
	"token",
	"secret",
	"password",
	"passwd",
	"auth",
	"api_key",
	"apikey",
	"access_token",
	"refresh_token",
	"session",
	"cookie",
	"credential",
	"sig",
	"signature",
];

type AttrValue = string | number | boolean;
type AttrMap = Record<string, AttrValue>;

export type TelemetryFilter = string | RegExp;

/**
 * Minimal logger shape (compatible with `@opentelemetry/api-logs` Logger).
 * Pass via {@link TelemetryOptions.logger}, or install `api-logs` for a default.
 */
export type TelemetryLogger = {
	emit: (record: {
		severityNumber?: number;
		severityText?: string;
		body?: unknown;
		attributes?: Record<string, unknown>;
	}) => void;
};

export type TelemetryOptions = {
	tracer?: Tracer;
	meter?: Meter;
	logger?: TelemetryLogger;
	/** Only instrument fn keys / route paths matching any entry. */
	include?: readonly TelemetryFilter[];
	/** Skip fn keys / route paths matching any entry (applied after include). */
	exclude?: readonly TelemetryFilter[];
};

export type TelemetryModule = Module & {
	readonly $telemetry: true;
};

export const isTelemetryModule = (value: unknown): value is TelemetryModule =>
	typeof value === "object" &&
	value !== null &&
	(value as { $telemetry?: unknown }).$telemetry === true;

const matchesFilter = (
	filters: readonly TelemetryFilter[] | undefined,
	candidates: readonly string[],
): boolean => {
	if (!filters || filters.length === 0) return true;
	return filters.some((filter) =>
		candidates.some((value) =>
			typeof filter === "string"
				? value === filter || value.includes(filter)
				: filter.test(value),
		),
	);
};

const shouldInstrument = (
	options: TelemetryOptions,
	fnKey: string,
	routePath?: string,
): boolean => {
	if (SKIP_FN_SPAN.has(fnKey)) return false;
	const candidates = routePath ? [fnKey, routePath] : [fnKey];
	if (!matchesFilter(options.include, candidates)) return false;
	if (
		options.exclude &&
		options.exclude.length > 0 &&
		matchesFilter(options.exclude, candidates)
	) {
		return false;
	}
	return true;
};

const headerGetter = {
	keys: (carrier: Headers): string[] => [...carrier.keys()],
	get: (carrier: Headers, key: string): string | undefined => {
		const value = carrier.get(key);
		return value === null ? undefined : value;
	},
};

/** W3C `traceparent` parse — works without a global propagator. */
const extractW3C = (parent: Context, headers: Headers): Context => {
	const raw = headers.get("traceparent");
	if (!raw) return parent;
	const parts = raw.trim().split("-");
	if (parts.length < 4) return parent;
	const [version, traceId, spanId, flagsHex] = parts;
	if (version !== "00" || !traceId || !spanId || !flagsHex) return parent;
	const spanContext = {
		traceId,
		spanId,
		traceFlags:
			Number.parseInt(flagsHex, 16) & TraceFlags.SAMPLED
				? TraceFlags.SAMPLED
				: TraceFlags.NONE,
		isRemote: true as const,
	};
	if (!isSpanContextValid(spanContext)) return parent;
	return trace.setSpanContext(parent, spanContext);
};

const extractIncoming = (headers: Headers): Context => {
	const active = context.active();
	const viaPropagator = propagation.extract(active, headers, headerGetter);
	const remote = trace.getSpanContext(viaPropagator);
	if (remote?.isRemote && isSpanContextValid(remote)) return viaPropagator;
	return extractW3C(
		viaPropagator === active ? ROOT_CONTEXT : viaPropagator,
		headers,
	);
};

const asError = (thrown: unknown): Error => {
	if (thrown instanceof Error) return thrown;
	return new Error(typeof thrown === "string" ? thrown : String(thrown));
};

const errorAttrs = (
	thrown: unknown,
): Record<string, string | number | boolean> => {
	if (thrown instanceof FnError) {
		return {
			[ATTR_ERROR_TYPE]: "FnError",
			[ATTR_ERROR_CODE]: thrown.tag,
		};
	}
	if (thrown instanceof UnexpectedError) {
		return { [ATTR_ERROR_TYPE]: "UnexpectedError" };
	}
	if (thrown instanceof Error) {
		return { [ATTR_ERROR_TYPE]: thrown.name || "Error" };
	}
	return { [ATTR_ERROR_TYPE]: "unknown" };
};

const recordError = (
	span: Span,
	logger: TelemetryLogger | undefined,
	thrown: unknown,
	extra?: Record<string, string | number | boolean>,
) => {
	const err = asError(thrown);
	span.recordException(err);
	span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
	const attrs = { ...errorAttrs(thrown), ...extra };
	span.setAttributes(attrs);
	logger?.emit({
		severityNumber: 17, // ERROR
		severityText: "ERROR",
		body: err.message,
		attributes: attrs,
	});
};

type Instruments = {
	requestDuration: Histogram;
	requestCount: Counter;
	fnDuration: Histogram;
	fnErrors: Counter;
};

const createInstruments = (meter: Meter): Instruments => ({
	requestDuration: meter.createHistogram("http.server.request.duration", {
		description: "HTTP request duration",
		unit: "s",
	}),
	requestCount: meter.createCounter("http.server.request.count", {
		description: "HTTP requests",
	}),
	fnDuration: meter.createHistogram("better_call.fn.duration", {
		description: "better-call fn duration",
		unit: "s",
	}),
	fnErrors: meter.createCounter("better_call.fn.errors", {
		description: "better-call fn errors",
	}),
});

const nowMs = () =>
	typeof performance !== "undefined" ? performance.now() : Date.now();

const elapsedSec = (start: number) => (nowMs() - start) / 1000;

const fnKeyOf = (c: {
	fnKey?: string;
	fn?: { key?: string } | string;
}): string => {
	if (typeof c.fnKey === "string" && c.fnKey.length > 0) return c.fnKey;
	const fn = c.fn;
	if (fn && typeof fn === "object" && typeof fn.key === "string") return fn.key;
	if (typeof fn === "string") return fn;
	return "";
};

const routeOf = (c: {
	route?: {
		path?: string;
		method?: string;
		invalidate?: readonly string[];
		status?: number;
	} | null;
}): {
	path?: string;
	method?: string;
	invalidate?: string[];
	status?: number;
} => {
	const route = c.route;
	if (!route || typeof route !== "object") return {};
	const invalidate = Array.isArray(route.invalidate)
		? route.invalidate.filter((v): v is string => typeof v === "string")
		: undefined;
	return {
		path: typeof route.path === "string" ? route.path : undefined,
		method: typeof route.method === "string" ? route.method : undefined,
		invalidate: invalidate?.length ? invalidate : undefined,
		status: typeof route.status === "number" ? route.status : undefined,
	};
};

/**
 * OpenAPI / docs fields from a fn's `$schema` (same set `toOpenAPI` reads
 * for operations: summary, description, tags, deprecated — plus idempotent
 * and declared error tags).
 */
type FnSchemaMeta = {
	tags?: readonly string[];
	summary?: string;
	description?: string;
	idempotent?: boolean;
	deprecated?: boolean;
	/** Tag → payload schema map on the callable; only keys become attrs. */
	errors?: Record<string, unknown>;
};

const schemaOf = (c: {
	$schema?: FnSchemaMeta;
	fn?: { $schema?: FnSchemaMeta } | string;
}): FnSchemaMeta | undefined => {
	if (c.$schema && typeof c.$schema === "object") return c.$schema;
	const fn = c.fn;
	if (fn && typeof fn === "object" && fn.$schema) return fn.$schema;
	return undefined;
};

const shouldRedactQueryKey = (key: string): boolean => {
	const lower = key.toLowerCase();
	return REDACT_QUERY_KEYS.some(
		(needle) => lower === needle || lower.includes(needle),
	);
};

/** Build a redacted `url.query` string from a URL search string. */
const redactQuery = (search: string): string | undefined => {
	const raw = search.startsWith("?") ? search.slice(1) : search;
	if (!raw) return undefined;
	const params = new URLSearchParams(raw);
	const out = new URLSearchParams();
	for (const [key, value] of params) {
		out.append(key, shouldRedactQueryKey(key) ? "REDACTED" : value);
	}
	const serialized = out.toString();
	return serialized.length > 0 ? serialized : undefined;
};

/** OTel HTTP URL / server / UA attrs from an incoming request. */
const requestUrlAttrs = (request: {
	path?: string;
	headers?: Headers;
	raw?: Request;
	query?: Record<string, string | string[]>;
}): AttrMap => {
	const attrs: AttrMap = {};
	const headers = request.headers;
	const ua = headers?.get("user-agent");
	if (ua) attrs[ATTR_USER_AGENT] = ua;

	let url: URL | undefined;
	const rawUrl = request.raw?.url;
	if (typeof rawUrl === "string" && rawUrl.length > 0) {
		try {
			url = new URL(rawUrl);
		} catch {
			url = undefined;
		}
	}

	if (url) {
		if (url.protocol) {
			attrs[ATTR_URL_SCHEME] = url.protocol.replace(/:$/, "");
		}
		if (url.hostname) attrs[ATTR_SERVER_ADDRESS] = url.hostname;
		if (url.port) {
			attrs[ATTR_SERVER_PORT] = Number(url.port);
		} else if (url.protocol === "https:") {
			attrs[ATTR_SERVER_PORT] = 443;
		} else if (url.protocol === "http:") {
			attrs[ATTR_SERVER_PORT] = 80;
		}
		const query = redactQuery(url.search);
		if (query) attrs[ATTR_URL_QUERY] = query;
	} else if (request.query && typeof request.query === "object") {
		const params = new URLSearchParams();
		for (const [key, value] of Object.entries(request.query)) {
			if (Array.isArray(value)) {
				for (const item of value) params.append(key, item);
			} else if (typeof value === "string") {
				params.append(key, value);
			}
		}
		const query = redactQuery(params.toString());
		if (query) attrs[ATTR_URL_QUERY] = query;
	}

	// Prefer forwarded host/proto when present (behind a proxy).
	const forwardedProto = headers?.get("x-forwarded-proto");
	if (forwardedProto) {
		const proto = forwardedProto.split(",")[0]?.trim();
		if (proto) attrs[ATTR_URL_SCHEME] = proto;
	}
	const forwardedHost = headers?.get("x-forwarded-host");
	const hostHeader = forwardedHost ?? headers?.get("host");
	if (hostHeader) {
		const host = hostHeader.split(",")[0]?.trim();
		if (host) {
			const [address, port] = host.split(":");
			if (address) attrs[ATTR_SERVER_ADDRESS] = address;
			if (port && !Number.isNaN(Number(port))) {
				attrs[ATTR_SERVER_PORT] = Number(port);
			}
		}
	}

	return attrs;
};

const routeAttrs = (
	route: ReturnType<typeof routeOf>,
	opts?: { httpRoute?: boolean },
): AttrMap => {
	const attrs: AttrMap = {};
	if (route.path) {
		attrs[ATTR_ROUTE_PATH] = route.path;
		if (opts?.httpRoute) attrs[ATTR_HTTP_ROUTE] = route.path;
	}
	if (route.method) attrs[ATTR_ROUTE_METHOD] = route.method;
	if (route.invalidate?.length) {
		attrs[ATTR_ROUTE_INVALIDATE] = [...new Set(route.invalidate)].join(",");
	}
	if (typeof route.status === "number") {
		attrs[ATTR_ROUTE_DECLARED_STATUS] = route.status;
	}
	return attrs;
};

const schemaAttrs = (schema: FnSchemaMeta | undefined): AttrMap => {
	const attrs: AttrMap = {};
	if (!schema) return attrs;
	if (schema.tags?.length) attrs[ATTR_TAGS] = [...schema.tags].join(",");
	if (typeof schema.summary === "string" && schema.summary.length > 0) {
		attrs[ATTR_SUMMARY] = schema.summary;
	}
	if (typeof schema.description === "string" && schema.description.length > 0) {
		attrs[ATTR_DESCRIPTION] = schema.description;
	}
	if (typeof schema.idempotent === "boolean") {
		attrs[ATTR_IDEMPOTENT] = schema.idempotent;
	}
	if (typeof schema.deprecated === "boolean") {
		attrs[ATTR_DEPRECATED] = schema.deprecated;
	}
	if (schema.errors && typeof schema.errors === "object") {
		const tags = Object.keys(schema.errors);
		if (tags.length > 0) attrs[ATTR_ERRORS] = tags.join(",");
	}
	return attrs;
};

/**
 * Router `use` module: request spans, per-fn child spans, HTTP/fn metrics,
 * and error LogRecords (when a logger is available).
 *
 * ```ts
 * import { telemetry } from "better-call/otel";
 * createRouter(routes, { use: [telemetry()] });
 * ```
 *
 * Register an OTel context manager (e.g. via the Node SDK) so spans nest
 * across `await`. Peer: `@opentelemetry/api`. Pass `logger` for error LogRecords
 * (e.g. from `@opentelemetry/api-logs`).
 */
export function telemetry(options: TelemetryOptions = {}): TelemetryModule {
	const tracer = options.tracer ?? trace.getTracer(INSTRUMENTATION_NAME);
	const meter = options.meter ?? metrics.getMeter(INSTRUMENTATION_NAME);
	const logger = options.logger;
	const instruments = createInstruments(meter);

	return {
		$telemetry: true,
		$requestSpan: v.on("http.router.dispatch", async (c, next) => {
			const request = c.req as
				| {
						method?: string;
						path?: string;
						headers?: Headers;
						raw?: Request;
						query?: Record<string, string | string[]>;
				  }
				| null
				| undefined;
			const method = (request?.method ?? "GET").toUpperCase();
			const path = request?.path ?? "/";
			const headers = request?.headers ?? new Headers();
			const parent = extractIncoming(headers);
			const start = nowMs();
			const urlAttrs = request ? requestUrlAttrs(request) : ({} as AttrMap);

			return tracer.startActiveSpan(
				`${method} ${path}`,
				{
					kind: SpanKind.SERVER,
					attributes: {
						[ATTR_HTTP_METHOD]: method,
						[ATTR_URL_PATH]: path,
						...urlAttrs,
					},
				},
				parent,
				async (span) => {
					try {
						const result = await next();
						const status =
							result instanceof Response
								? result.status
								: ((c.res as { status?: number } | null | undefined)?.status ??
									200);
						const route = routeOf(c);
						span.setAttribute(ATTR_HTTP_STATUS, status);
						span.setAttributes(routeAttrs(route, { httpRoute: true }));
						if (status >= 500) {
							span.setStatus({
								code: SpanStatusCode.ERROR,
								message: `HTTP ${status}`,
							});
						}
						const attrs = {
							[ATTR_HTTP_METHOD]: method,
							[ATTR_HTTP_STATUS]: status,
							...(route.path ? { [ATTR_HTTP_ROUTE]: route.path } : {}),
						};
						instruments.requestDuration.record(elapsedSec(start), attrs);
						instruments.requestCount.add(1, attrs);
						return result;
					} catch (thrown) {
						recordError(span, logger, thrown, {
							[ATTR_HTTP_METHOD]: method,
							[ATTR_URL_PATH]: path,
						});
						instruments.requestCount.add(1, {
							[ATTR_HTTP_METHOD]: method,
							[ATTR_HTTP_STATUS]: 500,
						});
						instruments.requestDuration.record(elapsedSec(start), {
							[ATTR_HTTP_METHOD]: method,
							[ATTR_HTTP_STATUS]: 500,
						});
						throw thrown;
					} finally {
						span.end();
					}
				},
			);
		}),
		$fnSpan: v.on("*", async (c, next) => {
			const key = fnKeyOf(c);
			const routeBefore = routeOf(c);
			if (!shouldInstrument(options, key, routeBefore.path)) {
				return next();
			}

			const start = nowMs();
			const attributes: AttrMap = {
				[ATTR_FN]: key,
				...routeAttrs(routeBefore),
				...schemaAttrs(schemaOf(c)),
			};

			return tracer.startActiveSpan(
				key,
				{ kind: SpanKind.INTERNAL, attributes },
				async (span) => {
					try {
						const result = await next();
						// `route()` seeds `c.route` inside the chain — read after next.
						span.setAttributes(routeAttrs(routeOf(c)));
						instruments.fnDuration.record(elapsedSec(start), {
							[ATTR_FN]: key,
						});
						return result;
					} catch (thrown) {
						span.setAttributes(routeAttrs(routeOf(c)));
						recordError(span, logger, thrown, { [ATTR_FN]: key });
						instruments.fnErrors.add(1, {
							[ATTR_FN]: key,
							...errorAttrs(thrown),
						});
						instruments.fnDuration.record(elapsedSec(start), {
							[ATTR_FN]: key,
							error: true,
						});
						throw thrown;
					} finally {
						span.end();
					}
				},
			);
		}),
	};
}
