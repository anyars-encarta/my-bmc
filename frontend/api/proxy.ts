import type { IncomingMessage, ServerResponse } from "node:http";

type ProxyRequest = IncomingMessage & {
  body?: unknown;
  query?: Record<string, string | string[] | undefined>;
};

const allowedMethods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);
const excludedResponseHeaders = new Set([
  "connection",
  "content-encoding",
  "content-length",
  "set-cookie",
  "transfer-encoding",
]);

const sendJson = (response: ServerResponse, status: number, message: string) => {
  response.statusCode = status;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify({ error: message }));
};

export default async function handler(req: ProxyRequest, res: ServerResponse) {
  const method = req.method ?? "GET";
  if (!allowedMethods.has(method)) {
    res.setHeader("allow", [...allowedMethods].join(", "));
    return sendJson(res, 405, "Method not allowed.");
  }

  const requestUrl = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const queryPath = req.query?.path;
  const path = (Array.isArray(queryPath) ? queryPath.join("/") : queryPath) ??
    requestUrl.searchParams.get("path") ??
    "";
  if (!path || !/^[A-Za-z0-9/_-]+$/.test(path) || path.includes("..")) {
    return sendJson(res, 400, "Invalid API path.");
  }

  const backendUrlValue = process.env.BACKEND_URL ?? process.env.VITE_BACKEND_BASE_URL;
  if (!backendUrlValue) {
    console.error("API proxy is missing BACKEND_URL or VITE_BACKEND_BASE_URL.");
    return sendJson(res, 500, "Backend URL is not configured.");
  }

  try {
    const backendUrl = new URL(backendUrlValue);
    const backendBase = backendUrl.toString().replace(/\/+$/, "").replace(/\/api$/, "");
    const routePath = path === "public" || path.startsWith("public/")
      ? `/${path}`
      : `/api/${path}`;
    const targetUrl = new URL(`${backendBase}${routePath}`);
    for (const [key, value] of requestUrl.searchParams) {
      if (key !== "path") targetUrl.searchParams.append(key, value);
    }

    const headers = new Headers();
    for (const headerName of ["accept", "authorization", "content-type", "cookie", "user-agent"]) {
      const value = req.headers[headerName];
      if (typeof value === "string") headers.set(headerName, value);
    }

    let body: string | undefined;
    if (req.body !== undefined && !["GET", "HEAD"].includes(method)) {
      body = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    }

    const upstream = await fetch(targetUrl, { method, headers, body });
    upstream.headers.forEach((value, name) => {
      if (!excludedResponseHeaders.has(name.toLowerCase())) {
        res.setHeader(name, value);
      }
    });
    const setCookie = (upstream.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.();
    if (setCookie?.length) {
      res.setHeader("set-cookie", setCookie);
    } else {
      const cookie = upstream.headers.get("set-cookie");
      if (cookie) res.setHeader("set-cookie", cookie);
    }

    res.statusCode = upstream.status;
    res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    console.error("API proxy request failed:", error);
    sendJson(res, 502, "Backend request failed.");
  }
}
