import { type NextRequest, NextResponse } from "next/server";

import { rejectUntrustedOrigin } from "@/lib/auth/same-origin";
import { createResponseClient } from "@/lib/supabase/response";

function logoutRedirect(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/login", request.url), 303);
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Expires", "0");
  response.headers.set("Pragma", "no-cache");
  return response;
}

export async function POST(request: NextRequest) {
  const originRejection = rejectUntrustedOrigin(request);
  if (originRejection) return originRejection;

  let responseClient: ReturnType<typeof createResponseClient>;

  try {
    responseClient = createResponseClient(request);
  } catch {
    return logoutRedirect(request);
  }

  try {
    await responseClient.client.auth.signOut();
  } catch {
    // The local redirect remains safe and does not expose provider diagnostics.
  }

  return responseClient.applyTo(logoutRedirect(request));
}
