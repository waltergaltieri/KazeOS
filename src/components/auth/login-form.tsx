"use client";

import { Eye, EyeOff, LoaderCircle, LockKeyhole, Mail } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useId, useState } from "react";

import {
  LOGIN_FAILURE_MESSAGE,
  LOGIN_VALIDATION_MESSAGE,
  type LoginError,
} from "@/lib/auth/contracts";

function safeLocalPath(value: unknown) {
  return typeof value === "string" &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("\\")
    ? value
    : "/dashboard";
}

export function LoginForm() {
  const router = useRouter();
  const [state, setState] = useState<LoginError>();
  const [pending, setPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const emailErrorId = useId();
  const passwordErrorId = useId();
  const formErrorId = useId();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setState(undefined);

    try {
      const response = await fetch("/auth/login", {
        method: "POST",
        body: new FormData(event.currentTarget),
      });
      const payload = (await response.json()) as unknown;

      if (response.ok) {
        const redirectTo =
          typeof payload === "object" && payload !== null
            ? (payload as { redirectTo?: unknown }).redirectTo
            : undefined;
        router.replace(safeLocalPath(redirectTo));
        router.refresh();
        return;
      }

      if (
        response.status === 400 &&
        typeof payload === "object" &&
        payload !== null
      ) {
        const fieldErrors = (payload as { fieldErrors?: unknown }).fieldErrors;
        const errors =
          typeof fieldErrors === "object" && fieldErrors !== null
            ? (fieldErrors as Record<string, unknown>)
            : undefined;

        setState({
          status: "error",
          message: LOGIN_VALIDATION_MESSAGE,
          fieldErrors: {
            email:
              typeof errors?.email === "string" ? errors.email : undefined,
            password:
              typeof errors?.password === "string"
                ? errors.password
                : undefined,
          },
        });
      } else {
        setState({ status: "error", message: LOGIN_FAILURE_MESSAGE });
      }
    } catch {
      setState({ status: "error", message: LOGIN_FAILURE_MESSAGE });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="login-form" noValidate>
      <div className="field-stack">
        <label htmlFor="email">Email</label>
        <div className="inset-control">
          <Mail aria-hidden="true" size={18} strokeWidth={1.8} />
          <input
            id="email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="vos@empresa.com"
            aria-invalid={Boolean(state?.fieldErrors?.email)}
            aria-describedby={state?.fieldErrors?.email ? emailErrorId : undefined}
            required
          />
        </div>
        {state?.fieldErrors?.email ? (
          <p className="field-error" id={emailErrorId}>
            {state.fieldErrors.email}
          </p>
        ) : null}
      </div>

      <div className="field-stack">
        <div className="field-heading">
          <label htmlFor="password">Contraseña</label>
        </div>
        <div className="inset-control">
          <LockKeyhole aria-hidden="true" size={18} strokeWidth={1.8} />
          <input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            placeholder="Tu contraseña"
            aria-invalid={Boolean(state?.fieldErrors?.password)}
            aria-describedby={
              state?.fieldErrors?.password ? passwordErrorId : undefined
            }
            required
          />
          <button
            type="button"
            className="icon-button control-icon"
            aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
            aria-pressed={showPassword}
            onClick={() => setShowPassword((visible) => !visible)}
          >
            {showPassword ? (
              <EyeOff aria-hidden="true" size={18} />
            ) : (
              <Eye aria-hidden="true" size={18} />
            )}
          </button>
        </div>
        {state?.fieldErrors?.password ? (
          <p className="field-error" id={passwordErrorId}>
            {state.fieldErrors.password}
          </p>
        ) : null}
      </div>

      {state?.message ? (
        <p className="form-error" id={formErrorId} role="alert">
          {state.message}
        </p>
      ) : null}

      <button
        type="submit"
        className="primary-button login-submit"
        disabled={pending}
        aria-describedby={state?.message ? formErrorId : undefined}
      >
        {pending ? (
          <>
            <LoaderCircle className="spin" aria-hidden="true" size={18} />
            Verificando…
          </>
        ) : (
          "Iniciar sesión"
        )}
      </button>
    </form>
  );
}
