import {
	type InferArgs,
	type InferInput,
	type SchemaInputOf,
	type TypeDefination,
	vTypes as v,
} from "./schema";
import { makeVar, type VarDefination } from "./var";

/**
 * Brand an extended `fnOutput` field as a builder method. Declare with
 * {@link fnOut}; the builder binds it onto {@link import("./fn").Instance}
 * so `CtxBound` args receive that builder's handler context (and any
 * `use` on the call).
 *
 * `A` is a tuple — one element per call parameter
 * (`fnOut<[Opts, Cb], Ret>(…)` → `(opts, cb) => …`).
 */
export type FnOutMethod<A extends readonly unknown[], R = void> = {
	readonly $fnOut: { args: A; ret: R };
};

/** Runtime impl stashed on a {@link fnOut} field. */
export type FnOutImpl = (...args: any[]) => any;

export type FnOutField<A extends readonly unknown[], R> = TypeDefination<
	FnOutMethod<A, R>,
	FnOutMethod<A, R>
> & {
	readonly $fnOutImpl: FnOutImpl;
};

/**
 * Declare a builder method unlocked by `v.extend(fnOutput, { … })`.
 * `A` is a tuple of call parameters; `impl` runs when the method is
 * called on an {@link import("./fn").Instance}.
 */
export const fnOut = <A extends readonly unknown[], R = void>(
	impl: FnOutImpl,
): FnOutField<A, R> =>
	Object.assign(v.any<FnOutMethod<A, R>>(), {
		$fnOutImpl: impl,
	}) as FnOutField<A, R>;

export const isFnOutField = (value: unknown): value is FnOutField<any, any> =>
	typeof value === "object" &&
	value !== null &&
	typeof (value as { $fnOutImpl?: unknown }).$fnOutImpl === "function";

/**
 * Core empty `fnOutput` schema — plugins unlock methods via
 * `v.extend(fnOutput, { grant: fnOut(…) })`.
 */
export const fnOutputSchema = v.object({});

/**
 * Built-in output var. Plugins `v.extend` this and mount the extension
 * via `use` so those methods appear on descendant builder instances.
 *
 * Typed explicitly: `makeVar` returns `any`, and an untyped `fnOutput`
 * would make every `v.extend(fnOutput, …)` match *all* var names in
 * {@link import("./module").VarExtensionsFor}.
 */
export const fnOutput = makeVar("fnOutput", {
	default: {},
	schema: fnOutputSchema,
}) as VarDefination<
	"fnOutput",
	InferInput<typeof fnOutputSchema>,
	typeof fnOutputSchema
>;

/** Args side of mounted `fnOutput` extensions (unused at call sites; kept for symmetry). */
export type FnOutputInferred = InferArgs<SchemaInputOf<typeof fnOutputSchema>>;
