import type { PublicFn } from "./fn";

export type Issue = {
	path: string;
	message: string;
	/** Truncated, JSON-safe preview of the bad value. */
	received?: string;
};

/**
 * Rewrite `error.stack` so it starts at the caller of `boundary`, hiding
 * frames inside that boundary (schema assemble, fn internals, …). No-op
 * when `Error.captureStackTrace` is unavailable.
 */
export const captureCallerStack = <E extends Error>(
	error: E,
	boundary: (...args: never[]) => unknown,
): E => {
	const capture = (
		Error as ErrorConstructor & {
			captureStackTrace?: (
				target: object,
				constructorOpt?: (...args: never[]) => unknown,
			) => void;
		}
	).captureStackTrace;
	if (typeof capture === "function") {
		capture(error, boundary);
	}
	scrubLibraryFrames(error);
	return error;
};

/** Drop frames that live inside better-call so the first useful frame is
 * the caller's code (the `c.error(...)` / `fn(...)` / `db.create(...)` line). */
const scrubLibraryFrames = (error: Error) => {
	const stack = error.stack;
	if (!stack) return;
	const lines = stack.split("\n");
	const head = lines[0];
	if (head === undefined) return;
	const frames = lines.slice(1).filter((line) => !isLibraryFrame(line));
	error.stack = frames.length > 0 ? [head, ...frames].join("\n") : head;
};

const isLibraryFrame = (line: string) =>
	/node_modules[/\\]\.bun[/\\]better-call@/.test(line) ||
	/node_modules[/\\]better-call[/\\]/.test(line) ||
	// Local package sources only - keep this package's own `*.test.*` frames
	/[/\\]packages[/\\]experimental[/\\](?:src|dist)[/\\](?!.*\.test\.)/.test(
		line,
	);

/** A contract violation - input, output, requires, provides. Carries
 * EVERY issue found in the pass that threw it, not just the first;
 * `message` lists them all. */
export class ValidationError extends Error {
	public path: string;
	public issues: Issue[];
	constructor(
		path: string,
		message: string,
		issues?: Issue[],
		options?: ErrorOptions,
	) {
		const all = issues?.length ? issues : [{ path, message }];
		super(
			all.map((issue) => `${issue.path}: ${issue.message}`).join("; "),
			options,
		);
		this.name = "ValidationError";
		this.path = all[0]?.path ?? path;
		this.issues = all;
		scrubLibraryFrames(this);
	}
	toJSON() {
		return {
			name: this.name,
			message: this.message,
			path: this.path,
			issues: this.issues,
		};
	}
}

/**
 * A DECLARED failure - a domain outcome, not a bug. Minted only by
 * `c.error(tag, data)`, so the payload is already validated against the
 * fn's `errors` schema. The `tag` is the discriminant callers narrow on;
 * `trail` records the fn that threw, then every frame it crossed.
 * Serializes as data, so it survives a remote boundary intact.
 * Optional `status` is set when the declaration carried HTTP metadata
 * (`http.err`); the declared human message becomes `Error.message` and
 * `toJSON().message` so the edge can rewrite it for i18n.
 */
export class FnError<
	Tag extends string = string,
	Data = unknown,
> extends Error {
	public trail: string[];
	public status?: number;
	/** True when `message` came from `http.err` (vs the `${fn}: ${tag}` fallback). */
	readonly #declaredMessage: boolean;
	constructor(
		public tag: Tag,
		public data: Data,
		fn: string,
		status?: number,
		message?: string,
	) {
		super(message ?? `${fn}: ${tag}`);
		this.name = "FnError";
		this.trail = [fn];
		this.#declaredMessage = message !== undefined;
		if (status !== undefined) this.status = status;
		scrubLibraryFrames(this);
	}
	toJSON() {
		return {
			name: this.name,
			tag: this.tag as Tag,
			data: this.data,
			trail: this.trail,
			...(this.status !== undefined ? { status: this.status } : {}),
			...(this.#declaredMessage ? { message: this.message } : {}),
		};
	}
}

/**
 * A failure the fn did NOT declare - a defect. Only minted once a fn
 * opts into `errors`: from then on, anything untagged escaping its body
 * comes out wrapped, so callers can tell a domain refusal (`FnError`)
 * from a bug without string matching. The original throw rides on
 * `cause`, untouched.
 */
export class UnexpectedError extends Error {
	public trail: string[];
	constructor(cause: unknown, fn: string) {
		super(
			`${fn}: unexpected - ${cause instanceof Error ? cause.message : String(cause)}`,
			{ cause },
		);
		this.name = "UnexpectedError";
		this.trail = [fn];
		scrubLibraryFrames(this);
	}
	toJSON() {
		const cause = this.cause;
		return {
			name: this.name,
			message: this.message,
			trail: this.trail,
			...(cause instanceof Error
				? { cause: { name: cause.name, message: cause.message } }
				: cause !== undefined
					? { cause: { message: String(cause) } }
					: {}),
		};
	}
}

/** Plugin/transport control that is neither a domain refusal nor a defect.
 * Frames with declared `errors` must not wrap these as UnexpectedError. */
export class ControlFlow extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ControlFlow";
	}
}

type ErrorsOf<F extends PublicFn<any, any, any, any, any, any, any>> =
	// `PublicFn` carries the declared error map in its `Er` type parameter.
	// Inferring from the generic is cheaper/steadier than pattern-matching the
	// optional `$schema` object, and avoids declaration-size blowups.
	F extends PublicFn<any, any, any, any, any, infer Er, any> ? Er : never;

export const getErrors = <
	F extends PublicFn<any, any, any, any, any, any, any>,
>(
	fn: F,
): ErrorsOf<F> | undefined => fn.$schema?.errors;
