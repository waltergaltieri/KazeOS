import {
  cancelResponseBody,
  fetchOperatorUrl,
  type FetchLike,
  type HostnameResolver,
  SafeUrlError,
  validateOperatorUrl,
  validatePublicUrl,
} from "../safe-url";
import type {
  JsonValue,
  SearchPlanWorkItem,
  SourceAdapter,
  SourceCandidate,
  SourceQueryWorkItem,
} from "./contracts";
import { SourceUnavailableError } from "./contracts";

export { SourceUnavailableError } from "./contracts";

export class SearxngRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SearxngRequestError";
  }
}

export interface SearxngAdapterOptions {
  endpoint?: string;
  fetch?: FetchLike;
  resolve?: HostnameResolver;
  timeoutMs?: number;
  maxRedirects?: number;
  maxResponseBytes?: number;
  maxResults?: number;
  maxCandidates?: number;
}

function pageFromCursor(work: SourceQueryWorkItem): number {
  if (work.cursor.state === "initial") return 1;
  const value = work.cursor.value;

  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string") {
    const match = /^(?:page:)?([1-9]\d*)$/.exec(value);
    if (match) {
      const page = Number(match[1]);
      if (Number.isSafeInteger(page) && page > 0) return page;
    }
  }
  if (
    value
    && typeof value === "object"
    && !Array.isArray(value)
    && Number.isSafeInteger(value.page)
    && Number(value.page) > 0
  ) {
    return Number(value.page);
  }

  throw new TypeError("SearXNG cursor must contain a positive safe page number");
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer`);
  }
  return value;
}

function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): void {
  try {
    void reader.cancel().catch(() => undefined);
  } catch {
    // Best-effort cancellation must not replace the request error.
  }
}

async function readBoundedJson(
  response: Response,
  maxBytes: number,
  deadline: Promise<never>,
): Promise<unknown> {
  const contentLength = response.headers.get("content-length");
  if (contentLength && /^\d+$/.test(contentLength)) {
    const declaredBytes = Number(contentLength);
    if (!Number.isSafeInteger(declaredBytes) || declaredBytes > maxBytes) {
      cancelResponseBody(response);
      throw new SearxngRequestError(
        `SearXNG response exceeds ${maxBytes} bytes`,
      );
    }
  }

  if (!response.body) {
    throw new SearxngRequestError("SearXNG returned invalid JSON");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const chunk = await Promise.race([reader.read(), deadline]);
      if (chunk.done) break;
      totalBytes += chunk.value.byteLength;
      if (totalBytes > maxBytes) {
        throw new SearxngRequestError(
          `SearXNG response exceeds ${maxBytes} bytes`,
        );
      }
      chunks.push(chunk.value);
    }
  } catch (error) {
    cancelReader(reader);
    if (error instanceof SearxngRequestError) throw error;
    throw new SearxngRequestError("SearXNG returned invalid JSON");
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new SearxngRequestError("SearXNG returned invalid JSON");
  }
}

function validOptionalText(record: Record<string, unknown>, key: string): boolean {
  return record[key] === undefined
    || record[key] === null
    || typeof record[key] === "string";
}

function metadataFor(record: Record<string, unknown>): Record<string, JsonValue> {
  const metadata: Record<string, JsonValue> = {};
  if (typeof record.engine === "string" && record.engine.trim()) {
    metadata.engine = record.engine;
  }
  if (
    Array.isArray(record.engines)
    && record.engines.every((engine) => typeof engine === "string")
  ) {
    metadata.engines = record.engines;
  }
  if (typeof record.category === "string" && record.category.trim()) {
    metadata.category = record.category;
  }
  if (typeof record.publishedDate === "string" && record.publishedDate.trim()) {
    metadata.publishedDate = record.publishedDate;
  }
  if (typeof record.content === "string" && record.content.trim()) {
    metadata.snippet = record.content;
    metadata.snippetTrust = "untrusted";
  }
  return metadata;
}

async function candidateFromResult(
  result: unknown,
  rank: number,
  resolve: HostnameResolver | undefined,
): Promise<SourceCandidate | null> {
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  const record = result as Record<string, unknown>;
  if (
    typeof record.url !== "string"
    || !record.url.trim()
    || !validOptionalText(record, "title")
    || !validOptionalText(record, "content")
    || !validOptionalText(record, "engine")
    || !validOptionalText(record, "category")
    || !validOptionalText(record, "publishedDate")
  ) {
    return null;
  }

  let validated: Awaited<ReturnType<typeof validatePublicUrl>>;
  try {
    validated = await validatePublicUrl(record.url, { resolve });
  } catch (error) {
    if (error instanceof SafeUrlError) return null;
    throw error;
  }

  return {
    sourceType: "web_search",
    sourceIdentity: validated.canonicalUrl,
    sourceUrl: validated.observedUrl,
    observedUrl: validated.observedUrl,
    canonicalUrl: validated.canonicalUrl,
    observedName: typeof record.title === "string" && record.title.trim()
      ? record.title.trim()
      : null,
    observedLocation: null,
    providerRank: rank,
    metadata: metadataFor(record),
  };
}

function assertWebSearchWork(work: SearchPlanWorkItem): SourceQueryWorkItem {
  if (work.kind !== "source_query" || work.source !== "web_search") {
    throw new TypeError("SearXNG accepts only web_search query work");
  }
  return work;
}

export function createSearxngAdapter({
  endpoint,
  fetch,
  resolve,
  timeoutMs = 10_000,
  maxRedirects = 3,
  maxResponseBytes = 1_000_000,
  maxResults = 100,
  maxCandidates = 50,
}: SearxngAdapterOptions = {}): SourceAdapter {
  let configuredEndpoint: URL | null = null;
  let unavailableReason: string | undefined;

  if (!endpoint?.trim()) {
    unavailableReason = "SearXNG endpoint is not configured";
  } else {
    try {
      configuredEndpoint = validateOperatorUrl(endpoint.trim());
    } catch {
      unavailableReason = "SearXNG endpoint must be a valid HTTP(S) URL";
    }
  }

  const capabilities = {
    discovery: true,
    enrichment: false,
    contactSearch: false,
    supportsCursor: true,
    live: configuredEndpoint !== null,
    ...(unavailableReason ? { unavailableReason } : {}),
  } as const;

  return {
    source: "web_search",
    capabilities,
    async discover(input) {
      const work = assertWebSearchWork(input);
      if (!configuredEndpoint) {
        throw new SourceUnavailableError(
          unavailableReason ?? "SearXNG is unavailable",
        );
      }
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
        throw new RangeError("timeoutMs must be a positive integer");
      }
      positiveInteger(maxResponseBytes, "maxResponseBytes");
      positiveInteger(maxResults, "maxResults");
      positiveInteger(maxCandidates, "maxCandidates");

      const page = pageFromCursor(work);
      const requestUrl = new URL(configuredEndpoint.toString());
      requestUrl.searchParams.set("q", work.query);
      requestUrl.searchParams.set("format", "json");
      requestUrl.searchParams.set("pageno", String(page));

      const controller = new AbortController();
      let timedOut = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          controller.abort();
          reject(new SearxngRequestError("SearXNG request timed out"));
        }, timeoutMs);
      });

      try {
        const response = await Promise.race([
          fetchOperatorUrl(requestUrl.toString(), {
            fetch,
            maxRedirects,
            init: {
              headers: { accept: "application/json" },
              signal: controller.signal,
            },
          }),
          timeout,
        ]);
        if (!response.ok) {
          cancelResponseBody(response);
          throw new SearxngRequestError(
            `SearXNG request failed with status ${response.status}`,
          );
        }
        const payload = await readBoundedJson(response, maxResponseBytes, timeout);
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
          throw new SearxngRequestError("SearXNG returned an invalid response");
        }
        const results = (payload as Record<string, unknown>).results;
        if (!Array.isArray(results)) {
          throw new SearxngRequestError("SearXNG response is missing results");
        }
        if (results.length > maxResults) {
          throw new SearxngRequestError(
            `SearXNG returned more than ${maxResults} results`,
          );
        }

        const candidates: SourceCandidate[] = [];
        const seen = new Set<string>();
        for (let index = 0; index < results.length; index += 1) {
          if (candidates.length >= maxCandidates) break;
          const candidate = await Promise.race([
            candidateFromResult(results[index], index + 1, resolve),
            timeout,
          ]);
          if (!candidate || seen.has(candidate.canonicalUrl)) continue;
          seen.add(candidate.canonicalUrl);
          candidates.push(candidate);
        }

        return {
          candidates,
          nextCursor: results.length === 0
            ? { state: "exhausted" }
            : { state: "next", value: { page: page + 1 } },
        };
      } catch (error) {
        if (error instanceof SearxngRequestError) throw error;
        throw new SearxngRequestError(
          timedOut ? "SearXNG request timed out" : "SearXNG request failed",
        );
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
  };
}
