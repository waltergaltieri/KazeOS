import { z } from "zod";
import { claimLeadHunterMail } from "@/db";
import { authenticateTransportRequest } from "@/lib/leadhunter/transport-auth";

export const runtime = "nodejs";
const bodySchema = z.object({ limit: z.number().int().min(1).max(50).optional() }).strict();

export async function POST(request: Request) {
  const auth = authenticateTransportRequest(request);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const commands = await claimLeadHunterMail("chatgpt-mail-bridge", parsed.data.limit);
  return Response.json({ commands });
}
