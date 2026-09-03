import { asType, type InferInput, validate } from "./schema";
import type {
	LiteralString,
	Members,
	Prettify,
	UnionToIntersection,
} from "./types";

/** Payload for each kind in an event-type map. */
export type EventPayloads<T> = {
	[K in keyof T]: InferInput<T[K]>;
};

/** Discriminated message handed to subscribers. */
export type EventMessage<T> = Prettify<
	{
		[K in keyof T]: { type: K; data: EventPayloads<T>[K] };
	}[keyof T]
>;

/** `next(mutate?)` continues the chain and optionally patches this publish's
 * payload. Skipping `next` stops the chain (veto), same idea as `v.on`. */
export type EventNext<D> = (mutate?: Partial<D>) => void | Promise<void>;

export type EventHandler<T> = (
	event: EventMessage<T>,
	next: EventNext<EventPayloads<T>[keyof T]>,
) => void | Promise<void>;

/**
 * A named event CATEGORY: several kinds under one namespace, each with a
 * payload schema. Distinct from a fn lifecycle (`v.on(fn)` listens to one
 * key) - subscribers here hear every kind the category declares, and modules
 * can widen the kind map by name the same way `v.extend` widens vars.
 */
export interface EventDefination<
	N extends LiteralString,
	T extends Record<string, unknown> = Record<string, never>,
> {
	$event: true;
	name: N;
	types: T;
	/**
	 * Register a listener on this bus. Returns unsubscribe. Always-on -
	 * does not need a module mount.
	 */
	subscribe: (handler: EventHandler<T>) => () => void;
	/**
	 * Validate `data` against the kind's schema, run subscribers (direct +
	 * any mounted via `v.on` / modules), merge `next` mutations, return the
	 * final payload.
	 */
	publish: <K extends keyof T & string>(
		type: K,
		data: EventPayloads<T>[K],
	) => EventPayloads<T>[K] | Promise<EventPayloads<T>[K]>;
	/**
	 * Mint a NEW event def under the same name with more kinds - the
	 * re-export pattern (`customize` for vars). Shared bus; widened types.
	 */
	extend: <E extends Record<string, unknown>>(
		types: E,
	) => EventDefination<N, Prettify<T & E>>;
}

/**
 * Mountable kind-map widening. Where {@link EventDefination.extend} mints a
 * re-export, an extension is a module member: every scope that `use`s it
 * sees the named event widened, and nothing that doesn't is affected.
 * Handed the event by REFERENCE, mounting just the extension also brings
 * the base event (same rule as `v.extend` on vars).
 */
export type EventExtension<
	N extends string,
	T extends Record<string, unknown>,
	BaseT extends Record<string, unknown> = Record<string, never>,
> = {
	$eventExtend: true;
	name: N;
	types: T;
	base?: EventDefination<N & LiteralString, BaseT>;
};

/**
 * A mountable listener on an event category. Distinct from fn/`var.*`
 * {@link OnEntry}: the handler sees `{ type, data }`, not a fn context.
 * Collected when a module that exports it is `use`d (identity-deduped).
 */
export type EventOnEntry<
	N extends string,
	T extends Record<string, unknown> = Record<string, unknown>,
> = {
	$eventOn: true;
	name: N;
	handler: EventHandler<T>;
};

export const isEvent = (
	value: unknown,
): value is EventDefination<LiteralString, Record<string, unknown>> =>
	typeof value === "object" &&
	value !== null &&
	(value as { $event?: unknown }).$event === true;

export const isEventExtension = (
	value: unknown,
): value is EventExtension<string, Record<string, unknown>> =>
	typeof value === "object" &&
	value !== null &&
	(value as { $eventExtend?: unknown }).$eventExtend === true;

export const isEventOn = (value: unknown): value is EventOnEntry<string> =>
	typeof value === "object" &&
	value !== null &&
	(value as { $eventOn?: unknown }).$eventOn === true;

type Bus = {
	types: Record<string, unknown>;
	/** Direct `.subscribe` listeners. */
	direct: Set<EventHandler<any>>;
	/** Module-mounted `v.on(event, …)` listeners - keyed by entry identity. */
	mounted: Set<EventHandler<any>>;
};

const eventRegistry = new Map<string, Bus>();

const getBus = (name: string): Bus => {
	let bus = eventRegistry.get(name);
	if (!bus) {
		bus = { types: {}, direct: new Set(), mounted: new Set() };
		eventRegistry.set(name, bus);
	}
	return bus;
};

const mergeTypes = (bus: Bus, types: Record<string, unknown> | undefined) => {
	if (!types) return;
	bus.types = { ...bus.types, ...types };
};

const isThenable = (value: unknown): value is Promise<unknown> =>
	typeof (value as { then?: unknown })?.then === "function";

const thenMaybe = <T, R>(
	value: T | Promise<T>,
	next: (value: T) => R | Promise<R>,
): R | Promise<R> => (isThenable(value) ? value.then(next) : next(value as T));

/**
 * Run handlers outermost-first (mount / subscribe order). Each may call
 * `next(mutate?)` to continue and patch the payload; skipping `next` vetoes.
 */
