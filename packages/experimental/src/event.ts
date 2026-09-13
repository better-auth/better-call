import { ValidationError } from "./error";
import {
	asType,
	type InferArgs,
	type InferInput,
	isFnSchema,
	isNoInput,
	isNoOutput,
	isType,
	isVar,
	projectValue,
	rejectFields,
	type SchemaInputOf,
	type SchemaOutputOf,
	toInputSchema,
	toOutputSchema,
	validate,
} from "./schema";
import type {
	LiteralString,
	Members,
	Prettify,
	UnionToIntersection,
} from "./types";

/**
 * Explicit publish/complete doors for one kind. Only `input` / `output`
 * keys - anything else is a bare object shape (e.g. `{ account }`).
 * Either side may be omitted; the other stands in for both.
 */
export type EventKindIO<I = unknown, O = unknown> = {
	input?: I;
	output?: O;
};

/**
 * True when `S` is `{ input?, output? }` rather than a schema / shape.
 * Vars, type defs, and fn schemas are never IO wrappers; a plain object
 * whose keys are only `input` / `output` is.
 */
export type IsEventKindIO<S> = S extends { $var: true }
	? false
	: S extends { $fnSchema: unknown }
		? false
		: S extends { name: string }
			? // Type defs (and vars, already excluded) expose `name`.
				false
			: S extends EventKindIO
				? Exclude<keyof S, "input" | "output"> extends never
					? true
					: false
				: false;

/** Schema used at the publish door for kind `S`. */
export type EventKindInputOf<S> =
	IsEventKindIO<S> extends true
		? S extends { input: infer I }
			? I
			: S extends { output: infer O }
				? O
				: unknown
		: S;

/** Schema used at the complete door for kind `S`. */
export type EventKindOutputOf<S> =
	IsEventKindIO<S> extends true
		? S extends { output: infer O }
			? O
			: S extends { input: infer I }
				? I
				: unknown
		: S;

/** Handler-visible payload for one kind (full schemas, not projected). */
export type EventKindPayloadOf<S> =
	IsEventKindIO<S> extends true
		? S extends { input: infer I; output: infer O }
			? Prettify<InferInput<I> & InferInput<O>>
			: S extends { input: infer I }
				? InferInput<I>
				: S extends { output: infer O }
					? InferInput<O>
					: unknown
		: InferInput<S>;

/** Handler-visible payload (full schema, including noInput / noOutput). */
export type EventPayloads<T> = {
	[K in keyof T]: EventKindPayloadOf<T[K]>;
};

/** What {@link EventDefination.publish} accepts - the `.input` view. */
export type EventPublishArgs<T> = {
	[K in keyof T]: InferArgs<SchemaInputOf<EventKindInputOf<T[K]>>>;
};

/** Validated publish-time payload - parsed `.input` view. */
export type EventPublishResult<T> = {
	[K in keyof T]: InferInput<SchemaInputOf<EventKindInputOf<T[K]>>>;
};

/** What `complete()` resolves to - the `.output` view. */
export type EventCompleteResult<T> = {
	[K in keyof T]: InferInput<SchemaOutputOf<EventKindOutputOf<T[K]>>>;
};

/** Discriminated message handed to subscribers. */
export type EventMessage<T> = Prettify<
	{
		[K in keyof T]: { type: K; data: EventPayloads<T>[K] };
	}[keyof T]
>;

/** `next(mutate?)` continues the chain and optionally patches this publish's
 * payload. Skipping `next` stops the chain (veto), same idea as `v.on`. */
export type EventNext<D> = (mutate?: Partial<D>) => D | Promise<D>;

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
	 * Validate `data` against the kind's `.input` view, run subscribers
	 * (direct + any mounted via `v.on` / modules), merge `next` mutations,
	 * and return:
	 * - `result`: the validated `.input` payload at publish-time
	 * - `complete`: a promise function resolving to the `.output` payload
	 *   after the full subscriber chain finishes
	 */
	publish: <K extends keyof T & string>(
		type: K,
		data: EventPublishArgs<T>[K],
	) =>
		| [EventPublishResult<T>[K], () => Promise<EventCompleteResult<T>[K]>]
		| Promise<
				[EventPublishResult<T>[K], () => Promise<EventCompleteResult<T>[K]>]
		  >;
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
 * Validate only the keys in `patch` against an object shape, then merge onto
 * `current`. Avoids re-running transforms on unchanged fields (full-object
 * re-validate would). Non-object schemas fall back to validating the merge.
 */
