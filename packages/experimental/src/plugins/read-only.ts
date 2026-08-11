import { ValidationError, v } from "../index";

/**
 * Mount via `use: [readOnly]` and this fn - plus EVERYTHING it calls,
 * any depth, interceptors included - cannot write vars: every set throws,
 * naming the offender. Nothing here is privileged: var writes are events,
 * and this module is one `v.on` listener.
 *
 * Pairs with the `readonly: true` fn option, which adds the TYPE half
 * (vars readonly on `c`, declared writers uncallable).
 */
export const readOnly = {
	_readOnly: v.on("var.set.*", (c) => {
		throw new ValidationError(
			`${c.fn}.readonly`,
			`readonly scope: attempted to set var "${c.name}"`,
		);
	}),
};
