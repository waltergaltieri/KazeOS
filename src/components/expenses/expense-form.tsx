"use client";

import { CalendarClock, LoaderCircle, Repeat2, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useMemo, useState } from "react";

import { CurrencyAmountInput } from "@/components/ui/currency-amount-input";
import { LedgerSelect } from "@/components/ui/ledger-select";
import { MiniDatePicker } from "@/components/ui/mini-date-picker";

type ExpenseFormState = {
  status: "idle" | "error" | "success";
  message?: string;
  expenseId?: string;
  recurringExpenseId?: string;
  fieldErrors?: Record<string, string[]>;
};

type ExpenseFormAction = (
  state: ExpenseFormState,
  data: FormData,
) => Promise<ExpenseFormState>;

interface ExpenseFormProps {
  oneOffAction?: ExpenseFormAction;
  recurringAction?: ExpenseFormAction;
  categories: ExpenseCategoryOption[];
  defaultCurrency?: "USD" | "ARS";
  defaults?: ExpenseFormDefaults;
  mode?: "create" | "edit" | "recurring-edit";
  forceRecurring?: boolean;
}

type ExpenseCategoryOption = {
  id: string;
  name: string;
  icon: string | null;
  active: boolean;
};

export interface ExpenseFormDefaults {
  id?: string;
  recurringExpenseId?: string;
  title?: string;
  description?: string | null;
  amountMinor?: number;
  currency?: "USD" | "ARS";
  categoryId?: string;
  scope?: "personal" | "business" | "family" | "friends" | "partner" | "other";
  costType?: "fixed" | "variable";
  dueDate?: string;
  paidDate?: string | null;
  status?: "planned" | "pending" | "paid";
  paymentMethod?: string | null;
  vendor?: string | null;
  notes?: string | null;
  frequency?: "monthly" | "quarterly" | "yearly" | "one_time";
  billingDay?: number;
  startDate?: string;
  endDate?: string | null;
  automaticGeneration?: boolean;
}

const initialState: ExpenseFormState = { status: "idle" };

async function unavailableAction(): Promise<ExpenseFormState> {
  return { status: "error", message: "Este flujo no está disponible." };
}

function amountInputValue(amountMinor?: number) {
  if (amountMinor === undefined) return "";
  return `${Math.floor(amountMinor / 100)},${String(amountMinor % 100).padStart(2, "0")}`;
}

function billingDayFromDate(date: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? String(Number(date.slice(8, 10))) : "";
}

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? <small id={id} className="field-error">{message}</small> : null;
}

export function ExpenseForm(props: ExpenseFormProps) {
  const defaults = props.defaults ?? {};
  const resetKey = JSON.stringify({
    categories: props.categories.map(({ id, active }) => [id, active]),
    defaultCurrency: props.defaultCurrency ?? "USD",
    defaults,
    forceRecurring: props.forceRecurring ?? false,
    mode: props.mode ?? "create",
  });

  return <ExpenseFormFields key={resetKey} {...props} defaults={defaults} />;
}

