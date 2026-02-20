import type { IncomingMessage, ServerResponse } from "node:http";
import type { Router } from "../../router.js";
import { getRequest, setResponse } from "./request";

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
