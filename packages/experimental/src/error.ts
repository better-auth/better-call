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
	return error;
};

/** Drop frames that live inside better-call so the first useful frame is
 * the caller's code (the `fn(...)` / `db.create(...)` line). */
const scrubLibraryFrames = (error: Error) => {
	const stack = error.stack;
	if (!stack) return;
	const lines = stack.split("\n");
	const head = lines[0];
	if (head === undefined) return;
	const frames = lines.slice(1).filter((line) => !isLibraryFrame(line));
	if (frames.length === 0) return;
	error.stack = [head, ...frames].join("\n");
};

const isLibraryFrame = (line: string) =>
	/node_modules[/\\]\.bun[/\\]better-call@/.test(line) ||
	/node_modules[/\\]better-call[/\\]/.test(line) ||
	/[/\\]packages[/\\]experimental[/\\](?:src|dist)[/\\]/.test(line);

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
 * (`http.err`); the edge uses it without looking the map back up.
 */
export class FnError<
	Tag extends string = string,
	Data = unknown,
> extends Error {
	public trail: string[];
	public status?: number;
	constructor(
		public tag: Tag,
		public data: Data,
		fn: string,
		status?: number,
	) {
		super(`${fn}: ${tag}`);
		this.name = "FnError";
		this.trail = [fn];
		if (status !== undefined) this.status = status;
	}
	toJSON() {
		return {
			name: this.name,
			tag: this.tag as Tag,
			data: this.data,
			trail: this.trail,
			...(this.status !== undefined ? { status: this.status } : {}),
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
