import { v } from "../../index";

/** The response side, as ONE value. `headers` and `status` are meant to
 * be MUTATED in place (`res.headers.set(...)`, `res.status = 201`) - the
 * object is shared with whoever builds the final Response, so in-place
 * writes are exactly what travels back. */
export type HttpResponse = {
	headers: Headers;
	/** Steers the answering Response's status - assign it in place. */
	status?: number;
	statusText?: string;
};

export const res = v.var("res", { default: null as HttpResponse | null });
