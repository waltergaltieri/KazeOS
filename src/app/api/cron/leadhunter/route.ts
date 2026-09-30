import { planDueLeadHunterRuns } from "@/db";
import { isExactBearerToken } from "@/lib/leadhunter/worker-auth";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET?.trim();

  if (!secret) {
    return Response.json({ error: "Cron is not configured" }, { status: 503 });
  }

  if (!isExactBearerToken(request.headers.get("authorization"), secret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    return Response.json(await planDueLeadHunterRuns());
  } catch {
    console.error("LeadHunter planning failed");
    return Response.json(
      { error: "LeadHunter planning failed" },
      { status: 500 },
    );
  }
}
