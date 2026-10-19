/** Small HTTP client for numeric loopback; avoid loading Undici/Web transport in every shim. */
import { Agent, request } from "node:http";
import type { IncomingMessage } from "node:http";

const agent = new Agent({ keepAlive: true, maxSockets: 4, maxFreeSockets: 2 });
export interface CentralHttpResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  body: IncomingMessage;
  text(): Promise<string>;
  json(): Promise<unknown>;
}
export async function centralHttpRequest(url: string | URL, options: {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
} = {}): Promise<CentralHttpResponse> {
  const response = await new Promise<IncomingMessage>((resolve, reject) => {
    const outgoing = request(url, { method: options.method ?? "GET", agent, signal: options.signal,
      headers: { ...options.headers, ...(options.body !== undefined ? { "content-length": String(Buffer.byteLength(options.body)) } : {}) }
    }, resolve);
    outgoing.once("error", reject);
    outgoing.end(options.body);
  });
  let reading: Promise<string> | undefined;
  const text = (): Promise<string> => {
    reading ??= (async () => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of response) {
        const buffer = Buffer.from(chunk as Uint8Array);
        bytes += buffer.byteLength;
        if (bytes > 4 * 1024 * 1024) { response.destroy(); throw new Error("central HTTP response exceeds frame budget"); }
        chunks.push(buffer);
      }
      return Buffer.concat(chunks).toString("utf8");
    })();
    return reading;
  };
  const status = response.statusCode ?? 0;
  return { status, ok: status >= 200 && status < 300, body: response,
    headers: { get(name) { const value = response.headers[name.toLowerCase()]; return Array.isArray(value) ? value.join(", ") : value ?? null; } },
    text, json: async () => JSON.parse(await text()) as unknown
  };
}