const runHandlers = (
	handlers: readonly EventHandler<any>[],
	type: string,
	initial: unknown,
): unknown | Promise<unknown> => {
	let current = initial;
	const run = (i: number): void | Promise<void> => {
		if (i >= handlers.length) return;
		let proceeded = false;
		const next = (mutate?: Partial<unknown>) => {
			proceeded = true;
			if (
				mutate !== undefined &&
				mutate !== null &&
				typeof mutate === "object"
			) {
				current = {
					...(current as Record<string, unknown>),
					...(mutate as Record<string, unknown>),
				};
			}
			return run(i + 1);
		};
		const handler = handlers[i];
		if (!handler) return;
		const result = handler({ type, data: current }, next);
		return thenMaybe(result, () => {
			if (!proceeded) return;
		});
	};
	return thenMaybe(run(0), () => current);
};

const publishOn = (
	name: string,
	type: string,
	data: unknown,
): unknown | Promise<unknown> => {
	const bus = getBus(name);
	const schema = bus.types[type];
	const path = `event.${name}.${type}`;
	if (schema === undefined) {
		throw new Error(`${path}: unknown event kind "${type}"`);
	}
	const handlers = [...bus.mounted, ...bus.direct];
	return thenMaybe(validate(asType(schema), data, path), (parsed) =>
		runHandlers(handlers, type, parsed),
	);
};

/** Register a module-mounted event listener (no-op if already present). */
export const mountEventOn = (entry: EventOnEntry<string>) => {
	getBus(entry.name).mounted.add(entry.handler);
};

/** Merge extension kinds onto the named bus (and ensure a bus exists). */
export const mountEventExtension = (
	ext: EventExtension<string, Record<string, unknown>>,
) => {
	const bus = getBus(ext.name);
	if (ext.base) mergeTypes(bus, ext.base.types as Record<string, unknown>);
	mergeTypes(bus, ext.types);
};

/** Ensure a declared event is on the bus (kinds merged by name). */
export const mountEvent = (
	event: EventDefination<LiteralString, Record<string, unknown>>,
) => {
	mergeTypes(getBus(event.name), event.types as Record<string, unknown>);
};

export const makeEvent = <
	N extends LiteralString,
	const T extends Record<string, unknown> = Record<string, never>,
>(
	name: N,
	types?: T,
): EventDefination<N, T> => {
	const bus = getBus(name);
	if (types) mergeTypes(bus, types as Record<string, unknown>);

	const def: EventDefination<N, T> = {
		$event: true,
		name,
		types: (types ?? {}) as T,
		subscribe: (handler) => {
			bus.direct.add(handler as EventHandler<any>);
			return () => {
				bus.direct.delete(handler as EventHandler<any>);
			};
		},
		publish: (type, data) => publishOn(name, type, data) as never,
		extend: (extra) =>
			makeEvent(name, {
				...(types ?? {}),
				...extra,
			}) as never,
	};
	return def;
};

export function extendEvent<
	N extends LiteralString,
	T extends Record<string, unknown>,
	const E extends Record<string, unknown>,
>(target: EventDefination<N, T>, types: E): EventExtension<N, E, T>;
export function extendEvent<
	N extends LiteralString,
	const E extends Record<string, unknown>,
>(target: N, types: E): EventExtension<N, E>;
export function extendEvent(
	target: EventDefination<string, Record<string, unknown>> | string,
	types: Record<string, unknown>,
): EventExtension<string, Record<string, unknown>, any> {
	return typeof target === "string"
		? { $eventExtend: true, name: target, types }
		: {
				$eventExtend: true,
				name: target.name,
				types,
				base: target as EventDefination<any, any>,
			};
}

/** Build a mountable event listener from an event ref or `event.<name>` key. */
export function onEvent<
	N extends LiteralString,
	T extends Record<string, unknown>,
>(target: EventDefination<N, T>, handler: EventHandler<T>): EventOnEntry<N, T>;
export function onEvent<N extends LiteralString>(
	target: `event.${N}`,
	handler: EventHandler<Record<string, unknown>>,
): EventOnEntry<N>;
export function onEvent(target: any, handler: any): EventOnEntry<string, any> {
	const name =
		typeof target === "string" ? target.slice("event.".length) : target.name;
	return { $eventOn: true, name, handler };
}

/* ----------------------------- module types ------------------------------ */

type EventTypesEntry<M> = {
	[K in keyof M]: M[K] extends EventDefination<infer N, infer T>
		? { [P in N]: EventPayloads<T> }
		: M[K] extends EventExtension<infer N, infer T, any>
			? { [P in N]: EventPayloads<T> }
			: never;
}[keyof M];

/**
 * Event payload maps a module exports, keyed by DECLARED event name. Same
 * name across modules intersects (kinds merge) - the var-extension rule.
 * Prefer {@link ModuleEvents} over a bare union of modules.
 */
export type EventsFrom<M> = M extends unknown
	? [EventTypesEntry<M>] extends [never]
		? never
		: UnionToIntersection<EventTypesEntry<M>>
	: never;

/** Events contributed by a `use` list - intersects same-name kind maps. */
export type ModuleEvents<PL> = UnionToIntersection<EventsFrom<Members<PL>>>;
