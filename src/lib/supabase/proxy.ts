import { type NextRequest, NextResponse } from "next/server";

import { createResponseClient } from "./response";

const CHARGE_GENERATION_CRON_PATH = "/api/cron/generate-charges";
const LEADHUNTER_MACHINE_PATHS = new Set([
  "/api/cron/leadhunter",
  "/api/internal/leadhunter/jobs/next",
]);
const LEADHUNTER_COMPLETION_PATH =
  /^\/api\/internal\/leadhunter\/jobs\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/complete$/i;
const RESPONSE_AUTH_PATHS = new Set(["/auth/login", "/auth/logout"]);

function isSessionExemptPath(pathname: string) {
  return pathname === CHARGE_GENERATION_CRON_PATH
    || LEADHUNTER_MACHINE_PATHS.has(pathname)
    || LEADHUNTER_COMPLETION_PATH.test(pathname)
    || RESPONSE_AUTH_PATHS.has(pathname);
}

export function getSafeNextPath(pathname: string, search: string) {
  const candidate = `${pathname}${search}`;

  return candidate.startsWith("/") && !candidate.startsWith("//")
    ? candidate
    : "/dashboard";
}

export async function updateSession(request: NextRequest) {
  if (isSessionExemptPath(request.nextUrl.pathname)) {
    return NextResponse.next({ request });
  }

  const responseClient = createResponseClient(request);

  const { data, error } = await responseClient.client.auth.getClaims();
  const isAuthenticated = !error && Boolean(data?.claims);
  const isLoginRoute = request.nextUrl.pathname === "/login";

  if (!isAuthenticated && !isLoginRoute) {
    const loginUrl = request.nextUrl.clone();
    const nextPath = getSafeNextPath(
      request.nextUrl.pathname,
      request.nextUrl.search,
    );

    loginUrl.pathname = "/login";
    loginUrl.search = "";
    loginUrl.searchParams.set("next", nextPath);

    return responseClient.applyTo(NextResponse.redirect(loginUrl));
  }

  if (isAuthenticated && isLoginRoute) {
    const dashboardUrl = request.nextUrl.clone();

    dashboardUrl.pathname = "/dashboard";
    dashboardUrl.search = "";

    return responseClient.applyTo(NextResponse.redirect(dashboardUrl));
  }

  return responseClient.getResponse();
}
