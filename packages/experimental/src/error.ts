export type Issue = { path: string; message: string };

/** A contract violation - input, output, requires, provides. Carries
 * EVERY issue found in the pass that threw it, not just the first;
 * `message` lists them all. */
export class ValidationError extends Error {
	public path: string;
	public issues: Issue[];
	constructor(path: string, message: string, issues?: Issue[]) {
		const all = issues?.length ? issues : [{ path, message }];
		super(all.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
		this.name = "ValidationError";
		this.path = all[0].path;
		this.issues = all;
	}
}

/**
 * A DECLARED failure - a domain outcome, not a bug. Minted only by
 * `c.error(tag, data)`, so the payload is already validated against the
 * fn's `errors` schema. The `tag` is the discriminant callers narrow on;
 * `trail` records the fn that threw, then every frame it crossed.
 * Serializes as data, so it survives a remote boundary intact.
 */
export class FnError<
	Tag extends string = string,
	Data = unknown,
> extends Error {
	public trail: string[];
	constructor(
		public tag: Tag,
		public data: Data,
		fn: string,
	) {
		super(`${fn}: ${tag}`);
		this.name = "FnError";
		this.trail = [fn];
	}
	toJSON() {
		return {
			name: this.name,
			tag: this.tag,
			data: this.data,
			trail: this.trail,
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
}
