import { promises as dns } from "node:dns";
import { BlockList, isIP } from "node:net";

export type HostnameResolver = (hostname: string) => Promise<readonly string[]>;
export type FetchLike = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface ValidatedPublicUrl {
  observedUrl: string;
  requestUrl: string;
  canonicalUrl: string;
  hostname: string;
  addresses: readonly string[];
}

export interface PinnedHttpRequest {
  requestUrl: string;
  hostname: string;
  addresses: readonly string[];
  init: RequestInit;
}

/**
 * Connect only to one of `addresses`, preserving `hostname` for Host and TLS SNI.
 */
export interface PinnedHttpTransport {
  request(input: PinnedHttpRequest): Promise<Response>;
}

export class SafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SafeUrlError";
  }
}

const blockedIpv6 = new BlockList();
blockedIpv6.addSubnet("::", 96, "ipv6");
blockedIpv6.addSubnet("::ffff:0:0", 96, "ipv6");
blockedIpv6.addSubnet("64:ff9b::", 96, "ipv6");
blockedIpv6.addSubnet("64:ff9b:1::", 48, "ipv6");
blockedIpv6.addSubnet("100::", 64, "ipv6");
blockedIpv6.addSubnet("2001::", 32, "ipv6");
blockedIpv6.addSubnet("2001:db8::", 32, "ipv6");
blockedIpv6.addSubnet("2001:10::", 28, "ipv6");
blockedIpv6.addSubnet("2001:20::", 28, "ipv6");
blockedIpv6.addSubnet("fc00::", 7, "ipv6");
blockedIpv6.addSubnet("fe80::", 10, "ipv6");
blockedIpv6.addSubnet("fec0::", 10, "ipv6");
blockedIpv6.addSubnet("ff00::", 8, "ipv6");
blockedIpv6.addSubnet("2002::", 16, "ipv6");

const trackingParameters = new Set([
  "dclid",
  "fbclid",
  "gclid",
  "gbraid",
  "msclkid",
  "wbraid",
]);

function parseUrl(input: string): URL {
  if (typeof input !== "string" || input.length === 0 || input.length > 2_048) {
    throw new SafeUrlError("URL must be a non-empty string of at most 2048 characters");
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new SafeUrlError("URL is malformed");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SafeUrlError("URL must use HTTP or HTTPS");
  }
  if (url.username || url.password) {
    throw new SafeUrlError("URL must not contain embedded credentials");
  }
  if (!url.hostname) {
    throw new SafeUrlError("URL must contain a hostname");
  }

  return url;
}

function plainHostname(url: URL): string {
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

function isBlockedIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => (
    !Number.isInteger(octet) || octet < 0 || octet > 255
  ))) {
    return true;
  }

  const [first, second, third] = octets as [number, number, number, number];
  return first === 0
    || first === 10
    || first === 127
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 0 && third === 0)
    || (first === 192 && second === 0 && third === 2)
    || (first === 192 && second === 88 && third === 99)
    || (first === 192 && second === 168)
    || (first === 198 && (second === 18 || second === 19))
    || (first === 198 && second === 51 && third === 100)
    || (first === 203 && second === 0 && third === 113)
    || first >= 224;
}

function isBlockedAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isBlockedIpv4(address);
  if (version === 6) return blockedIpv6.check(address, "ipv6");
  throw new SafeUrlError("Resolver returned an invalid IP address");
}

function canonicalize(url: URL): string {
  const canonical = new URL(url.toString());
  canonical.hash = "";

  for (const key of [...canonical.searchParams.keys()]) {
    const normalizedKey = key.toLowerCase();
    if (normalizedKey.startsWith("utm_") || trackingParameters.has(normalizedKey)) {
      canonical.searchParams.delete(key);
    }
  }
  canonical.searchParams.sort();

  if (canonical.pathname !== "/") {
    canonical.pathname = canonical.pathname.replace(/\/+$/, "") || "/";
  }

  return canonical.toString();
}

export const resolveHostname: HostnameResolver = async (hostname) => {
  const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  return addresses.map(({ address }) => address);
};

export function validateOperatorUrl(input: string): URL {
  const url = parseUrl(input);
  url.hash = "";
  return url;
}

