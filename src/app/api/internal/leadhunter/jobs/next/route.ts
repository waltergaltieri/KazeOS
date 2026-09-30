import { z } from "zod";

import { claimLeadHunterJob } from "@/db";
import { authenticateWorkerRequest } from "@/lib/leadhunter/worker-auth";

export const runtime = "nodejs";

const claimRequestSchema = z.object({}).strict();

export async function POST(request: Request): Promise<Response> {
  const authentication = authenticateWorkerRequest(request);
  if (!authentication.ok) {
    return Response.json(
      { error: authentication.error },
      { status: authentication.status },
    );
  }

  try {
    const body = await request.json();
    if (!claimRequestSchema.safeParse(body).success) {
      return Response.json({ error: "Invalid request" }, { status: 400 });
    }
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    const job = await claimLeadHunterJob();
    if (job === null) return new Response(null, { status: 204 });

    return Response.json(job);
  } catch {
    console.error("LeadHunter job claim failed");
    return Response.json({ error: "Job claim failed" }, { status: 500 });
  }
}
