import { describe, expect, it, vi } from "vitest";

import {
  type FetchLike,
  fetchOperatorUrl,
  fetchPublicUrl,
  type PinnedHttpTransport,
  SafeUrlError,
  validateOperatorUrl,
  validatePublicUrl,
} from "./safe-url";

const publicResolver = vi.fn(async () => ["93.184.216.34"]);

function cancellableResponse(status: number, location?: string) {
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("discard me"));
    },
    cancel,
  });
  return {
    cancel,
    response: new Response(body, {
      status,
      headers: location ? { location } : undefined,
    }),
  };
}

describe("safe public URLs", () => {
  it("canonicalizes a public HTTP URL while preserving its exact observed form", async () => {
    const observedUrl = "HTTPS://Example.COM:443/catalog/?utm_source=test&b=2&a=1#details";

    await expect(validatePublicUrl(observedUrl, { resolve: publicResolver }))
      .resolves.toEqual({
        observedUrl,
        requestUrl: "https://example.com/catalog/?utm_source=test&b=2&a=1",
        canonicalUrl: "https://example.com/catalog?a=1&b=2",
        hostname: "example.com",
        addresses: ["93.184.216.34"],
      });
  });

  it.each([
    "ftp://example.com/file",
    "file:///etc/passwd",
    "https://user:password@example.com/",
    "http://localhost/",
    "http://api.localhost/",
    "http://0.0.0.0/",
    "http://10.0.0.1/",
    "http://127.0.0.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://172.16.0.1/",
    "http://192.168.1.1/",
    "http://224.0.0.1/",
    "http://2130706433/",
    "http://0x7f000001/",
    "http://0177.0.0.1/",
    "http://[::]/",
    "http://[::1]/",
    "http://[fc00::1]/",
    "http://[fe80::1]/",
    "http://[ff02::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://[64:ff9b::7f00:1]/",
    "http://[64:ff9b:1::7f00:1]/",
    "http://[2002:7f00:1::]/",
    "http://[2001:0000:4136:e378:8000:63bf:3fff:fdd2]/",
  ])("rejects unsafe URL %s", async (url) => {
    await expect(validatePublicUrl(url, { resolve: publicResolver }))
      .rejects.toBeInstanceOf(SafeUrlError);
  });

  it.each([
    "http://localhost./",
    "http://api.localhost./",
  ])("rejects localhost with a trailing DNS root dot: %s", async (url) => {
    const misleadingResolver = vi.fn(async () => ["93.184.216.34"]);

    await expect(validatePublicUrl(url, { resolve: misleadingResolver }))
      .rejects.toThrow("blocked");
    expect(misleadingResolver).not.toHaveBeenCalled();
  });

  it.each([
    "10.1.2.3",
    "169.254.1.1",
    "::1",
    "fd00::1",
    "ff02::1",
    "64:ff9b::7f00:1",
    "64:ff9b:1::7f00:1",
    "2002:7f00:1::",
    "2001:0000:4136:e378:8000:63bf:3fff:fdd2",
  ])(
    "rejects a hostname when DNS resolves to blocked address %s",
    async (address) => {
      const resolve = vi.fn(async () => [address]);

      await expect(validatePublicUrl("https://example.com/", { resolve }))
        .rejects.toThrow("blocked network");
    },
  );

  it("rejects hostnames that do not resolve", async () => {
    await expect(validatePublicUrl("https://example.com/", {
      resolve: async () => [],
    })).rejects.toThrow("did not resolve");
  });

  it("allows an operator-configured private endpoint but still requires HTTP(S)", () => {
    expect(validateOperatorUrl("http://127.0.0.1:8080/search").toString())
      .toBe("http://127.0.0.1:8080/search");
    expect(() => validateOperatorUrl("file:///tmp/searxng"))
      .toThrow(SafeUrlError);
  });

  it("uses manual redirects and rejects a redirect to a blocked destination", async () => {
    const request = vi.fn<PinnedHttpTransport["request"]>(async () => new Response(null, {
      status: 302,
      headers: { location: "http://127.0.0.1/admin" },
    }));

    await expect(fetchPublicUrl("https://example.com/start", {
      transport: { request },
      resolve: publicResolver,
    })).rejects.toBeInstanceOf(SafeUrlError);
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0]?.[0].init).toMatchObject({ redirect: "manual" });
  });

  it("pins every public redirect hop to exactly the addresses that were validated", async () => {
    const resolve = vi.fn(async (hostname: string) => (
      hostname === "example.com"
        ? ["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"]
        : ["203.0.114.10"]
    ));
    const first = cancellableResponse(
      302,
      "https://redirect.example.net/signed/?z=2&a=1&utm_source=keep-order#fragment",
    );
    const request = vi.fn<PinnedHttpTransport["request"]>()
      .mockResolvedValueOnce(first.response)
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const transport: PinnedHttpTransport = { request };
    const response = await fetchPublicUrl(
      "https://Example.com/start/?signature=a%2Fb&b=2&a=1#ignored",
      {
        transport,
        resolve,
        maxRedirects: 2,
      },
    );

    expect(await response.text()).toBe("ok");
    expect(request).toHaveBeenNthCalledWith(1, {
      requestUrl: "https://example.com/start/?signature=a%2Fb&b=2&a=1",
      hostname: "example.com",
      addresses: [
        "93.184.216.34",
        "2606:2800:220:1:248:1893:25c8:1946",
      ],
      init: { redirect: "manual" },
    });
    expect(request).toHaveBeenNthCalledWith(2, {
      requestUrl:
        "https://redirect.example.net/signed/?z=2&a=1&utm_source=keep-order",
      hostname: "redirect.example.net",
      addresses: ["203.0.114.10"],
      init: { redirect: "manual" },
    });
    expect(first.cancel).toHaveBeenCalledOnce();
  });

  it("validates every safe redirect and returns the final response", async () => {
    const resolve = vi.fn(async () => ["93.184.216.34"]);
    const request = vi.fn<PinnedHttpTransport["request"]>()
      .mockResolvedValueOnce(new Response(null, {
        status: 301,
        headers: { location: "/next" },
      }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const response = await fetchPublicUrl("https://example.com/start", {
      transport: { request },
      resolve,
      maxRedirects: 2,
    });

    expect(await response.text()).toBe("ok");
    expect(request).toHaveBeenCalledTimes(2);
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(request.mock.calls.map(([input]) => input.requestUrl)).toEqual([
      "https://example.com/start",
      "https://example.com/next",
    ]);
  });

  it("enforces the redirect maximum", async () => {
    const request = vi.fn<PinnedHttpTransport["request"]>(async () => new Response(null, {
      status: 302,
      headers: { location: "/again" },
    }));

    await expect(fetchPublicUrl("https://example.com/start", {
      transport: { request },
      resolve: publicResolver,
      maxRedirects: 1,
    })).rejects.toThrow("Too many redirects");
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("cancels a redirect body before rejecting a malformed location", async () => {
    const redirect = cancellableResponse(302, "http://[");
    const request = vi.fn<PinnedHttpTransport["request"]>(
      async () => redirect.response,
    );

    await expect(fetchPublicUrl("https://example.com/start", {
      transport: { request },
      resolve: publicResolver,
    }))
      .rejects.toThrow("malformed");
    expect(redirect.cancel).toHaveBeenCalledOnce();
  });

  it("keeps operator redirects on the configured origin and cancels rejected bodies", async () => {
    const redirect = cancellableResponse(302, "http://127.0.0.1:9999/private");
    const fetch = vi.fn<FetchLike>(async () => redirect.response);

    await expect(fetchOperatorUrl("http://127.0.0.1:8888/search", {
      fetch,
    })).rejects.toThrow("same origin");
    expect(fetch).toHaveBeenCalledOnce();
    expect(redirect.cancel).toHaveBeenCalledOnce();
  });
});