const applyPatch = (
	schema: unknown,
	current: unknown,
	patch: Record<string, unknown>,
	path: string,
): unknown | Promise<unknown> => {
	const def = asType(schema);
	const shape = def.shape as Record<string, unknown> | undefined;
	if (def.name !== "object" || shape === undefined) {
		return validate(
			def,
			{ ...(current as Record<string, unknown>), ...patch },
			path,
		);
	}
	const keys = Object.keys(patch);
	for (const key of keys) {
		if (!(key in shape)) {
			throw new ValidationError(`${path}.${key}`, `unexpected key "${key}"`);
		}
	}
	const walk = (
		index: number,
		acc: Record<string, unknown>,
	): Record<string, unknown> | Promise<Record<string, unknown>> => {
		if (index >= keys.length) {
			return { ...(current as Record<string, unknown>), ...acc };
		}
		const key = keys[index] as string;
		return thenMaybe(
			validate(asType(shape[key]), patch[key], `${path}.${key}`),
			(parsed) => walk(index + 1, { ...acc, [key]: parsed }),
		);
	};
	return walk(0, {});
};

/**
 * Run handlers outermost-first (mount / subscribe order). Each may call
 * `next(mutate?)` to continue and patch the payload; skipping `next` vetoes.
 * Patches validate only the touched fields. Calling `next` without awaiting
 * it still keeps the downstream chain attached to `publish`.
 */
const runHandlers = (
	handlers: readonly EventHandler<any>[],
	type: string,
	initial: unknown,
	schema: unknown,
	path: string,
): unknown | Promise<unknown> => {
	const run = (i: number, current: unknown): unknown | Promise<unknown> => {
		if (i >= handlers.length) return current;
		let called = false;
		let downstream: unknown | Promise<unknown> = current;
		const next = (mutate?: Partial<unknown>) => {
			called = true;
			const continueChain = (value: unknown) => run(i + 1, value);
			if (
				mutate !== undefined &&
				mutate !== null &&
				typeof mutate === "object"
			) {
				downstream = thenMaybe(
					applyPatch(schema, current, mutate as Record<string, unknown>, path),
					continueChain,
				);
				return downstream;
			}
			downstream = continueChain(current);
			return downstream;
		};
		const handler = handlers[i];
		if (!handler) return current;
		const result = handler({ type, data: current }, next);
		return thenMaybe(result, () => {
			if (!called) return current;
			return downstream;
		});
	};
	return run(0, initial);
};

/** Runtime check for {@link EventKindIO} - not a var / type / fn schema. */
export const isEventKindIO = (
	value: unknown,
): value is { input?: unknown; output?: unknown } => {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		return false;
	}
	if (isVar(value) || isFnSchema(value) || isType(value)) return false;
	const keys = Object.keys(value as object);
	return (
		keys.length > 0 && keys.every((key) => key === "input" || key === "output")
	);
};

type ResolvedKind = {
	inputSchema: unknown;
	outputSchema: unknown;
	patchSchema: unknown;
	/** Distinct custom output schema - complete validates against it. */
	customOutput: boolean;
};

/** Merge object shapes so `next` patches can touch fields from either door. */
const mergePatchSchemas = (a: unknown, b: unknown): unknown => {
	if (b === undefined || a === b) return a;
	if (a === undefined) return b;
	const da = asType(a);
	const db = asType(b);
	if (
		da.name === "object" &&
		db.name === "object" &&
		da.shape !== undefined &&
		db.shape !== undefined
	) {
		return {
			name: "object" as const,
			shape: {
				...(da.shape as Record<string, unknown>),
				...(db.shape as Record<string, unknown>),
			},
		};
	}
	return a;
};

/** Resolve a kind to publish / patch / complete schemas. */
const resolveKind = (schema: unknown): ResolvedKind => {
	if (isEventKindIO(schema)) {
		const inputSchema = schema.input ?? schema.output;
		const outputSchema = schema.output ?? schema.input;
		return {
			inputSchema,
			outputSchema,
			patchSchema: mergePatchSchemas(inputSchema, outputSchema),
			customOutput:
				schema.input !== undefined &&
				schema.output !== undefined &&
				schema.input !== schema.output,
		};
	}
	return {
		inputSchema: schema,
		outputSchema: schema,
		patchSchema: schema,
		customOutput: false,
	};
};

