import { z } from "zod";
import { recordLeadHunterMailEvent } from "@/db";
import { authenticateTransportRequest } from "@/lib/leadhunter/transport-auth";

export const runtime = "nodejs";
const bodySchema = z.object({ providerMessageId: z.string().trim().min(1).max(500), event: z.enum(["replied", "bounced"]), occurredAt: z.string().datetime({ offset: true }) }).strict();

export async function POST(request: Request) {
  const auth = authenticateTransportRequest(request);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const recorded = await recordLeadHunterMailEvent({ ...parsed.data, occurredAt: new Date(parsed.data.occurredAt) });
  return recorded ? Response.json({ recorded: true }) : Response.json({ error: "Message not found" }, { status: 404 });
}
