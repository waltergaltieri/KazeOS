import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

function copySessionState(source: NextResponse, destination: NextResponse) {
  source.cookies.getAll().forEach((cookie) => destination.cookies.set(cookie));

  for (const headerName of ["cache-control", "expires", "pragma"]) {
    const value = source.headers.get(headerName);

    if (value) {
      destination.headers.set(headerName, value);
    }
  }

  return destination;
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });

          supabaseResponse = NextResponse.next({ request });

          cookiesToSet.forEach(({ name, value, options }) => {
            supabaseResponse.cookies.set(name, value, options);
          });

          Object.entries(headers).forEach(([name, value]) => {
            supabaseResponse.headers.set(name, value);
          });
        },
      },
    },
  );

  const { data } = await supabase.auth.getClaims();
  const isAuthenticated = Boolean(data?.claims);
  const isLoginRoute = request.nextUrl.pathname === "/login";

  if (!isAuthenticated && !isLoginRoute) {
    const loginUrl = request.nextUrl.clone();
    const nextPath = `${request.nextUrl.pathname}${request.nextUrl.search}`;

    loginUrl.pathname = "/login";
    loginUrl.search = "";
    loginUrl.searchParams.set("next", nextPath);

    return copySessionState(
      supabaseResponse,
      NextResponse.redirect(loginUrl),
    );
  }

  if (isAuthenticated && isLoginRoute) {
    const dashboardUrl = request.nextUrl.clone();

    dashboardUrl.pathname = "/dashboard";
    dashboardUrl.search = "";

    return copySessionState(
      supabaseResponse,
      NextResponse.redirect(dashboardUrl),
    );
  }

  return supabaseResponse;
}
