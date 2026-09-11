import { useCallback, useRef, useSyncExternalStore } from "react";
import { createClient as createVanillaClient } from "./create-client";
import type { StoreSnapshot } from "./store";
import type {
	ClientPlugin,
	CreateClientOptions,
	InferClientAPI,
	InferThrowFromOptions,
	ResolvedResource,
} from "./types";

type ReactResourceHook<T> = () => StoreSnapshot<T> & {
	refetch: () => Promise<void>;
};

function bindResourceHook<T>(
	resource: ResolvedResource<T>,
): ReactResourceHook<T> {
	return () => {
		const resourceRef = useRef(resource);
		resourceRef.current = resource;
		const get = useCallback(() => resourceRef.current.get(), []);
		const subscribe = useCallback(
			(onStoreChange: () => void) =>
				resourceRef.current.subscribe(onStoreChange),
			[],
		);
		const snapshot = useSyncExternalStore(subscribe, get, get);
		return {
			...snapshot,
			refetch: () => resourceRef.current.refetch(),
		};
	};
}

/**
 * Same as the vanilla client, but resource accessors (`useSession`, …)
 * are React hooks via `useSyncExternalStore`.
 */
export function createClient<const O extends CreateClientOptions<any>>(
	options: O,
): InferClientAPI<O["routes"], InferThrowFromOptions<O>> & {
	$fetch: ReturnType<typeof createVanillaClient>["$fetch"];
	$store: ReturnType<typeof createVanillaClient>["$store"];
	plugins: ClientPlugin[];
} & Record<string, unknown> {
	const client = createVanillaClient(options);
	for (const [name, resource] of Object.entries(client.$store.resources)) {
		const hookName = `use${name.charAt(0).toUpperCase()}${name.slice(1)}`;
		(client as Record<string, unknown>)[hookName] = bindResourceHook(resource);
	}
	return client as InferClientAPI<O["routes"], InferThrowFromOptions<O>> & {
		$fetch: typeof client.$fetch;
		$store: typeof client.$store;
		plugins: ClientPlugin[];
	} & Record<string, unknown>;
}

export type {
	ClientPlugin,
	CreateClientOptions,
	InferClientAPI,
	InferThrowDefault,
	InferThrowFromOptions,
} from "./types";

export function useStore<T>(
	resource: ResolvedResource<T>,
): StoreSnapshot<T> & { refetch: () => Promise<void> } {
	const resourceRef = useRef(resource);
	resourceRef.current = resource;
	const subscribe = useCallback(
		(onChange: () => void) => resourceRef.current.subscribe(onChange),
		[],
	);
	const get = useCallback(() => resourceRef.current.get(), []);
	const snapshot = useSyncExternalStore(subscribe, get, get);
	return { ...snapshot, refetch: () => resourceRef.current.refetch() };
}
