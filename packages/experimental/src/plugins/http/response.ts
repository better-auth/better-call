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

/** `Response`'s own parameter types - not the DOM lib's `BodyInit` /
 * `ResponseInit` names, which a consumer without `lib: ["dom"]` lacks. */
export type ResponseBody = ConstructorParameters<typeof Response>[0];
type ResponseInitOf = NonNullable<ConstructorParameters<typeof Response>[1]>;

/** Build a fetch {@link Response} from the scope's response state. */
export const toResponse = (
	response: HttpResponse,
	body: ResponseBody = null,
): Response =>
	new Response(body, {
		status: response.status ?? 200,
		statusText: response.statusText,
		headers: response.headers,
		// `statusText` may be undefined - the same as absent for Response,
		// but not to exactOptionalPropertyTypes.
	} as ResponseInitOf);
