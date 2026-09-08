import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  LOGIN_FAILURE_MESSAGE,
  LOGIN_VALIDATION_MESSAGE,
  type LoginError,
  type LoginSuccess,
} from "@/lib/auth/contracts";
import { safeLocalPath } from "@/lib/auth/safe-local-path";
import { rejectUntrustedOrigin } from "@/lib/auth/same-origin";
import { createResponseClient } from "@/lib/supabase/response";

const credentialsSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Ingresá un email válido."),
  password: z
    .string()
    .min(8, "La contraseña debe tener al menos 8 caracteres."),
});

const AUTH_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Expires: "0",
  Pragma: "no-cache",
};

function jsonResponse(body: LoginError | LoginSuccess, status: number) {
  return NextResponse.json(body, {
    status,
    headers: AUTH_NO_STORE_HEADERS,
  });
}

export async function POST(request: NextRequest) {
  const originRejection = rejectUntrustedOrigin(request);
  if (originRejection) return originRejection;

  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return jsonResponse(
      { status: "error", message: LOGIN_VALIDATION_MESSAGE },
      400,
    );
  }

  const result = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!result.success) {
    const flattened = z.flattenError(result.error).fieldErrors;

    return jsonResponse(
      {
        status: "error",
        message: LOGIN_VALIDATION_MESSAGE,
        fieldErrors: {
          email: flattened.email?.[0],
          password: flattened.password?.[0],
        },
      },
      400,
    );
  }

  let responseClient: ReturnType<typeof createResponseClient>;

  try {
    responseClient = createResponseClient(request);
  } catch {
    return jsonResponse(
      { status: "error", message: LOGIN_FAILURE_MESSAGE },
      503,
    );
  }

  try {
    const { error } = await responseClient.client.auth.signInWithPassword(
      result.data,
    );

    if (error) {
      return responseClient.applyTo(
        jsonResponse(
          { status: "error", message: LOGIN_FAILURE_MESSAGE },
          401,
        ),
      );
    }

    return responseClient.applyTo(
      jsonResponse({ redirectTo: safeLocalPath(formData.get("next")) }, 200),
    );
  } catch {
    return responseClient.applyTo(
      jsonResponse(
        { status: "error", message: LOGIN_FAILURE_MESSAGE },
        503,
      ),
    );
  }
}
