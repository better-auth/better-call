import type { IncomingMessage, ServerResponse } from "node:http";

import { getRequest, setResponse } from "./request";
import type { Router } from "../../router.js";

export function toNodeHandler(handler: Router["handler"]) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const forwarded = req.headers["x-forwarded-proto"];
    // THERE IS A CASE WHERE FORWARDED IS AN ARRAY, OR A COMMA SEPARATED LIST
    // IF IT'S AN ARRAY I CHECK FOR HTTPS IN IT
    const protocol = forwarded
      ? Array.isArray(forwarded)
        ? forwarded.includes("https")
          ? "https"
          : "http"
        : (()=>{
          const parts = forwarded.split(",")
          return parts.includes("https") ? "https" : parts[0].trim() // The header can also be a string with coma so I just split it manually
        })() 
      : (req.socket as any).encrypted
        ? "https"
        : "http";

    const base = `${protocol}://${
      req.headers[":authority"] || req.headers.host
    }`;
    const response = await handler(getRequest({ base, request: req }));
    return setResponse(res, response);
  };
}

export { getRequest, setResponse };
