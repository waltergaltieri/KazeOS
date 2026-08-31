export const LOGIN_VALIDATION_MESSAGE =
  "Revisá el email y la contraseña.";

export const LOGIN_FAILURE_MESSAGE =
  "No pudimos iniciar sesión. Verificá tus datos e intentá de nuevo.";

export type LoginError = {
  status: "error";
  message: string;
  fieldErrors?: Partial<Record<"email" | "password", string>>;
};

export type LoginSuccess = {
  redirectTo: string;
};
