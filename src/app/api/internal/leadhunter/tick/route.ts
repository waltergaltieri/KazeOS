import { z } from "zod";

import { planDueLeadHunterRuns, runLeadHunterIdentityResolution } from "@/db";
import { authenticateWorkerRequest } from "@/lib/leadhunter/worker-auth";

export const runtime = "nodejs";

const tickRequestSchema = z.object({}).strict();

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
    if (!tickRequestSchema.safeParse(body).success) {
      return Response.json({ error: "Invalid request" }, { status: 400 });
    }
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    const planned = await planDueLeadHunterRuns();
    const identity = await runLeadHunterIdentityResolution();
    return Response.json({ planned, identity });
  } catch {
    console.error("LeadHunter tick failed");
    return Response.json({ error: "LeadHunter tick failed" }, { status: 500 });
  }
}
