import type { HttpRequest, HttpResponse, HttpStack } from "tus-js-client";
import { authFetch } from "./auth.ts";
import { tusURL } from "./filesProtocol.ts";

/** fetch rejects redirects; XHR's automatic redirect behavior cannot enforce this boundary. */
export class TusHttp implements HttpStack {
  private base: string;
  constructor(base: string) { this.base = base; }
  getName() { return "mob-fetch"; }
  createRequest(method: string, url: string): HttpRequest {
    const target = tusURL(this.base, url, method === "POST");
    const headers = new Headers();
    const controller = new AbortController();
    return {
      getMethod: () => method,
      getURL: () => target,
      setHeader: (key, value) => headers.set(key, value),
      getHeader: (key) => headers.get(key) ?? undefined,
      setProgressHandler: () => {}, // Progress is the server-acknowledged chunk offset.
      getUnderlyingObject: () => controller,
      abort: async () => controller.abort(),
      send: async (body): Promise<HttpResponse> => {
        const response = await authFetch(this.base, target, { method, headers, body, signal: controller.signal });
        const text = await response.text();
        return {
          getStatus: () => response.status,
          getHeader: (key) => response.headers.get(key) ?? undefined,
          getBody: () => text,
          getUnderlyingObject: () => response,
        };
      },
    };
  }
}
