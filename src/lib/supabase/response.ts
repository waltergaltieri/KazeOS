import "server-only";

import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

function copyCookies(source: NextResponse, destination: NextResponse) {
  source.cookies.getAll().forEach((cookie) => destination.cookies.set(cookie));
}

export function createResponseClient(
  request: NextRequest,
  initialResponse = NextResponse.next({ request }),
) {
  let response = initialResponse;
  const supabaseHeaders = new Headers();

  const client = createServerClient(
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

          const refreshedResponse = NextResponse.next({ request });
          copyCookies(response, refreshedResponse);

          cookiesToSet.forEach(({ name, value, options }) => {
            refreshedResponse.cookies.set(name, value, options);
          });

          Object.entries(headers).forEach(([name, value]) => {
            supabaseHeaders.set(name, value);
            refreshedResponse.headers.set(name, value);
          });

          response = refreshedResponse;
        },
      },
    },
  );

  return {
    client,
    getResponse() {
      return response;
    },
    applyTo(destination: NextResponse) {
      copyCookies(response, destination);
      supabaseHeaders.forEach((value, name) => {
        destination.headers.set(name, value);
      });

      return destination;
    },
  };
}
