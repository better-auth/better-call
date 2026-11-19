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

function percentile(sorted: number[], p: number): number {
	if (sorted.length === 0) {
		return 0;
	}
	const rank = Math.ceil((p / 100) * sorted.length) - 1;
	const index = Math.min(sorted.length - 1, Math.max(0, rank));
	return sorted[index] ?? 0;
}

function summarize(samples: TimedResponse[], elapsedMs: number): LoadResult {
	const latencies: number[] = [];
	let errors = 0;
	let non2xx = 0;
	for (const sample of samples) {
		if (!sample.ok) {
			errors += 1;
			non2xx += 1;
			continue;
		}
		latencies.push(sample.ms);
	}
	latencies.sort((a, b) => a - b);
	const ok = latencies.length;
	return {
		requestsPerSec: elapsedMs > 0 ? (ok / elapsedMs) * 1000 : 0,
		latencyP50: percentile(latencies, 50),
		latencyP99: percentile(latencies, 99),
		errors,
		non2xx,
		samples: samples.length,
	};
}

async function runWorkers(
	connections: number,
	durationSeconds: number,
	send: () => Promise<TimedResponse>,
): Promise<{ samples: TimedResponse[]; elapsedMs: number }> {
	const samples: TimedResponse[] = [];
	const end = performance.now() + durationSeconds * 1000;
	const worker = async () => {
		while (performance.now() < end) {
			try {
				samples.push(await send());
			} catch {
				samples.push({ ok: false, ms: 0 });
			}
		}
	};
	const started = performance.now();
	await Promise.all(Array.from({ length: connections }, () => worker()));
	return {
		samples,
		elapsedMs: performance.now() - started,
	};
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
						res.resume();
						res.on("end", () => {
							const status = res.statusCode ?? 0;
							resolve({
								ok: status >= 200 && status < 300,
								ms: performance.now() - started,
							});
						});
					},
				);
				req.on("error", reject);
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
		if (options.warmup > 0) {
			await runWorkers(options.connections, options.warmup, client.send);
		}
		const { samples, elapsedMs } = await runWorkers(
			options.connections,
			options.duration,
			client.send,
		);
		return summarize(samples, elapsedMs);
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
	if (options.warmup > 0) {
		await runWorkers(options.connections, options.warmup, send);
	}
	const { samples, elapsedMs } = await runWorkers(
		options.connections,
		options.duration,
		send,
	);
	return summarize(samples, elapsedMs);
}
