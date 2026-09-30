import { z } from "zod";

import { completeLeadHunterJob } from "@/db";
import { authenticateWorkerRequest } from "@/lib/leadhunter/worker-auth";
import {
  JobCompletionRejectedError,
  JobCompletionValidationError,
} from "@/lib/services/leadhunter/job-manager";

export const runtime = "nodejs";

const leaseTokenSchema = z.string().min(1).max(512);
const completionRequestSchema = z.union([
  z.object({
    leaseToken: leaseTokenSchema,
    result: z.unknown(),
  }).strict(),
  z.object({
    leaseToken: leaseTokenSchema,
    error: z.string().trim().min(1).max(2_000),
  }).strict(),
]);
const jobIdSchema = z.string().uuid();

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const authentication = authenticateWorkerRequest(request);
  if (!authentication.ok) {
    return Response.json(
      { error: authentication.error },
      { status: authentication.status },
    );
  }

  let parsed: z.infer<typeof completionRequestSchema>;
  const { id } = await context.params;

  try {
    const body = await request.json();
    const result = completionRequestSchema.safeParse(body);
    if (!jobIdSchema.safeParse(id).success || !result.success) {
      return Response.json({ error: "Invalid request" }, { status: 400 });
    }
    parsed = result.data;
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    const completion = "result" in parsed
      ? { result: parsed.result }
      : { error: parsed.error };
    const result = await completeLeadHunterJob({
      id,
      leaseToken: parsed.leaseToken,
      completion,
    });
    return Response.json(result);
  } catch (error) {
    if (error instanceof JobCompletionValidationError) {
      return Response.json({ error: "Invalid job result" }, { status: 400 });
    }
    if (error instanceof JobCompletionRejectedError) {
      return Response.json(
        { error: "Job completion rejected" },
        { status: 409 },
      );
    }

    console.error("LeadHunter job completion failed");
    return Response.json(
      { error: "Job completion failed" },
      { status: 500 },
    );
  }
}
