import { z } from "zod";

import { claimLeadHunterJob } from "@/db";
import { authenticateWorkerRequest } from "@/lib/leadhunter/worker-auth";

export const runtime = "nodejs";

const claimRequestSchema = z.object({ kinds: z.array(z.enum(["discover", "resolve_identity", "research", "audit_website", "qualify", "enrich_contact", "prepare_message", "validate_message"])).min(1).max(8).optional() }).strict();

export async function POST(request: Request): Promise<Response> {
  const authentication = authenticateWorkerRequest(request);
  if (!authentication.ok) {
    return Response.json(
      { error: authentication.error },
      { status: authentication.status },
    );
  }

  let parsed: z.infer<typeof claimRequestSchema>;
  try {
    const body = await request.json();
    const result = claimRequestSchema.safeParse(body);
    if (!result.success) {
      return Response.json({ error: "Invalid request" }, { status: 400 });
    }
    parsed = result.data;
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    const job = parsed.kinds ? await claimLeadHunterJob(parsed.kinds) : await claimLeadHunterJob();
    if (job === null) return new Response(null, { status: 204 });

    return Response.json({ id: job.id, kind: job.kind, leaseToken: job.leaseToken, leaseExpiresAt: job.leaseExpiresAt, payload: job.payload });
  } catch {
    console.error("LeadHunter job claim failed");
    return Response.json({ error: "Job claim failed" }, { status: 500 });
  }
}
