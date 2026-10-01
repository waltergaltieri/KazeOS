import { isExactBearerToken, type MachineAuthenticationResult } from "./worker-auth";

export function authenticateTransportRequest(request: Request, configuredSecret = process.env.LEADHUNTER_TRANSPORT_SECRET): MachineAuthenticationResult {
  const secret = configuredSecret?.trim();
  if (!secret || secret.length < 32) return { ok: false, status: 503, error: "Mail transport is not configured" };
  if (!isExactBearerToken(request.headers.get("authorization"), secret)) return { ok: false, status: 401, error: "Unauthorized" };
  return { ok: true };
}