export async function validatePublicUrl(
  observedUrl: string,
  { resolve = resolveHostname }: { resolve?: HostnameResolver } = {},
): Promise<ValidatedPublicUrl> {
  const url = parseUrl(observedUrl);
  const hostname = plainHostname(url);
  if (url.hostname.endsWith(".")) url.hostname = hostname;

  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new SafeUrlError("URL hostname is blocked");
  }

  const literalVersion = isIP(hostname);
  let addresses: readonly string[];
  if (literalVersion !== 0) {
    if (isBlockedAddress(hostname)) {
      throw new SafeUrlError("URL resolves to a blocked network");
    }
    addresses = [hostname];
  } else {
    try {
      addresses = await resolve(hostname);
    } catch {
      throw new SafeUrlError("URL hostname could not be resolved safely");
    }
    if (addresses.length === 0) {
      throw new SafeUrlError("URL hostname did not resolve");
    }
    for (const address of addresses) {
      if (isBlockedAddress(address)) {
        throw new SafeUrlError("URL resolves to a blocked network");
      }
    }
    addresses = [...new Set(addresses)];
  }

  const request = new URL(url.toString());
  request.hash = "";
  return {
    observedUrl,
    requestUrl: request.toString(),
    canonicalUrl: canonicalize(url),
    hostname,
    addresses,
  };
}

const redirectStatuses = new Set([301, 302, 303, 307, 308]);

function validateRedirectMaximum(maxRedirects: number): void {
  if (!Number.isSafeInteger(maxRedirects) || maxRedirects < 0) {
    throw new RangeError("maxRedirects must be a non-negative integer");
  }
}

export function cancelResponseBody(response: Response): void {
  if (!response.body || response.body.locked) return;
  try {
    void response.body.cancel().catch(() => undefined);
  } catch {
    // Best-effort cancellation must not replace the original error.
  }
}

function redirectLocation(response: Response, currentUrl: string): string | null {
  if (!redirectStatuses.has(response.status)) return null;
  const location = response.headers.get("location");
  if (!location) return null;
  cancelResponseBody(response);
  try {
    return new URL(location, currentUrl).toString();
  } catch {
    throw new SafeUrlError("Redirect location is malformed");
  }
}

export async function fetchPublicUrl(
  url: string,
  options: {
    transport: PinnedHttpTransport;
    resolve?: HostnameResolver;
    init?: RequestInit;
    maxRedirects?: number;
  },
): Promise<Response> {
  const maxRedirects = options.maxRedirects ?? 5;
  validateRedirectMaximum(maxRedirects);
  let currentUrl = url;
  let redirects = 0;

  while (true) {
    const validated = await validatePublicUrl(currentUrl, {
      resolve: options.resolve,
    });
    const response = await options.transport.request({
      requestUrl: validated.requestUrl,
      hostname: validated.hostname,
      addresses: validated.addresses,
      init: { ...options.init, redirect: "manual" },
    });
    const location = redirectLocation(response, validated.requestUrl);
    if (!location) return response;
    if (redirects >= maxRedirects) {
      throw new SafeUrlError("Too many redirects");
    }
    redirects += 1;
    currentUrl = location;
  }
}

export async function fetchOperatorUrl(
  url: string,
  options: {
    fetch?: FetchLike;
    init?: RequestInit;
    maxRedirects?: number;
  } = {},
): Promise<Response> {
  const maxRedirects = options.maxRedirects ?? 5;
  validateRedirectMaximum(maxRedirects);
  const configured = validateOperatorUrl(url);
  const configuredOrigin = configured.origin;
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  let currentUrl = configured.toString();
  let redirects = 0;

  while (true) {
    const validated = validateOperatorUrl(currentUrl);
    if (validated.origin !== configuredOrigin) {
      throw new SafeUrlError("Operator redirects must stay on the same origin");
    }
    const response = await fetchImplementation(validated.toString(), {
      ...options.init,
      redirect: "manual",
    });
    const location = redirectLocation(response, validated.toString());
    if (!location) return response;
    if (redirects >= maxRedirects) {
      throw new SafeUrlError("Too many redirects");
    }
    redirects += 1;
    currentUrl = location;
  }
}
