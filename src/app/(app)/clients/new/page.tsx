import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { ClientForm } from "@/components/clients/client-form";
import { createClientAction } from "@/lib/actions/clients";

export default function NewClientPage() {
  return (
    <main className="client-editor-page">
      <Link className="back-link" href="/clients"><ArrowLeft size={16} aria-hidden="true" /> Volver a clientes</Link>
      <header className="page-heading"><p className="eyebrow">Alta de legajo</p><h1>Nuevo cliente</h1><p>Cargá lo esencial ahora; el resto puede completarse después.</p></header>
      <ClientForm action={createClientAction} />
    </main>
  );
}
