import { signCookieValue } from "./crypto";
import { tryDecode } from "./utils";

export type CookiePrefixOptions = "host" | "secure";

export type CookieOptions = {
	/**
	 * Domain of the cookie
	 *
	 * The Domain attribute specifies which server can receive a cookie. If specified, cookies are
	 * available on the specified server and its subdomains. If the it is not
	 * specified, the cookies are available on the server that sets it but not on
	 * its subdomains.
	 *
	 * @example
	 * `domain: "example.com"`
	 */
	domain?: string;
	/**
	 * A lifetime of a cookie. Permanent cookies are deleted after the date specified in the
	 * Expires attribute:
	 *
	 * Expires has been available for longer than Max-Age, however Max-Age is less error-prone, and
	 * takes precedence when both are set. The rationale behind this is that when you set an
	 * Expires date and time, they're relative to the client the cookie is being set on. If the
	 * server is set to a different time, this could cause errors
	 */
	expires?: Date;
	/**
	 * Forbids JavaScript from accessing the cookie, for example, through the Document.cookie
	 * property. Note that a cookie that has been created with HttpOnly will still be sent with
	 * JavaScript-initiated requests, for example, when calling XMLHttpRequest.send() or fetch().
	 * This mitigates attacks against cross-site scripting
	 */
	httpOnly?: boolean;
	/**
	 * Indicates the number of seconds until the cookie expires. A zero or negative number will
	 * expire the cookie immediately. If both Expires and Max-Age are set, Max-Age has precedence.
	 *
	 * @example 604800 - 7 days
	 */
	maxAge?: number;
	/**
	 * Indicates the path that must exist in the requested URL for the browser to send the Cookie
	 * header.
	 *
	 * @example
	 * "/docs"
	 * // -> the request paths /docs, /docs/, /docs/Web/, and /docs/Web/HTTP will all match. the request paths /, /fr/docs will not match.
	 */
	path?: string;
	/**
	 * Indicates that the cookie is sent to the server only when a request is made with the https:
	 * scheme (except on localhost), and therefore, is more resistant to man-in-the-middle attacks.
	 */
	secure?: boolean;
	/**
	 * Controls whether or not a cookie is sent with cross-site requests, providing some protection
	 * against cross-site request forgery attacks (CSRF).
	 *
	 * Strict -  Means that the browser sends the cookie only for same-site requests, that is,
	 * requests originating from the same site that set the cookie. If a request originates from a
	 * different domain or scheme (even with the same domain), no cookies with the SameSite=Strict
	 * attribute are sent.
	 *
	 * Lax - Means that the cookie is not sent on cross-site requests, such as on requests to load
	 * images or frames, but is sent when a user is navigating to the origin site from an external
	 * site (for example, when following a link). This is the default behavior if the SameSite
	 * attribute is not specified.
	 *
	 * None - Means that the browser sends the cookie with both cross-site and same-site requests.
	 * The Secure attribute must also be set when setting this value.
	 */
	sameSite?: "Strict" | "Lax" | "None" | "strict" | "lax" | "none";
	/**
	 * Indicates that the cookie should be stored using partitioned storage. Note that if this is
	 * set, the Secure directive must also be set.
	 *
	 * @see https://developer.mozilla.org/en-US/docs/Web/Privacy/Privacy_sandbox/Partitioned_cookies
	 */
	partitioned?: boolean;
	/**
	 * Cooke Prefix
	 *
	 * - secure: `__Secure-` -> `__Secure-cookie-name`
	 * - host: `__Host-` -> `__Host-cookie-name`
	 *
	 * `secure` must be set to true to use prefixes
	 */
	prefix?: CookiePrefixOptions;
};

export const getCookieKey = (key: string, prefix?: CookiePrefixOptions) => {
	let finalKey = key;
	if (prefix) {
		if (prefix === "secure") {
			finalKey = "__Secure-" + key;
		} else if (prefix === "host") {
			finalKey = "__Host-" + key;
		} else {
			return undefined;
		}
	}
	return finalKey;
};

/**
 * Parse an HTTP Cookie header string and returning an object of all cookie
 * name-value pairs.
 *
 * Inspired by https://github.com/unjs/cookie-es/blob/main/src/cookie/parse.ts
 *
 * @param str the string representing a `Cookie` header value
 */
export function parseCookies(str: string) {
	if (typeof str !== "string") {
		throw new TypeError("argument str must be a string");
	}

	const cookies: Map<string, string> = new Map();

	let index = 0;
	while (index < str.length) {
		const eqIdx = str.indexOf("=", index);

		if (eqIdx === -1) {
			break;
		}

		let endIdx = str.indexOf(";", index);

		if (endIdx === -1) {
			endIdx = str.length;
		} else if (endIdx < eqIdx) {
			index = str.lastIndexOf(";", eqIdx - 1) + 1;
			continue;
		}

		const key = str.slice(index, eqIdx).trim();
		if (!cookies.has(key)) {
			let val = str.slice(eqIdx + 1, endIdx).trim();
			if (val.codePointAt(0) === 0x22) {
				val = val.slice(1, -1);
			}
			cookies.set(key, tryDecode(val));
		}

		index = endIdx + 1;
	}

	return cookies;
}

const _serialize = (key: string, value: string, opt: CookieOptions = {}) => {
	let cookie: string;

	if (opt?.prefix === "secure") {
		cookie = `${`__Secure-${key}`}=${value}`;
	} else if (opt?.prefix === "host") {
		cookie = `${`__Host-${key}`}=${value}`;
	} else {
		cookie = `${key}=${value}`;
	}

	if (key.startsWith("__Secure-") && !opt.secure) {
		opt.secure = true;
	}

	if (key.startsWith("__Host-")) {
		if (!opt.secure) {
			opt.secure = true;
		}

		if (opt.path !== "/") {
			opt.path = "/";
		}

		if (opt.domain) {
			opt.domain = undefined;
		}
	}

	if (opt && typeof opt.maxAge === "number" && opt.maxAge >= 0) {
		if (opt.maxAge > 34560000) {
			throw new Error(
				"Cookies Max-Age SHOULD NOT be greater than 400 days (34560000 seconds) in duration.",
			);
		}
		cookie += `; Max-Age=${Math.floor(opt.maxAge)}`;
	}

	if (opt.domain && opt.prefix !== "host") {
		cookie += `; Domain=${opt.domain}`;
	}

	if (opt.path) {
		cookie += `; Path=${opt.path}`;
	}

	if (opt.expires) {
		if (opt.expires.getTime() - Date.now() > 34560000_000) {
			throw new Error(
				"Cookies Expires SHOULD NOT be greater than 400 days (34560000 seconds) in the future.",
			);
		}
		cookie += `; Expires=${opt.expires.toUTCString()}`;
	}

	if (opt.httpOnly) {
		cookie += "; HttpOnly";
	}

	if (opt.secure) {
		cookie += "; Secure";
	}

	if (opt.sameSite) {
		cookie += `; SameSite=${opt.sameSite.charAt(0).toUpperCase() + opt.sameSite.slice(1)}`;
	}

	if (opt.partitioned) {
		if (!opt.secure) {
			opt.secure = true;
		}
		cookie += "; Partitioned";
	}

	return cookie;
};

export const serializeCookie = (
	key: string,
	value: string,
	opt?: CookieOptions,
) => {
	value = encodeURIComponent(value);
	return _serialize(key, value, opt);
};

export const serializeSignedCookie = async (
	key: string,
	value: string,
	secret: string,
	opt?: CookieOptions,
) => {
	value = await signCookieValue(value, secret);
	return _serialize(key, value, opt);
};
