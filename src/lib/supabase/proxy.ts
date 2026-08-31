import { type NextRequest, NextResponse } from "next/server";

import { createResponseClient } from "./response";

const CHARGE_GENERATION_CRON_PATH = "/api/cron/generate-charges";

export function getSafeNextPath(pathname: string, search: string) {
  const candidate = `${pathname}${search}`;

  return candidate.startsWith("/") && !candidate.startsWith("//")
    ? candidate
    : "/dashboard";
}

export async function updateSession(request: NextRequest) {
  if (request.nextUrl.pathname === CHARGE_GENERATION_CRON_PATH) {
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
