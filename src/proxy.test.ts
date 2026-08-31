// @vitest-environment node

import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { config } from "./proxy";

describe("proxy matcher", () => {
  it("covers private pages and APIs, including the cron exception", () => {
    expect(
      unstable_doesMiddlewareMatch({
        config,
        nextConfig: {},
        url: "/dashboard",
      }),
    ).toBe(true);
    expect(
      unstable_doesMiddlewareMatch({
        config,
        nextConfig: {},
        url: "/api/private",
      }),
    ).toBe(true);
    expect(
      unstable_doesMiddlewareMatch({
        config,
        nextConfig: {},
        url: "/api/private.js",
      }),
    ).toBe(true);
    expect(
      unstable_doesMiddlewareMatch({
        config,
        nextConfig: {},
        url: "/api/cron/generate-charges",
      }),
    ).toBe(true);
  });

  it("excludes framework and static assets", () => {
    expect(
      unstable_doesMiddlewareMatch({
        config,
        nextConfig: {},
        url: "/_next/static/chunk.js",
      }),
    ).toBe(false);
    expect(
      unstable_doesMiddlewareMatch({
        config,
        nextConfig: {},
        url: "/brand.svg",
      }),
    ).toBe(false);
  });
});
