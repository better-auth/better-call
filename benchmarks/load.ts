import http from "node:http";
import type { AddressInfo } from "node:net";
import { toNodeHandler } from "better-call/node";
import type { BenchRequest, Scenario } from "./scenarios.ts";

export type BenchMode = "http" | "handler";

export type LoadOptions = {
	connections: number;
	duration: number;
	warmup: number;
};

export type LoadResult = {
	requestsPerSec: number;
	latencyP50: number;
	latencyP99: number;
	errors: number;
	non2xx: number;
	samples: number;
};

type TimedResponse = {
	ok: boolean;
	ms: number;
};

const HIST_BUCKETS = 1024;
const HIST_MIN_US = 1;
const HIST_MAX_US = 60_000_000;
const HIST_LOG_MIN = Math.log(HIST_MIN_US);
const HIST_LOG_RANGE = Math.log(HIST_MAX_US) - HIST_LOG_MIN;

type LoadStats = {
	ok: number;
	errors: number;
	non2xx: number;
	latencies: Uint32Array;
};

function createStats(): LoadStats {
	return {
		ok: 0,
		errors: 0,
		non2xx: 0,
		latencies: new Uint32Array(HIST_BUCKETS),
	};
}

function latencyBucket(ms: number): number {
	const us = ms * 1000;
	if (!Number.isFinite(us) || us <= HIST_MIN_US) {
		return 0;
	}
	if (us >= HIST_MAX_US) {
		return HIST_BUCKETS - 1;
	}
	return Math.min(
		HIST_BUCKETS - 1,
		Math.floor(((Math.log(us) - HIST_LOG_MIN) / HIST_LOG_RANGE) * HIST_BUCKETS),
	);
}

function bucketToMs(index: number): number {
	const logUs = HIST_LOG_MIN + ((index + 0.5) / HIST_BUCKETS) * HIST_LOG_RANGE;
	return Math.exp(logUs) / 1000;
}

function recordSample(stats: LoadStats, sample: TimedResponse) {
	if (!sample.ok) {
		stats.errors += 1;
		stats.non2xx += 1;
		return;
	}
	stats.ok += 1;
	const bucket = latencyBucket(sample.ms);
	stats.latencies[bucket] = (stats.latencies[bucket] ?? 0) + 1;
}

function percentile(stats: LoadStats, p: number): number {
	if (stats.ok === 0) {
		return 0;
	}
	const rank = Math.ceil((p / 100) * stats.ok) - 1;
	const target = Math.min(stats.ok - 1, Math.max(0, rank));
	let seen = 0;
	for (let index = 0; index < stats.latencies.length; index++) {
		seen += stats.latencies[index] ?? 0;
		if (seen > target) {
			return bucketToMs(index);
		}
	}
	return HIST_MAX_US / 1000;
}

function summarize(stats: LoadStats, elapsedMs: number): LoadResult {
	return {
		requestsPerSec: elapsedMs > 0 ? (stats.ok / elapsedMs) * 1000 : 0,
		latencyP50: percentile(stats, 50),
		latencyP99: percentile(stats, 99),
		errors: stats.errors,
		non2xx: stats.non2xx,
		samples: stats.ok + stats.errors,
	};
}

async function runWorkers(
	connections: number,
	durationSeconds: number,
	send: () => Promise<TimedResponse>,
	stats?: LoadStats,
): Promise<number> {
	const end = performance.now() + durationSeconds * 1000;
	const worker = async () => {
		while (performance.now() < end) {
			try {
				const sample = await send();
				if (stats) {
					recordSample(stats, sample);
				}
			} catch {
				if (stats) {
					recordSample(stats, { ok: false, ms: 0 });
				}
			}
		}
	};
	const started = performance.now();
	await Promise.all(Array.from({ length: connections }, () => worker()));
	return performance.now() - started;
}

async function measure(
	options: LoadOptions,
	send: () => Promise<TimedResponse>,
): Promise<LoadResult> {
	if (options.warmup > 0) {
		await runWorkers(options.connections, options.warmup, send);
	}
	const stats = createStats();
	const elapsedMs = await runWorkers(
		options.connections,
		options.duration,
		send,
		stats,
	);
	return summarize(stats, elapsedMs);
}

