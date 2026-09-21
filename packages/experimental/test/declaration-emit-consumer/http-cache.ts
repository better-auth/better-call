/**
 * Dependent-package fixture: export `http({…})` / `cache({…})` wrappers
 * through package subpath entries with no local return annotations.
 * Declaration emit under node16 + composite must name types only via
 * `better-call/http` and `better-call/cache` (TS2742 / TS2883).
 */
import { cache, memoryCache } from "better-call/cache";
import { http } from "better-call/http";

export const authHttp = http({
	cookieCache: {
		policies: {
			session: {},
		},
	},
});

export const authCache = cache({
	store: memoryCache(),
	defaults: {
		user: { ttl: 60 },
	},
});
