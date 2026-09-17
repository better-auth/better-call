import {
	context,
	type Meter,
	type ROOT_CONTEXT,
	type Span,
	SpanKind,
	SpanStatusCode,
	type Tracer,
	trace,
} from "@opentelemetry/api";
import { beforeEach, describe, expect, it } from "vitest";
import { v } from "../../index";
import { route } from "../http/route";
import { createRouter } from "../http/router";
import { isTelemetryModule, type TelemetryLogger, telemetry } from "./index";

type CapturedSpan = {
	name: string;
	kind?: SpanKind;
	attributes: Record<string, unknown>;
	status?: { code: SpanStatusCode; message?: string };
	exceptions: Error[];
	ended: boolean;
};

const createCapturingTracer = () => {
	const spans: CapturedSpan[] = [];

	const makeSpan = (
		name: string,
		kind?: SpanKind,
		attributes?: Record<string, unknown>,
	): Span & { _cap: CapturedSpan } => {
		const cap: CapturedSpan = {
			name,
			kind,
			attributes: { ...(attributes ?? {}) },
			exceptions: [],
			ended: false,
		};
		spans.push(cap);
		const span = {
			_cap: cap,
			spanContext: () => ({
				traceId: "0".repeat(32),
				spanId: "0".repeat(16),
				traceFlags: 1,
			}),
			setAttribute(key: string, value: unknown) {
				cap.attributes[key] = value;
				return span;
			},
			setAttributes(attrs: Record<string, unknown>) {
				Object.assign(cap.attributes, attrs);
				return span;
			},
			addEvent() {
				return span;
			},
			setStatus(status: { code: SpanStatusCode; message?: string }) {
				cap.status = status;
				return span;
			},
			updateName(next: string) {
				cap.name = next;
				return span;
			},
			end() {
				cap.ended = true;
			},
			isRecording: () => true,
			recordException(err: Error) {
				cap.exceptions.push(err);
			},
		};
		return span as unknown as Span & { _cap: CapturedSpan };
	};

	const tracer = {
		startSpan(
			name: string,
			options?: { kind?: SpanKind; attributes?: Record<string, unknown> },
		) {
			return makeSpan(name, options?.kind, options?.attributes);
		},
		startActiveSpan(
			name: string,
			arg2?: unknown,
			arg3?: unknown,
			arg4?: unknown,
		) {
			let options: { kind?: SpanKind; attributes?: Record<string, unknown> } =
				{};
			let ctx = context.active();
			let fn: (span: Span) => unknown;
			if (typeof arg2 === "function") {
				fn = arg2 as (span: Span) => unknown;
			} else if (typeof arg3 === "function") {
				options = (arg2 ?? {}) as typeof options;
				fn = arg3 as (span: Span) => unknown;
			} else {
				options = (arg2 ?? {}) as typeof options;
				ctx = (arg3 as typeof ctx) ?? ctx;
				fn = arg4 as (span: Span) => unknown;
			}
			const span = makeSpan(name, options.kind, options.attributes);
			const withSpan = trace.setSpan(ctx, span);
			return context.with(withSpan, () => fn(span));
		},
	} as unknown as Tracer;

	return { tracer, spans };
};

const createCapturingMeter = () => {
	const histograms: Array<{
		name: string;
		value: number;
		attrs?: Record<string, unknown>;
	}> = [];
	const counters: Array<{
		name: string;
		value: number;
		attrs?: Record<string, unknown>;
	}> = [];
	const meter = {
		createHistogram(name: string) {
			return {
				record(value: number, attrs?: Record<string, unknown>) {
					histograms.push({ name, value, attrs });
				},
			};
		},
		createCounter(name: string) {
			return {
				add(value: number, attrs?: Record<string, unknown>) {
					counters.push({ name, value, attrs });
				},
			};
		},
		createGauge() {
			return { record() {} };
		},
		createObservableGauge() {
			return {};
		},
		createObservableCounter() {
			return {};
		},
		createObservableUpDownCounter() {
			return {};
		},
		createUpDownCounter() {
			return { add() {} };
		},
		addBatchObservableCallback() {},
		removeBatchObservableCallback() {},
	} as unknown as Meter;
	return { meter, histograms, counters };
};

