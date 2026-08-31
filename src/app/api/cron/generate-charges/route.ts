import { timingSafeEqual } from "node:crypto";

import { runRecurringChargeCron } from "@/db";
import { todayInBusinessZone } from "@/lib/domain/commercial-date";

export const runtime = "nodejs";

function isExactBearerToken(value: string | null, secret: string): boolean {
  if (value === null) {
    return false;
  }

  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(value);

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;

  if (secret === undefined || secret.trim().length === 0) {
    return Response.json({ error: "Cron is not configured" }, { status: 503 });
  }

  if (!isExactBearerToken(request.headers.get("authorization"), secret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runRecurringChargeCron(
      todayInBusinessZone(new Date()),
    );

    return Response.json(result);
  } catch {
    console.error("Recurring charge generation failed");

    return Response.json(
      { error: "Charge generation failed" },
      { status: 500 },
    );
  }
}
