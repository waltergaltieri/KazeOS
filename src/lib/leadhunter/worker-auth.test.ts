// @vitest-environment node

import { describe, expect, it } from "vitest";

import { authenticateWorkerRequest } from "./worker-auth";

const secret = "worker-secret-with-enough-entropy";

function request(authorization?: string) {
  return new Request("http://localhost/api/internal/leadhunter/jobs/next", {
    headers: authorization ? { authorization } : undefined,
    method: "POST",
  });
}

describe("authenticateWorkerRequest", () => {
  it.each([
    undefined,
    `bearer ${secret}`,
    `Bearer  ${secret}`,
    `Bearer ${secret}x`,
    `Bearer ${secret.slice(0, -1)}`,
    "Bearer wrong-secret",
  ])("rejects non-exact bearer credentials %#", (authorization) => {
    expect(authenticateWorkerRequest(request(authorization), secret)).toEqual({
      ok: false,
      status: 401,
      error: "Unauthorized",
    });
  });

  it("accepts only the exact bearer credential", () => {
    expect(
      authenticateWorkerRequest(request(`Bearer ${secret}`), secret),
    ).toEqual({ ok: true });
  });

  it("reports unavailable without reflecting a configured or supplied secret", () => {
    const result = authenticateWorkerRequest(
      request(`Bearer ${secret}`),
      "   ",
    );

    expect(result).toEqual({
      ok: false,
      status: 503,
      error: "Worker is not configured",
    });
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("treats a configured secret shorter than 32 characters as unavailable", () => {
    const shortSecret = "short-worker-secret";
    const result = authenticateWorkerRequest(
      request(`Bearer ${shortSecret}`),
      shortSecret,
    );

    expect(result).toEqual({
      ok: false,
      status: 503,
      error: "Worker is not configured",
    });
    expect(JSON.stringify(result)).not.toContain(shortSecret);
  });
});
