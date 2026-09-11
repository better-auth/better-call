import { createFetch } from "@better-fetch/fetch";
import { buildPathTree, flattenRouteLeaves } from "../path-api";
import { INVALIDATE_HEADER } from "../route";
import { createStore, type Store } from "./store";
import type {
	ClientFetchOptions,
	ClientPlugin,
	ClientResult,
	CreateClientOptions,
	InferClientAPI,
	InferThrowFromOptions,
	ResolvedResource,
} from "./types";

type RouteNode = {
	path: string;
	method: string;
	invalidate: readonly string[];
};

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const parseInvalidateHeader = (value: string | null): string[] => {
	if (!value) return [];
	return value
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
};

const createProxy = (
	tree: Record<string, unknown>,
	call: (
		route: RouteNode,
		input: unknown,
		opts?: ClientFetchOptions,
	) => Promise<unknown>,
): Record<string, unknown> => {
	const target: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(tree)) {
		if (
			value &&
			typeof value === "object" &&
			(value as { $fn?: boolean }).$fn === true &&
			(value as { $route?: RouteNode }).$route
		) {
			const route = (value as { $route: RouteNode }).$route;
			target[key] = (input?: unknown, opts?: ClientFetchOptions) =>
				call(route, input, opts);
			continue;
		}
		if (value && typeof value === "object") {
			target[key] = createProxy(value as Record<string, unknown>, call);
		}
	}
	return target;
};

export function createClient<const O extends CreateClientOptions<any>>(
	options: O,
): InferClientAPI<O["routes"], InferThrowFromOptions<O>> & {
	$fetch: ReturnType<typeof createFetch>;
	$store: {
		resources: Record<string, ResolvedResource>;
		invalidate: (names: string[]) => Promise<void>;
	};
	plugins: ClientPlugin[];
} {
	const defaultThrow = options.fetchOptions?.throw === true;
	// Always capture as a value at the transport layer so we can still read
	// invalidate headers; `throw` is applied after success/error is known.
	const { throw: _throwOpt, ...restFetchOptions } = options.fetchOptions ?? {};
	const $fetch = createFetch({
		baseURL: options.baseURL,
		...restFetchOptions,
		throw: false,
	});

	const resources: Record<string, ResolvedResource> = {};

	const invalidate = async (names: string[]) => {
		const unique = [...new Set(names)];
		await Promise.all(
			unique.map(async (name) => {
				const resource = resources[name];
				if (resource) await resource.refetch();
			}),
		);
	};

	const runFetch = async (
		route: RouteNode,
		input: unknown,
		opts?: ClientFetchOptions,
	): Promise<unknown> => {
		const { disableInvalidate, ...fetchOpts } = opts ?? {};
		const shouldThrow = opts?.throw ?? defaultThrow;
		const method = route.method.toUpperCase();
		const isGet = method === "GET" || method === "HEAD";

		const result = await $fetch(route.path, {
			method: method as "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
			...(isGet
				? { query: (input as Record<string, unknown>) ?? undefined }
				: { body: input as Record<string, unknown> }),
			...fetchOpts,
			throw: false,
		} as Parameters<typeof $fetch>[1]);

		const data = (result as { data?: unknown }).data ?? null;
		const err = (
			result as {
				error?: {
					message?: string;
					status?: number;
					statusText?: string;
				} | null;
			}
		).error;
		const response = (result as { response?: Response }).response;

		if (!disableInvalidate && !err) {
			const fromStatic = [...(route.invalidate ?? [])];
			const fromHeader = parseInvalidateHeader(
				response?.headers?.get(INVALIDATE_HEADER) ?? null,
			);
			const merged = [...new Set([...fromStatic, ...fromHeader])];
			if (merged.length > 0) {
				await invalidate(merged);
			}
		}

		if (shouldThrow) {
			if (err) {
				const error = new Error(err.message ?? "Request failed") as Error & {
					status?: number;
					statusText?: string;
				};
				error.status = err.status ?? 500;
				error.statusText = err.statusText ?? "";
				throw error;
			}
			return data;
		}

		const wrapped: ClientResult<unknown> = {
			data: err ? null : data,
			error: err
				? {
						message: err.message ?? "Request failed",
						status: err.status ?? 500,
						statusText: err.statusText ?? "",
					}
				: null,
		};
		return wrapped;
	};

	const tree = buildPathTree(flattenRouteLeaves(options.routes));
	const api = createProxy(tree, runFetch);

	const client = api as InferClientAPI<
		O["routes"],
		InferThrowFromOptions<O>
	> & {
		$fetch: typeof $fetch;
		$store: {
			resources: Record<string, ResolvedResource>;
			invalidate: (names: string[]) => Promise<void>;
		};
		plugins: ClientPlugin[];
	};

	client.$fetch = $fetch;
	client.$store = { resources, invalidate };
	client.plugins = options.plugins ?? [];

	for (const plugin of client.plugins) {
		const ctx = {
			client: client as unknown as Record<string, unknown>,
			$fetch: async (path: string, fetchOpts?: ClientFetchOptions) => {
				const result = await runFetch(
					{
						path,
						method: String(fetchOpts?.method ?? "GET"),
						invalidate: [],
					},
					fetchOpts?.body ?? fetchOpts?.query,
					{ ...fetchOpts, throw: false },
				);
				return result as ClientResult<unknown>;
			},
		};
		const pluginResources = plugin.getResources?.(ctx) ?? {};
		for (const [name, resource] of Object.entries(pluginResources)) {
			const store: Store<unknown> = createStore();
			const refetch = async () => {
				const current = store.get();
				store.set({
					isPending: current.data === null && !current.error,
					isRefetching: current.data !== null || current.error !== null,
				});
				try {
					const data = await resource.query();
					store.setData(data);
				} catch (e) {
					store.setError(e instanceof Error ? e : new Error(String(e)));
				}
			};
			const resolved: ResolvedResource = {
				store,
				refetch,
				get: () => store.get(),
				subscribe: store.subscribe,
			};
			resources[name] = resolved;
			(client as Record<string, unknown>)[`use${capitalize(name)}`] = resolved;
			if (resource.prefetch !== false) {
				void refetch();
			}
		}
		const actions = plugin.getActions?.(ctx) ?? {};
		Object.assign(client, actions);
	}

	return client;
}

export type {
	ClientPlugin,
	ClientResult,
	CreateClientOptions,
	InferClientAPI,
	InferThrowDefault,
	InferThrowFromOptions,
};
