import { describe, expect, it, vi } from "vitest";

import {
  type FetchLike,
  fetchPublicUrl,
  SafeUrlError,
  validateOperatorUrl,
  validatePublicUrl,
} from "./safe-url";

const publicResolver = vi.fn(async () => ["93.184.216.34"]);

describe("safe public URLs", () => {
  it("canonicalizes a public HTTP URL while preserving its exact observed form", async () => {
    const observedUrl = "HTTPS://Example.COM:443/catalog/?utm_source=test&b=2&a=1#details";

    await expect(validatePublicUrl(observedUrl, { resolve: publicResolver }))
      .resolves.toEqual({
        observedUrl,
        canonicalUrl: "https://example.com/catalog?a=1&b=2",
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
  ])("rejects unsafe URL %s", async (url) => {
    await expect(validatePublicUrl(url, { resolve: publicResolver }))
      .rejects.toBeInstanceOf(SafeUrlError);
  });

  it.each(["10.1.2.3", "169.254.1.1", "::1", "fd00::1", "ff02::1"])(
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
    const fetch = vi.fn<FetchLike>(async () => new Response(null, {
      status: 302,
      headers: { location: "http://127.0.0.1/admin" },
    }));

    await expect(fetchPublicUrl("https://example.com/start", {
      fetch,
      resolve: publicResolver,
    })).rejects.toBeInstanceOf(SafeUrlError);
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ redirect: "manual" });
  });

  it("validates every safe redirect and returns the final response", async () => {
    const resolve = vi.fn(async () => ["93.184.216.34"]);
    const fetch = vi.fn<FetchLike>()
      .mockResolvedValueOnce(new Response(null, {
        status: 301,
        headers: { location: "/next" },
      }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const response = await fetchPublicUrl("https://example.com/start", {
      fetch,
      resolve,
      maxRedirects: 2,
    });

    expect(await response.text()).toBe("ok");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "https://example.com/start",
      "https://example.com/next",
    ]);
  });

  it("enforces the redirect maximum", async () => {
    const fetch = vi.fn<FetchLike>(async () => new Response(null, {
      status: 302,
      headers: { location: "/again" },
    }));

    await expect(fetchPublicUrl("https://example.com/start", {
      fetch,
      resolve: publicResolver,
      maxRedirects: 1,
    })).rejects.toThrow("Too many redirects");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