describe("telemetry()", () => {
	const hello = v.fn(
		"demo.hello",
		{
			use: [route({ path: "/hello", method: "GET" })],
			output: v.object({ ok: v.boolean() }),
		},
		() => ({ ok: true }),
	);

	const boom = v.fn(
		"demo.boom",
		{
			use: [route({ path: "/boom", method: "POST" })],
			errors: { nope: v.object({}) },
		},
		(c) => {
			throw c.error("nope", {});
		},
	);

	let capturing: ReturnType<typeof createCapturingTracer>;
	let meterCap: ReturnType<typeof createCapturingMeter>;
	let logs: Array<Record<string, unknown>>;

	beforeEach(() => {
		capturing = createCapturingTracer();
		meterCap = createCapturingMeter();
		logs = [];
	});

	const logger: TelemetryLogger = {
		emit(record) {
			logs.push(record as Record<string, unknown>);
		},
	};

	it("isTelemetryModule detects the brand", () => {
		expect(isTelemetryModule(telemetry())).toBe(true);
		expect(isTelemetryModule({})).toBe(false);
	});

	it("creates a request span and a fn span for a successful route", async () => {
		const router = createRouter(
			{ hello },
			{
				use: [
					telemetry({
						tracer: capturing.tracer,
						meter: meterCap.meter,
					}),
				],
			},
		);

		const res = await router(new Request("http://localhost/hello"));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });

		const requestSpan = capturing.spans.find((s) => s.name.startsWith("GET "));
		expect(requestSpan).toBeTruthy();
		expect(requestSpan?.kind).toBe(SpanKind.SERVER);
		expect(requestSpan?.attributes["http.request.method"]).toBe("GET");
		expect(requestSpan?.attributes["http.response.status_code"]).toBe(200);
		expect(requestSpan?.ended).toBe(true);

		const fnSpan = capturing.spans.find((s) => s.name === "demo.hello");
		expect(fnSpan).toBeTruthy();
		expect(fnSpan?.kind).toBe(SpanKind.INTERNAL);
		expect(fnSpan?.attributes["better_call.fn"]).toBe("demo.hello");
		expect(fnSpan?.attributes["better_call.route.path"]).toBe("/hello");
		expect(fnSpan?.ended).toBe(true);

		expect(
			meterCap.histograms.some(
				(h) => h.name === "http.server.request.duration",
			),
		).toBe(true);
		expect(
			meterCap.histograms.some((h) => h.name === "better_call.fn.duration"),
		).toBe(true);
		expect(
			meterCap.counters.some((c) => c.name === "http.server.request.count"),
		).toBe(true);
	});

	it("records exceptions, ERROR status, and logs on FnError", async () => {
		const router = createRouter(
			{ boom },
			{
				use: [
					telemetry({
						tracer: capturing.tracer,
						meter: meterCap.meter,
						logger,
					}),
				],
			},
		);

		const res = await router(
			new Request("http://localhost/boom", { method: "POST" }),
		);
		expect(res.status).toBeGreaterThanOrEqual(400);

		const fnSpan = capturing.spans.find((s) => s.name === "demo.boom");
		expect(fnSpan?.exceptions.length).toBeGreaterThan(0);
		expect(fnSpan?.status?.code).toBe(SpanStatusCode.ERROR);
		expect(fnSpan?.attributes["error.type"]).toBe("FnError");
		expect(fnSpan?.attributes["error.code"]).toBe("nope");

		expect(logs.length).toBeGreaterThan(0);
		expect(logs[0]?.severityText).toBe("ERROR");

		expect(
			meterCap.counters.some(
				(c) =>
					c.name === "better_call.fn.errors" &&
					c.attrs?.["better_call.fn"] === "demo.boom",
			),
		).toBe(true);
	});

	it("extracts W3C traceparent into the request span parent context", async () => {
		const seenParents: Array<string | undefined> = [];
		const wrapped = createCapturingTracer();
		const original = wrapped.tracer.startActiveSpan.bind(wrapped.tracer);
		(wrapped.tracer as { startActiveSpan: typeof original }).startActiveSpan = (
			name,
			arg2,
			arg3,
			arg4,
		) => {
			if (
				typeof name === "string" &&
				name.startsWith("GET ") &&
				typeof arg4 === "function"
			) {
				const parentCtx = arg3 as typeof ROOT_CONTEXT;
				seenParents.push(trace.getSpanContext(parentCtx)?.traceId);
			}
			return original(name, arg2 as never, arg3 as never, arg4 as never);
		};

		const router = createRouter(
			{ hello },
			{
				use: [
					telemetry({
						tracer: wrapped.tracer,
						meter: meterCap.meter,
					}),
				],
			},
		);

		const traceId = "0af7651916cd43dd8448eb211c80319c";
		const parentSpanId = "b7ad6b7169203331";
		await router(
			new Request("http://localhost/hello", {
				headers: {
					traceparent: `00-${traceId}-${parentSpanId}-01`,
				},
			}),
		);

		expect(seenParents[0]).toBe(traceId);
	});

	it("honors exclude filters for fn spans", async () => {
		const router = createRouter(
			{ hello },
			{
				use: [
					telemetry({
						tracer: capturing.tracer,
						meter: meterCap.meter,
						exclude: ["demo.hello"],
					}),
				],
			},
		);

		await router(new Request("http://localhost/hello"));

		expect(capturing.spans.some((s) => s.name.startsWith("GET "))).toBe(true);
		expect(capturing.spans.some((s) => s.name === "demo.hello")).toBe(false);
	});

	it("does nothing special when telemetry is not mounted", async () => {
		const router = createRouter({ hello });
		const res = await router(new Request("http://localhost/hello"));
		expect(res.status).toBe(200);
		expect(capturing.spans).toHaveLength(0);
	});
});
