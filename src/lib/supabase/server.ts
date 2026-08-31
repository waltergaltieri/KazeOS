import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

type NextCookieWriteError = Error & {
  __NEXT_ERROR_CODE?: string;
};

function isReadonlyCookieStoreError(error: unknown) {
  return (
    error instanceof Error &&
    (error as NextCookieWriteError).__NEXT_ERROR_CODE === "E1180"
  );
}

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch (error) {
            // Server Components are read-only; the request proxy owns refreshes.
            if (!isReadonlyCookieStoreError(error)) {
              throw error;
            }
          }
        },
      },
    },
  );
}
