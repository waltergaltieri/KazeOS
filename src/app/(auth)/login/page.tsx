import { ArrowRight, CheckCircle2, CircleDollarSign } from "lucide-react";

import { LoginForm } from "@/components/auth/login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <main className="login-page">
      <section className="login-context" aria-labelledby="login-context-title">
        <div className="brand-lockup brand-lockup--login">
          <span className="brand-mark" aria-hidden="true">
            K
          </span>
          <span>
            <strong>KazeOS</strong>
            <small>Clientes · Cobros · Tareas</small>
          </span>
        </div>

        <div className="login-context-copy">
          <p className="eyebrow">Tu negocio, en orden</p>
          <h1 id="login-context-title">
            Cobros y compromisos en una sola bitácora.
          </h1>
          <p>
            Entrá para revisar qué se movió, qué vence y dónde necesitás actuar.
          </p>
        </div>

        <div className="movement-preview" aria-hidden="true">
          <div className="movement-preview__line" />
          <div className="movement-preview__item is-collected">
            <span><CheckCircle2 size={16} /></span>
            <div><strong>Cobros registrados</strong><small>Historial verificable</small></div>
          </div>
          <div className="movement-preview__item is-next">
            <span><ArrowRight size={16} /></span>
            <div><strong>Próximos vencimientos</strong><small>Agenda comercial</small></div>
          </div>
          <div className="movement-preview__item is-balance">
            <span><CircleDollarSign size={16} /></span>
            <div><strong>Saldos por moneda</strong><small>Sin mezclar USD y ARS</small></div>
          </div>
        </div>
      </section>

      <section className="login-access" aria-labelledby="login-title">
        <div className="login-card">
          <div className="login-card__heading">
            <p className="eyebrow">Acceso protegido</p>
            <h2 id="login-title">Bienvenido de nuevo</h2>
            <p>Usá el email y la contraseña de tu cuenta.</p>
          </div>
          <LoginForm redirectTo={next} />
          <p className="login-help">
            Tu sesión se mantiene de forma segura en este dispositivo.
          </p>
        </div>
      </section>
    </main>
  );
}
