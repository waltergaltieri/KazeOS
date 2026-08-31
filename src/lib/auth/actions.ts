"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { createActionClient } from "@/lib/supabase/server";

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

export type LoginState =
  | {
      status: "error";
      message: string;
      fieldErrors?: Partial<Record<"email" | "password", string>>;
    }
  | undefined;

export async function login(
  _previousState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const result = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!result.success) {
    const flattened = z.flattenError(result.error).fieldErrors;

    return {
      status: "error",
      message: "Revisá el email y la contraseña.",
      fieldErrors: {
        email: flattened.email?.[0],
        password: flattened.password?.[0],
      },
    };
  }

  let loginFailed = false;

  try {
    const supabase = await createActionClient();
    const { error } = await supabase.auth.signInWithPassword(result.data);
    loginFailed = Boolean(error);
  } catch {
    loginFailed = true;
  }

  if (loginFailed) {
    return {
      status: "error",
      message:
        "No pudimos iniciar sesión. Verificá tus datos e intentá de nuevo.",
    };
  }

  redirect("/dashboard");
}

export async function logout() {
  try {
    const supabase = await createActionClient();
    await supabase.auth.signOut();
  } catch {
    // The redirect clears the current app flow without exposing provider details.
  }
  redirect("/login");
}
