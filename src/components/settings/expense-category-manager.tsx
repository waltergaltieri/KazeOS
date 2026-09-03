"use client";

import {
  FolderCog,
  LoaderCircle,
  Pencil,
  Plus,
  Power,
  RotateCcw,
  Save,
  Tag,
  X,
} from "lucide-react";
import {
  useActionState,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import {
  createExpenseCategoryAction,
  toggleExpenseCategoryAction,
  updateExpenseCategoryAction,
  type ExpenseCategoryActionState,
} from "@/lib/actions/expense-categories";
import type { ExpenseCategoryListItem } from "@/lib/queries/expense-categories";

const initialState: ExpenseCategoryActionState = { status: "idle" };

function CategoryFeedback({
  state,
  successMessage,
}: {
  state: ExpenseCategoryActionState;
  successMessage: string;
}) {
  if (state.status === "idle") return null;
  const message = state.status === "success" ? successMessage : state.message;
  if (!message) return null;

  return (
    <p
      className={state.status === "error" ? "form-error" : "form-success"}
      role={state.status === "error" ? "alert" : "status"}
    >
      {message}
    </p>
  );
}

function CreateCategoryForm() {
  const [state, action, pending] = useActionState(
    createExpenseCategoryAction,
    initialState,
  );
  const nameError = state.fieldErrors?.name?.[0];
  const iconError = state.fieldErrors?.icon?.[0];

  return (
    <form action={action} className="expense-category-create">
      <div className="field-stack">
        <label htmlFor="new-expense-category-name">Nombre de la nueva categoría</label>
        <input
          aria-describedby={nameError ? "new-expense-category-name-error" : undefined}
          aria-invalid={Boolean(nameError)}
          className="form-control"
          id="new-expense-category-name"
          maxLength={100}
          name="name"
          placeholder="Ej. Comisiones"
          required
        />
        {nameError ? (
          <small className="field-error" id="new-expense-category-name-error">
            {nameError}
          </small>
        ) : null}
      </div>
      <div className="field-stack">
        <label htmlFor="new-expense-category-icon">Icono opcional</label>
        <input
          aria-describedby={iconError ? "new-expense-category-icon-error" : "new-expense-category-icon-note"}
          aria-invalid={Boolean(iconError)}
          className="form-control"
          id="new-expense-category-icon"
          maxLength={100}
          name="icon"
          placeholder="Ej. Receipt"
        />
        {iconError ? (
          <small className="field-error" id="new-expense-category-icon-error">
            {iconError}
          </small>
        ) : (
          <small className="field-note" id="new-expense-category-icon-note">
            Podés usar un nombre corto o un emoji.
          </small>
        )}
      </div>
      <button
        aria-label={pending ? "Creando categoría" : undefined}
        className="primary-button"
        disabled={pending}
      >
        {pending ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />}
        {pending ? "Creando…" : "Crear categoría"}
      </button>
      <CategoryFeedback state={state} successMessage="Categoría creada." />
    </form>
  );
}

function CategoryEditor({
  category,
  onClose,
}: {
  category: ExpenseCategoryListItem;
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState(
    updateExpenseCategoryAction,
    initialState,
  );
  const nameId = useId();
  const iconId = useId();
  const nameErrorId = `${nameId}-error`;
  const iconErrorId = `${iconId}-error`;
  const nameError = state.fieldErrors?.name?.[0];
  const iconError = state.fieldErrors?.icon?.[0];

  return (
    <form
      action={action}
      aria-label={`Editar ${category.name}`}
      className="expense-category-editor"
      role="group"
    >
      <input name="categoryId" type="hidden" value={category.id} />
      <div className="field-stack">
        <label htmlFor={nameId}>Nombre</label>
        <input
          aria-describedby={nameError ? nameErrorId : undefined}
          aria-invalid={Boolean(nameError)}
          autoFocus
          className="form-control"
          defaultValue={category.name}
          id={nameId}
          maxLength={100}
          name="name"
          required
        />
        {nameError ? <small className="field-error" id={nameErrorId}>{nameError}</small> : null}
      </div>
      <div className="field-stack">
        <label htmlFor={iconId}>Icono opcional</label>
        <input
          aria-describedby={iconError ? iconErrorId : undefined}
          aria-invalid={Boolean(iconError)}
          className="form-control"
          defaultValue={category.icon ?? ""}
          id={iconId}
          maxLength={100}
          name="icon"
        />
        {iconError ? <small className="field-error" id={iconErrorId}>{iconError}</small> : null}
      </div>
      <div className="expense-category-editor__actions">
        <button className="primary-button primary-button--compact" disabled={pending}>
          {pending ? <LoaderCircle className="spin" size={15} /> : <Save size={15} />}
          {pending ? "Guardando…" : "Guardar cambios"}
        </button>
        <button className="quiet-button" disabled={pending} onClick={onClose} type="button">
          <X size={15} /> Cancelar
        </button>
      </div>
      <CategoryFeedback state={state} successMessage="Categoría actualizada." />
    </form>
  );
}

function CategoryToggle({ category }: { category: ExpenseCategoryListItem }) {
  const [confirming, setConfirming] = useState(false);
  async function toggleAction(
    previousState: ExpenseCategoryActionState,
    formData: FormData,
  ) {
    const result = await toggleExpenseCategoryAction(previousState, formData);
    if (result.status === "success") {
      openerRef.current?.focus();
      setConfirming(false);
    }
    return result;
  }
  const [state, action, pending] = useActionState(toggleAction, initialState);
  const openerRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const verb = category.active ? "Desactivar" : "Reactivar";
  const actionName = `${verb} ${category.name}`;

  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);

  function cancel() {
    openerRef.current?.focus();
    setConfirming(false);
  }

  return (
    <div className="expense-category-toggle">
      <button
        aria-expanded={confirming}
        aria-label={actionName}
        className="quiet-button"
        onClick={() => setConfirming(true)}
        ref={openerRef}
        type="button"
      >
        {category.active ? <Power size={15} /> : <RotateCcw size={15} />}
        {verb}
      </button>
      {confirming ? (
        <form
          action={action}
          aria-describedby={descriptionId}
          aria-labelledby={titleId}
          className="expense-category-confirm"
          role="group"
        >
          <input name="categoryId" type="hidden" value={category.id} />
          <input name="active" type="hidden" value={`${!category.active}`} />
          <strong id={titleId}>{actionName}</strong>
          <span id={descriptionId}>
            {category.active
              ? "Seguirá visible en gastos históricos, pero no podrá usarse en gastos nuevos."
              : "Volverá a estar disponible para clasificar gastos nuevos."}
          </span>
          <button
            aria-label={`Confirmar ${category.active ? "desactivación" : "reactivación"}`}
            className={category.active ? "danger-button" : "primary-button primary-button--compact"}
            disabled={pending}
            ref={confirmRef}
          >
            {pending ? <LoaderCircle className="spin" size={15} /> : null}
            {pending ? "Guardando…" : `Confirmar ${category.active ? "desactivación" : "reactivación"}`}
          </button>
          <button className="quiet-button" disabled={pending} onClick={cancel} type="button">
            Volver
          </button>
          {state.status === "error" ? (
            <CategoryFeedback state={state} successMessage="" />
          ) : null}
        </form>
      ) : null}
      {state.status === "success" ? (
        <CategoryFeedback
          state={state}
          successMessage={`${category.name} ${state.active ? "reactivada" : "desactivada"}.`}
        />
      ) : null}
    </div>
  );
}

function CategoryRow({ category }: { category: ExpenseCategoryListItem }) {
  const [editing, setEditing] = useState(false);

  return (
    <li className={category.active ? undefined : "is-inactive"}>
      <span className="expense-category-mark" aria-hidden="true">
        <Tag size={16} />
      </span>
      <div className="expense-category-copy">
        <strong>{category.name}</strong>
        <span>{category.icon ?? "Sin icono"}</span>
      </div>
      <span className={`expense-category-status expense-category-status--${category.active ? "active" : "inactive"}`}>
        {category.active ? "Activa" : "Inactiva"}
      </span>
      {editing ? (
        <CategoryEditor category={category} onClose={() => setEditing(false)} />
      ) : (
        <div className="expense-category-actions">
          <button
            aria-label={`Editar ${category.name}`}
            className="quiet-button"
            onClick={() => setEditing(true)}
            type="button"
          >
            <Pencil size={15} /> Editar
          </button>
          <CategoryToggle category={category} />
        </div>
      )}
    </li>
  );
}

export function ExpenseCategoryManager({
  categories,
}: {
  categories: ExpenseCategoryListItem[];
}) {
  return (
    <section
      aria-labelledby="expense-category-settings-title"
      className="settings-sheet expense-category-manager"
    >
      <header>
        <span aria-hidden="true"><FolderCog size={18} /></span>
        <div>
          <p className="eyebrow">Clasificación</p>
          <h2 id="expense-category-settings-title">Categorías de gastos</h2>
          <p>Organizá tus egresos sin perder la clasificación histórica.</p>
        </div>
      </header>
      <CreateCategoryForm />
      {categories.length ? (
        <ul className="expense-category-list">
          {categories.map((category) => <CategoryRow category={category} key={category.id} />)}
        </ul>
      ) : (
        <div className="expense-category-empty">
          <Tag aria-hidden="true" size={18} />
          <p>Creá una categoría para empezar a ordenar tus gastos.</p>
        </div>
      )}
    </section>
  );
}