function createRequestInit(request: BenchRequest): RequestInit {
	const init: RequestInit = {
		method: request.method,
	};
	if (request.headers) {
		init.headers = request.headers;
	}
	if (request.body !== undefined) {
		init.body = request.body;
	}
	return init;
}

async function assertHealthy(scenario: Scenario, origin?: string) {
	const url = `${origin ?? "http://127.0.0.1"}${scenario.request.path}`;
	const init = createRequestInit(scenario.request);
	const response = origin
		? await fetch(url, init)
		: scenario.handler
			? await scenario.handler(new Request(url, init))
			: undefined;
	if (!response) {
		throw new Error(`${scenario.name} has no fetch handler for smoke check`);
	}
	if (!response.ok) {
		const body = await response.text();
		throw new Error(
			`${scenario.name} smoke check failed: ${response.status} ${body}`,
		);
	}
	await response.arrayBuffer();
}

function getNodeListener(scenario: Scenario) {
	if (scenario.nodeListener) {
		return scenario.nodeListener;
	}
	if (scenario.handler) {
		return toNodeHandler(scenario.handler);
	}
	throw new Error(`${scenario.name} has no HTTP handler`);
}

async function listen(
	listener: http.RequestListener,
): Promise<{ origin: string; close: () => Promise<void> }> {
	const server = http.createServer(listener);
	await new Promise<void>((resolve) => {
		server.listen(0, "127.0.0.1", resolve);
	});
	const address = server.address() as AddressInfo;
	return {
		origin: `http://127.0.0.1:${address.port}`,
		close: () =>
			new Promise<void>((resolve, reject) => {
				server.closeAllConnections();
				server.close((error) => {
					if (error) {
						reject(error);
						return;
					}
					resolve();
				});
			}),
	};
}

function createHttpClient(
	origin: string,
	request: BenchRequest,
	connections: number,
) {
	const url = new URL(request.path, origin);
	const agent = new http.Agent({
		keepAlive: true,
		maxSockets: connections,
	});
	const headers: http.OutgoingHttpHeaders = {
		...request.headers,
		host: url.host,
	};
	return {
		send(): Promise<TimedResponse> {
			const started = performance.now();
			return new Promise((resolve, reject) => {
				let settled = false;
				const finish = (sample: TimedResponse) => {
					if (settled) {
						return;
					}
					settled = true;
					resolve(sample);
				};
				const fail = (error: Error) => {
					if (settled) {
						return;
					}
					settled = true;
					reject(error);
				};
				const req = http.request(
					{
						agent,
						protocol: url.protocol,
						hostname: url.hostname,
						port: url.port,
						path: `${url.pathname}${url.search}`,
						method: request.method,
						headers,
					},
					(res) => {
						res.on("end", () => {
							const status = res.statusCode ?? 0;
							finish({
								ok: status >= 200 && status < 300,
								ms: performance.now() - started,
							});
						});
						res.on("error", fail);
						res.on("close", () => {
							if (!res.complete) {
								fail(new Error("incomplete response"));
							}
						});
						res.resume();
					},
				);
				req.on("error", fail);
				req.end(request.body);
			});
		},
		close() {
			agent.destroy();
		},
	};
}

export async function runHttpLoad(
	scenario: Scenario,
	options: LoadOptions,
): Promise<LoadResult> {
	const server = await listen(getNodeListener(scenario));
	const client = createHttpClient(
		server.origin,
		scenario.request,
		options.connections,
	);
	try {
		await assertHealthy(scenario, server.origin);
		return await measure(options, client.send);
	} finally {
		client.close();
		await server.close();
	}
}

export async function runHandlerLoad(
	scenario: Scenario,
	options: LoadOptions,
): Promise<LoadResult> {
	if (!scenario.handler) {
		throw new Error(`${scenario.name} cannot run in handler mode`);
	}
	const handler = scenario.handler;
	const url = `http://127.0.0.1${scenario.request.path}`;
	const init = createRequestInit(scenario.request);
	const send = async (): Promise<TimedResponse> => {
		const started = performance.now();
		const response = await handler(new Request(url, init));
		await response.arrayBuffer();
		return {
			ok: response.ok,
			ms: performance.now() - started,
		};
	};
	await assertHealthy(scenario);
	return measure(options, send);
}
