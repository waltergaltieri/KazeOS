import { notFound } from "next/navigation";

import { ChargeForm } from "@/components/charges/charge-form";
import { todayInBusinessZone } from "@/lib/domain/commercial-date";
import { updateChargeAction } from "@/lib/actions/charges";
import { getChargeById } from "@/lib/queries/charges";

export default async function EditChargePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const charge = await getChargeById(id, todayInBusinessZone(new Date()));

  if (
    !charge ||
    charge.generatedAutomatically ||
    charge.persistedStatus !== "pending" ||
    charge.amountPaidMinor !== 0
  ) {
    notFound();
  }

  return (
    <main className="charge-editor-page">
      <header className="page-heading">
        <p className="eyebrow">Corrección de asiento manual</p>
        <h1>Editar cobro</h1>
        <p>El cliente permanece fijo para conservar la trazabilidad.</p>
      </header>
      <ChargeForm
        action={updateChargeAction}
        mode="edit"
        chargeId={charge.id}
        clients={[{ id: charge.clientId, displayName: charge.clientName }]}
        selectedClientId={charge.clientId}
        defaults={{
          description: charge.description,
          amountMinor: charge.amountMinor,
          currency: charge.currency,
          dueDate: charge.dueDate,
        }}
      />
    </main>
  );
}
