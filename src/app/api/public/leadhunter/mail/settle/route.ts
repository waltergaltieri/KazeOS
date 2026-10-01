import { z } from "zod";
import { settleLeadHunterMail } from "@/db";
import { authenticateTransportRequest } from "@/lib/leadhunter/transport-auth";

export const runtime = "nodejs";
const bodySchema = z.object({
  outboxId: z.string().uuid(), result: z.enum(["accepted", "failed", "unknown"]),
  providerMessageId: z.string().trim().min(1).max(500).optional(), error: z.string().trim().max(1000).optional(),
}).strict();

export async function POST(request: Request) {
  const auth = authenticateTransportRequest(request);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const settled = await settleLeadHunterMail({ ...parsed.data, leaseOwner: "chatgpt-mail-bridge" });
  return settled ? Response.json({ settled: true }) : Response.json({ error: "Command is not leased" }, { status: 409 });
}