/** A var extension's extra fields, applied to event payloads that infer
 * from that var when publishing inside a mounted scope. */
export type EventVarExt = { name: string; schema: unknown };

/** Fold mounted `v.extend` / same-name customize schemas onto a payload
 * schema that references those vars - whole-var kinds and var fields. */
const applyVarExtsToSchema = (
	schema: unknown,
	exts: readonly EventVarExt[],
): unknown => {
	if (exts.length === 0) return schema;
	if (isEventKindIO(schema)) {
		const input =
			schema.input !== undefined
				? applyVarExtsToSchema(schema.input, exts)
				: undefined;
		const output =
			schema.output !== undefined
				? applyVarExtsToSchema(schema.output, exts)
				: undefined;
		if (input === schema.input && output === schema.output) return schema;
		return {
			...(input !== undefined ? { input } : {}),
			...(output !== undefined ? { output } : {}),
		};
	}
	if (isVar(schema)) {
		const name = (schema as { name: string }).name;
		const inner = (schema as { schema?: unknown }).schema ?? {};
		return mergeVarExtShapes(applyVarExtsToSchema(inner, exts), name, exts);
	}
	const def = asType(schema);
	if (def.name !== "object" || def.shape === undefined) return schema;
	const shape = def.shape as Record<string, unknown>;
	const next: Record<string, unknown> = {};
	let changed = false;
	for (const [key, field] of Object.entries(shape)) {
		const rewritten = applyVarExtsToSchema(field, exts);
		next[key] = rewritten;
		if (rewritten !== field) changed = true;
	}
	return changed ? { ...def, shape: next } : schema;
};

const mergeVarExtShapes = (
	schema: unknown,
	varName: string,
	exts: readonly EventVarExt[],
) => {
	const matches = exts.filter((ext) => ext.name === varName);
	if (matches.length === 0) return schema;
	const def = asType(schema);
	const shape: Record<string, unknown> =
		def.name === "object" && def.shape !== undefined
			? { ...(def.shape as Record<string, unknown>) }
			: {};
	for (const ext of matches) {
		const extra = asType(ext.schema);
		if (extra.name === "object" && extra.shape !== undefined) {
			Object.assign(shape, extra.shape);
		}
	}
	return {
		...(def.name === "object" ? def : { name: "object" as const }),
		shape,
	};
};

const publishOn = (
	name: string,
	type: string,
	data: unknown,
	varExts: readonly EventVarExt[] = [],
):
	| [unknown, () => Promise<unknown>]
	| Promise<[unknown, () => Promise<unknown>]> => {
	const bus = getBus(name);
	const schema = bus.types[type];
	const path = `event.${name}.${type}`;
	if (schema === undefined) {
		throw new Error(`${path}: unknown event kind "${type}"`);
	}
	const effective = applyVarExtsToSchema(schema, varExts);
	const doors = resolveKind(effective);
	const handlers = [...bus.mounted, ...bus.direct];
	// Publish door matches v.fn input: reject smuggled noInput keys, then
	// validate the `.input` view. Handlers patch against the resolved
	// patch schema (full schema, or input∪output when doors differ).
	const parseInput = () =>
		thenMaybe(
			rejectFields(
				doors.inputSchema,
				data,
				isNoInput,
				path,
				"noInput field is not allowed",
			),
			() => validate(asType(toInputSchema(doors.inputSchema)), data, path),
		);
	return thenMaybe(parseInput(), (parsed) => {
		const done = runHandlers(handlers, type, parsed, doors.patchSchema, path);
		return [
			parsed,
			() =>
				Promise.resolve(
					thenMaybe(done, (final) =>
						doors.customOutput
							? validate(
									asType(toOutputSchema(doors.outputSchema)),
									final,
									path,
								)
							: projectValue(doors.outputSchema, final, isNoOutput),
					),
				),
		] as [unknown, () => Promise<unknown>];
	});
};

/** Publish against a named bus, folding mounted var extensions into
 * kinds whose payload infers from those vars. Used by a fn context so
 * `c.bus.publish` matches the same `v.extend` / customize the handler
 * already sees on `c.input`. */
export const publishEvent = (
	name: string,
	type: string,
	data: unknown,
	varExts: readonly EventVarExt[] = [],
):
	| [unknown, () => Promise<unknown>]
	| Promise<[unknown, () => Promise<unknown>]> =>
	publishOn(name, type, data, varExts);

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
