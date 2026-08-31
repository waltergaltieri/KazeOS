import "server-only";

import { type NextRequest, NextResponse } from "next/server";

import { appOriginSchema } from "@/lib/env";

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Expires: "0",
  Pragma: "no-cache",
};

export function rejectUntrustedOrigin(request: NextRequest) {
  const trustedOrigin = appOriginSchema.safeParse(process.env.APP_ORIGIN);
  const requestOrigin = request.headers.get("origin");

  if (trustedOrigin.success && requestOrigin === trustedOrigin.data) {
    return null;
  }

  return NextResponse.json(
    { status: "error", message: "Solicitud no permitida." },
    { status: 403, headers: NO_STORE_HEADERS },
  );
}
