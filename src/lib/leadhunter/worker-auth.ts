import { timingSafeEqual } from "node:crypto";

export type MachineAuthenticationResult =
  | { ok: true }
  | { ok: false; status: 401 | 503; error: string };

export function isExactBearerToken(
  authorization: string | null,
  secret: string,
): boolean {
  if (authorization === null) return false;

  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(authorization);

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function authenticateWorkerRequest(
  request: Request,
  configuredSecret = process.env.LEADHUNTER_WORKER_SECRET,
): MachineAuthenticationResult {
  const secret = configuredSecret?.trim();

  if (!secret) {
    return {
      ok: false,
      status: 503,
      error: "Worker is not configured",
    };
  }

  if (!isExactBearerToken(request.headers.get("authorization"), secret)) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  return { ok: true };
}
