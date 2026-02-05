import type { IncomingMessage, ServerResponse } from "node:http";

import { getRequest, setResponse } from "./request";
import type { Router } from "../../router.js";

export function toNodeHandler(handler: Router["handler"]) {
	return async (req: IncomingMessage, res: ServerResponse) => {
		const protocol =
			req.headers["x-forwarded-proto"] ||
			((req.socket as any).encrypted ? "https" : "http");
		const base = `${protocol}://${req.headers[":authority"] || req.headers.host}`;
		const response = await handler(getRequest({ base, request: req }));
		return setResponse(res, response);
	};
}

export { getRequest, setResponse };