function ExpenseFormFields({
  oneOffAction,
  recurringAction,
  categories,
  defaultCurrency = "USD",
  defaults = {},
  mode = "create",
  forceRecurring = false,
}: ExpenseFormProps) {
  const router = useRouter();
  const [oneOffState, oneOffFormAction, oneOffPending] = useActionState(
    oneOffAction ?? unavailableAction,
    initialState,
  );
  const [recurringState, recurringFormAction, recurringPending] = useActionState(
    recurringAction ?? unavailableAction,
    initialState,
  );
  const [recurringChoice, setRecurringChoice] = useState(forceRecurring);
  const [currency, setCurrency] = useState(defaults.currency ?? defaultCurrency);
  const [status, setStatus] = useState(forceRecurring ? "pending" : defaults.status ?? "pending");
  const [title, setTitle] = useState(defaults.title ?? "");
  const [description, setDescription] = useState(defaults.description ?? "");
  const [vendor, setVendor] = useState(defaults.vendor ?? "");
  const [notes, setNotes] = useState(defaults.notes ?? "");
  const [dueDate, setDueDate] = useState(defaults.dueDate ?? "");
  const [paidDate, setPaidDate] = useState(defaults.paidDate ?? "");
  const [endDate, setEndDate] = useState(defaults.endDate ?? "");
  const [automaticGeneration, setAutomaticGeneration] = useState(
    defaults.automaticGeneration ?? true,
  );
  const recurring = forceRecurring || recurringChoice;
  const state = recurring ? recurringState : oneOffState;
  const pending = recurring ? recurringPending : oneOffPending;
  const formAction = recurring ? recurringFormAction : oneOffFormAction;
  const editing = mode !== "create";
  const error = (field: string) => state.fieldErrors?.[field]?.[0];
  const dueDateError = error("dueDate") ?? (
    recurring ? error("startDate") ?? error("billingDay") : undefined
  );

  useEffect(() => {
    if (state.status === "success") router.replace("/expenses");
  }, [router, state]);

  const categoryOptions = useMemo(() => {
    return categories
      .filter((category) => category.active || (editing && category.id === defaults.categoryId))
      .map((category) => ({
        value: category.id,
        label: `${category.icon ? `${category.icon} ` : ""}${category.name}${category.active ? "" : " · inactiva"}`,
      }));
  }, [categories, defaults.categoryId, editing]);

  const categoryValue = categoryOptions.some((option) => option.value === defaults.categoryId)
    ? defaults.categoryId
    : categoryOptions[0]?.value;

  return (
    <form action={formAction} className="charge-form expense-form" noValidate>
      {mode === "edit" && defaults.id ? (
        <input type="hidden" name="expenseId" value={defaults.id} />
      ) : null}
      {mode === "recurring-edit" && defaults.recurringExpenseId ? (
        <input type="hidden" name="recurringExpenseId" value={defaults.recurringExpenseId} />
      ) : null}

      <section className="form-sheet" role="group" aria-labelledby="expense-obligation-heading">
        <header className="form-sheet__heading">
          <span>01</span>
          <div>
            <h2 id="expense-obligation-heading">Datos de la obligación</h2>
            <p>Importe, clasificación y vencimiento en un único asiento.</p>
          </div>
        </header>
        <div className="form-grid form-grid--two">
          <label className="field-stack">
            <span>Título *</span>
            <input
              className="form-control"
              name="title"
              required
              autoFocus
              maxLength={200}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              aria-invalid={Boolean(error("title")) || undefined}
              aria-describedby={error("title") ? "expense-title-error" : undefined}
            />
            <FieldError id="expense-title-error" message={error("title")} />
          </label>

          <label className="field-stack">
            <span>Monto *</span>
            <CurrencyAmountInput
              currency={currency}
              defaultValue={amountInputValue(defaults.amountMinor)}
              error={error("amount")}
            />
          </label>

          <div className="field-stack">
            <span>Moneda *</span>
            <LedgerSelect
              name="currency"
              label="Moneda"
              required
              defaultValue={currency}
              onValueChange={(value) => setCurrency(value as "USD" | "ARS")}
              error={error("currency")}
              options={[
                { value: "USD", label: "USD" },
                { value: "ARS", label: "ARS" },
              ]}
            />
            <FieldError id="expense-currency-error" message={error("currency")} />
          </div>

          <div className="field-stack">
            <span>Categoría *</span>
            <LedgerSelect
              name="categoryId"
              label="Categoría"
              required
              defaultValue={categoryValue}
              error={error("categoryId")}
              options={categoryOptions}
            />
            <FieldError id="expense-category-error" message={error("categoryId")} />
          </div>

          <div className="field-stack">
            <span>Ámbito *</span>
            <LedgerSelect
              name="scope"
              label="Ámbito"
              required
              defaultValue={defaults.scope ?? "personal"}
              error={error("scope")}
              options={[
                { value: "personal", label: "Personal" },
                { value: "business", label: "Negocio" },
                { value: "family", label: "Familia" },
                { value: "friends", label: "Amigos" },
                { value: "partner", label: "Pareja" },
                { value: "other", label: "Otro" },
              ]}
            />
            <FieldError id="expense-scope-error" message={error("scope")} />
          </div>

          <div className="field-stack">
            <span>Tipo de costo *</span>
            <LedgerSelect
              name="costType"
              label="Tipo de costo"
              required
              defaultValue={defaults.costType ?? "variable"}
              error={error("costType")}
              options={[
                { value: "fixed", label: "Fijo" },
                { value: "variable", label: "Variable" },
              ]}
            />
            <FieldError id="expense-cost-type-error" message={error("costType")} />
          </div>

          <div className="field-stack">
            <span>Vencimiento *</span>
            <MiniDatePicker
              name="dueDate"
              label="Vencimiento"
              required
              defaultValue={dueDate}
              error={dueDateError}
              onValueChange={setDueDate}
            />
          </div>
        </div>
      </section>

      {mode !== "edit" ? (
        <section className="form-sheet" aria-labelledby="expense-recurrence-heading">
          <header className="form-sheet__heading">
            <span><Repeat2 size={15} aria-hidden="true" /></span>
            <div>
              <h2 id="expense-recurrence-heading">Recurrencia</h2>
              <p>Convertí la obligación en una regla sólo cuando se repita.</p>
            </div>
          </header>
          {forceRecurring ? <input type="hidden" name="recurring" value="true" /> : (
            <label className="automation-switch">
              <input
                type="checkbox"
                name="recurring"
                checked={recurringChoice}
                onChange={(event) => {
                  setRecurringChoice(event.target.checked);
                  if (event.target.checked) setStatus("pending");
                }}
                aria-label="Repetir este gasto"
              />
              <span>
                <strong>Repetir este gasto</strong>
                <small>Proyecta vencimientos sin duplicar períodos.</small>
              </span>
            </label>
          )}

          {recurring ? (
            <div className="form-grid form-grid--two" role="group" aria-label="Regla de recurrencia">
              <div className="field-stack">
                <span>Frecuencia *</span>
                <LedgerSelect
                  name="frequency"
                  label="Frecuencia"
                  required
                  defaultValue={defaults.frequency === "one_time" ? "monthly" : defaults.frequency ?? "monthly"}
                  error={error("frequency")}
                  options={[
                    { value: "monthly", label: "Mensual" },
                    { value: "quarterly", label: "Trimestral" },
                    { value: "yearly", label: "Anual" },
                  ]}
                />
                <FieldError id="expense-frequency-error" message={error("frequency")} />
              </div>
              <input
                type="hidden"
                name="billingDay"
                value={billingDayFromDate(dueDate)}
              />
              <div className="field-stack">
                <span>Fin opcional</span>
                <MiniDatePicker
                  name="endDate"
                  label="Fin"
                  required={false}
                  defaultValue={endDate}
                  error={error("endDate")}
                  onValueChange={setEndDate}
                />
              </div>
              <label className="automation-switch">
                <input
                  type="checkbox"
                  name="automaticGeneration"
                  checked={automaticGeneration}
                  onChange={(event) => setAutomaticGeneration(event.target.checked)}
                  aria-label="Generar vencimientos automáticamente"
                />
                <span>
                  <strong>Generación automática</strong>
                  <small>Mantiene tres meses proyectados de forma idempotente.</small>
                </span>
              </label>
            </div>
          ) : null}
        </section>
      ) : <input type="hidden" name="recurring" value="false" />}

      <details className="form-sheet">
        <summary>Información adicional</summary>
        <div className="form-grid form-grid--two">
          <label className="field-stack">
            <span>Descripción</span>
            <textarea className="form-control" name="description" rows={3} maxLength={2_000} value={description} onChange={(event) => setDescription(event.target.value)} />
          </label>
          <label className="field-stack">
            <span>Proveedor</span>
            <input className="form-control" name="vendor" maxLength={200} value={vendor} onChange={(event) => setVendor(event.target.value)} />
          </label>
          <div className="field-stack">
            <span>Estado</span>
            <LedgerSelect
              key={recurring ? "recurring-status" : "one-off-status"}
              name="status"
              label="Estado"
              defaultValue={status}
              onValueChange={(value) => setStatus(value as typeof status)}
              error={error("status")}
              options={[
                { value: "pending", label: "Pendiente" },
                { value: "planned", label: "Planificado" },
                ...(!recurring && mode === "create"
                  ? [{ value: "paid", label: "Pagado" }]
                  : []),
              ]}
            />
          </div>
          {status === "paid" ? (
            <>
              <div className="field-stack">
                <span>Fecha de pago *</span>
                <MiniDatePicker
                  name="paidDate"
                  label="Fecha de pago"
                  required
                  defaultValue={paidDate}
                  error={error("paidDate")}
                  onValueChange={setPaidDate}
                />
              </div>
              <div className="field-stack">
                <span>Método de pago *</span>
                <LedgerSelect
                  name="paymentMethod"
                  label="Método de pago"
                  required
                  defaultValue={defaults.paymentMethod ?? ""}
                  error={error("paymentMethod")}
                  options={[
                    { value: "", label: "Sin especificar" },
                    { value: "bank_transfer", label: "Transferencia bancaria" },
                    { value: "cash", label: "Efectivo" },
                    { value: "mercadopago", label: "Mercado Pago" },
                    { value: "debit_card", label: "Tarjeta de débito" },
                    { value: "credit_card", label: "Tarjeta de crédito" },
                    { value: "paypal", label: "PayPal" },
                    { value: "payoneer", label: "Payoneer" },
                    { value: "stripe", label: "Stripe" },
                    { value: "crypto", label: "Cripto" },
                    { value: "other", label: "Otro" },
                  ]}
                />
              </div>
            </>
          ) : <input type="hidden" name="paidDate" value="" />}
          <label className="field-stack">
            <span>Notas</span>
            <textarea className="form-control" name="notes" rows={3} maxLength={2_000} value={notes} onChange={(event) => setNotes(event.target.value)} />
          </label>
        </div>
      </details>

      {state.status === "error" && state.message ? (
        <p className="form-error" role="alert">{state.message}</p>
      ) : null}
      <footer className="client-form__actions">
        <button className="primary-button" type="submit" disabled={pending}>
          {pending ? <LoaderCircle className="spin" size={17} aria-hidden="true" /> : recurring ? <CalendarClock size={17} aria-hidden="true" /> : <Save size={17} aria-hidden="true" />}
          {pending
            ? "Guardando…"
            : mode === "recurring-edit" || mode === "edit"
              ? "Guardar cambios"
              : recurring
                ? "Guardar recurrencia"
                : "Guardar gasto"}
        </button>
      </footer>
    </form>
  );
}
