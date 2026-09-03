import { randomUUID } from "node:crypto";

import { expect as baseExpect, test, type Page } from "@playwright/test";
import { config } from "dotenv";
import postgres from "postgres";

import {
  addCommercialPeriod,
  todayInBusinessZone,
} from "../../src/lib/domain/commercial-date";
import {
  formatAggregateMoney,
  type AggregateMinorUnits,
} from "../../src/lib/domain/money";

config({ path: ".env.local", quiet: true });

const expect = baseExpect.configure({ timeout: 30_000 });

const authEmail = process.env.E2E_AUTH_EMAIL;
const authPassword = process.env.E2E_AUTH_PASSWORD;
const cronSecret = process.env.CRON_SECRET;
const cleanupDatabase = process.env.DATABASE_URL
  ? postgres(process.env.DATABASE_URL, { prepare: false, max: 1 })
  : undefined;
const ready = Boolean(
  authEmail && authPassword && cronSecret && cleanupDatabase,
);

type CurrencyTotals = {
  actual_expenses: AggregateMinorUnits;
  actual_income: AggregateMinorUnits;
  actual_net: AggregateMinorUnits;
  projected_expenses: AggregateMinorUnits;
  projected_income: AggregateMinorUnits;
  projected_net: AggregateMinorUnits;
};

async function choose(page: Page, label: string, option: string) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

async function chooseDate(
  page: Page,
  field: "Vencimiento" | "Fin" | "Fecha de pago",
  date: string,
) {
  const [year, month, day] = date.split("-");
  const accessibleDate = `${day}/${month}/${year}`;
  await page.getByRole("combobox", { name: new RegExp(`^${field}:`) }).click();
  await page.getByRole("button", { name: accessibleDate, exact: true }).click();
}

function desktopExpenseRow(page: Page, title: string) {
  return page.locator(".expense-table tbody tr").filter({
    has: page.getByText(title, { exact: true }),
  });
}

function mobileExpenseCard(page: Page, title: string) {
  return page.locator(".expense-card-list article").filter({
    has: page.getByText(title, { exact: true }),
  });
}

async function createExpense(
  page: Page,
  input: {
    amount: string;
    category: string;
    currency?: "USD" | "ARS";
    dueDate: string;
    recurring?: boolean;
    status?: "Pendiente" | "Planificado";
    title: string;
  },
) {
  await page.goto("/expenses/new");
  await page.getByLabel("Título *").fill(input.title);
  await page.getByLabel("Monto *").fill(input.amount);
  if (input.currency) await choose(page, "Moneda", input.currency);
  await choose(page, "Categoría", input.category);
  await choose(page, "Ámbito", "Negocio");
  await choose(page, "Tipo de costo", "Fijo");
  await chooseDate(page, "Vencimiento", input.dueDate);

  if (input.recurring) {
    await page.getByRole("checkbox", { name: "Repetir este gasto" }).check();
    await expect(page.getByRole("group", { name: "Regla de recurrencia" })).toBeVisible();
    await choose(page, "Frecuencia", "Mensual");
    await page
      .getByRole("checkbox", { name: "Generar vencimientos automáticamente" })
      .check();
  } else if (input.status === "Planificado") {
    await page.getByText("Información adicional", { exact: true }).click();
    await choose(page, "Estado", "Planificado");
  }

  await page
    .getByRole("button", {
      name: input.recurring ? "Guardar recurrencia" : "Guardar gasto",
    })
    .click();
  await expect(page).toHaveURL(/\/expenses$/);
}

async function readCashFlow(
  ownerId: string,
  monthStart: string,
  monthEnd: string,
  currency: "USD" | "ARS",
): Promise<CurrencyTotals> {
  const [row] = await cleanupDatabase!<CurrencyTotals[]>`
    select
      coalesce((select sum(amount_minor) from charges
        where owner_id = ${ownerId} and currency = ${currency} and status <> 'cancelled'
          and due_date >= ${monthStart} and due_date < ${monthEnd}), 0)::text as projected_income,
      coalesce((select sum(amount_minor) from payments
        where owner_id = ${ownerId} and currency = ${currency}
          and payment_date >= ${monthStart} and payment_date < ${monthEnd}), 0)::text as actual_income,
      coalesce((select sum(amount_minor) from expenses
        where owner_id = ${ownerId} and currency = ${currency} and status <> 'cancelled'
          and due_date >= ${monthStart} and due_date < ${monthEnd}), 0)::text as projected_expenses,
      coalesce((select sum(amount_minor) from expenses
        where owner_id = ${ownerId} and currency = ${currency} and status = 'paid'
          and paid_date >= ${monthStart} and paid_date < ${monthEnd}), 0)::text as actual_expenses,
      (coalesce((select sum(amount_minor) from charges
        where owner_id = ${ownerId} and currency = ${currency} and status <> 'cancelled'
          and due_date >= ${monthStart} and due_date < ${monthEnd}), 0)
       - coalesce((select sum(amount_minor) from expenses
        where owner_id = ${ownerId} and currency = ${currency} and status <> 'cancelled'
          and due_date >= ${monthStart} and due_date < ${monthEnd}), 0))::text as projected_net,
      (coalesce((select sum(amount_minor) from payments
        where owner_id = ${ownerId} and currency = ${currency}
          and payment_date >= ${monthStart} and payment_date < ${monthEnd}), 0)
       - coalesce((select sum(amount_minor) from expenses
        where owner_id = ${ownerId} and currency = ${currency} and status = 'paid'
          and paid_date >= ${monthStart} and paid_date < ${monthEnd}), 0))::text as actual_net
  `;

  if (!row) throw new Error("Expected one cash-flow aggregate row");
  return row;
}

test.afterAll(async () => cleanupDatabase?.end());

test("protects the expense ledger from unauthenticated access", async ({ page }) => {
  await page.goto("/expenses");
  await expect(page).toHaveURL(/\/login\?next=%2Fexpenses$/);
  await expect(page.getByRole("heading", { name: "Bienvenido de nuevo" })).toBeVisible();
});

test.describe("authenticated expense acceptance flow", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(
    !ready,
    "Pendiente externo: requiere credenciales E2E, DATABASE_URL y CRON_SECRET.",
  );

  test("manages one-off and recurring expenses on desktop and mobile without duplicates", async ({
    page,
    request,
  }) => {
    test.setTimeout(300_000);
    const marker = randomUUID();
    const categoryName = `Aceptación E2E ${marker}`;
    const plannedTitle = `Planificado E2E ${marker}`;
    const copyTitle = `Copia E2E ${marker}`;
    const editedCopyTitle = `Copia editada E2E ${marker}`;
    const recurringTitle = `Recurrente E2E ${marker}`;
    const editedRecurringTitle = `Recurrente actualizado E2E ${marker}`;
    const arsTitle = `Pesos E2E ${marker}`;
    const mobileTitle = `Móvil pagado E2E ${marker}`;
    const disposableTitle = `Descartable E2E ${marker}`;
    const today = todayInBusinessZone(new Date());
    const monthStart = `${today.slice(0, 7)}-01`;
    const monthEnd = addCommercialPeriod(monthStart, "monthly");
    let categoryId: string | undefined;
    let ownerId: string | undefined;

    try {
      await page.goto("/login?next=%2Fsettings");
      await page.getByLabel("Email").fill(authEmail!);
      await page.getByLabel("Contraseña", { exact: true }).fill(authPassword!);
      await page.getByRole("button", { name: "Iniciar sesión" }).click();
      await expect(page).toHaveURL(/\/dashboard$/);
      await page.goto("/settings");
      await expect(page).toHaveURL(/\/settings$/);

      await page.getByLabel("Nombre de la nueva categoría").fill(categoryName);
      const categoryMutation = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname === "/settings",
      );
      await page.getByRole("button", { name: "Crear categoría" }).click();
      const categoryResponse = await categoryMutation;
      expect(categoryResponse.ok()).toBe(true);

      await expect.poll(async () => {
        const rows = await cleanupDatabase!`
          select id, owner_id from expense_categories where name = ${categoryName}
        `;
        return rows.length;
      }, { timeout: 30_000 }).toBe(1);
      await expect(page.getByRole("status")).toHaveText("Categoría creada.");
      await expect(page.getByText(categoryName, { exact: true })).toBeVisible();
      const [createdCategory] = await cleanupDatabase!`
        select id, owner_id from expense_categories where name = ${categoryName}
      `;
      categoryId = createdCategory!.id as string;
      ownerId = createdCategory!.owner_id as string;

      await page.getByRole("link", { name: "Gastos", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Gastos", exact: true })).toBeVisible();

      await createExpense(page, {
        amount: "123,45",
        category: categoryName,
        dueDate: today,
        status: "Planificado",
        title: plannedTitle,
      });
      const plannedRow = desktopExpenseRow(page, plannedTitle);
      await expect(plannedRow).toBeVisible();
      await expect(plannedRow).toContainText(categoryName);
      await expect(plannedRow).toContainText("Negocio");
      await expect(plannedRow).toContainText("Fijo");
      await expect(plannedRow).toContainText("Planificado");
      await expect(plannedRow).toContainText("USD 123,45");
      await expect(page.getByLabel("Resumen de gastos USD")).toContainText("Proyectado");

      await page.getByRole("searchbox", { name: "Buscar gastos" }).fill(plannedTitle);
      await page.getByRole("button", { name: "Buscar" }).click();
      await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe(plannedTitle);
      await expect(desktopExpenseRow(page, plannedTitle)).toBeVisible();

      await desktopExpenseRow(page, plannedTitle)
        .getByRole("link", { name: `Duplicar gasto ${plannedTitle}` })
        .click();
      await expect(page.getByRole("heading", { name: "Duplicar gasto" })).toBeVisible();
      await page.getByLabel("Título *").fill(copyTitle);
      await page.getByRole("button", { name: "Guardar gasto" }).click();
      await expect(page).toHaveURL(/\/expenses$/);

      await desktopExpenseRow(page, copyTitle)
        .getByRole("link", { name: `Editar gasto ${copyTitle}` })
        .click();
      await page.getByLabel("Título *").fill(editedCopyTitle);
      await page.getByLabel("Monto *").fill("66,00");
      await page.getByRole("button", { name: "Guardar cambios" }).click();
      await expect(page).toHaveURL(/\/expenses$/);
      await expect(desktopExpenseRow(page, editedCopyTitle)).toContainText("USD 66,00");

      await desktopExpenseRow(page, plannedTitle)
        .getByRole("button", { name: `Registrar pago de ${plannedTitle}` })
        .click();
      await expect(page.getByRole("heading", { name: `Registrar pago de ${plannedTitle}` })).toBeVisible();
      await choose(page, "Método de pago", "Transferencia");
      await page.getByRole("button", { name: "Registrar pago", exact: true }).click();
      await expect(desktopExpenseRow(page, plannedTitle)).toContainText("Pagado");

      await createExpense(page, {
        amount: "77,00",
        category: categoryName,
        dueDate: today,
        recurring: true,
        title: recurringTitle,
      });
      await page.goto(`/expenses?period=all&q=${encodeURIComponent(recurringTitle)}&currency=USD`);
      await expect(page.getByText("3 gastos", { exact: true })).toBeVisible();
      await expect(desktopExpenseRow(page, recurringTitle)).toHaveCount(3);

      for (let run = 0; run < 2; run += 1) {
        const response = await request.get("/api/cron/generate-charges", {
          headers: { Authorization: `Bearer ${cronSecret}` },
        });
        expect(response.ok()).toBe(true);
        expect((await response.json()).expenses).toEqual(
          expect.objectContaining({ eligibleTemplates: expect.any(Number) }),
        );
        await expect.poll(async () => Number((await cleanupDatabase!`
          select count(*)::int as count from expenses
          where recurring_expense_id = (
            select id from recurring_expenses where category_id = ${categoryId!}
              and title = ${recurringTitle}
          )
        `)[0]?.count)).toBe(3);
      }

      const currentRecurringRow = desktopExpenseRow(page, recurringTitle).filter({
        has: page.locator(`time[datetime="${today}"]`),
      });
      await currentRecurringRow
        .getByRole("button", { name: `Registrar pago de ${recurringTitle}` })
        .click();
      await choose(page, "Método de pago", "Efectivo");
      await page.getByRole("button", { name: "Registrar pago", exact: true }).click();
      await expect(currentRecurringRow).toContainText("Pagado");

      await currentRecurringRow
        .getByRole("link", { name: `Editar recurrencia de ${recurringTitle}` })
        .click();
      await expect(page.getByRole("heading", { name: "Editar gasto recurrente" })).toBeVisible();
      await page.getByLabel("Título *").fill(editedRecurringTitle);
      await page.getByLabel("Monto *").fill("88,00");
      await page.getByRole("button", { name: "Guardar cambios" }).click();
      await expect(page).toHaveURL(/\/expenses$/);

      const recurringRows = await cleanupDatabase!`
        select title, amount_minor, due_date, status from expenses
        where recurring_expense_id = (
          select id from recurring_expenses where category_id = ${categoryId!}
            and title = ${editedRecurringTitle}
        )
        order by due_date
      `;
      expect(recurringRows).toHaveLength(3);
      expect(recurringRows[0]).toMatchObject({
        amount_minor: "7700",
        due_date: today,
        status: "paid",
        title: recurringTitle,
      });
      expect(recurringRows.slice(1)).toEqual([
        expect.objectContaining({ amount_minor: "8800", status: "pending", title: editedRecurringTitle }),
        expect.objectContaining({ amount_minor: "8800", status: "pending", title: editedRecurringTitle }),
      ]);

      await createExpense(page, {
        amount: "33,00",
        category: categoryName,
        currency: "ARS",
        dueDate: today,
        status: "Planificado",
        title: arsTitle,
      });

      const cashFlow = await readCashFlow(ownerId!, monthStart, monthEnd, "USD");
      await page.goto("/expenses?currency=USD");
      const projectedResult = page.getByRole("group", { name: "Resultado proyectado" });
      const actualResult = page.getByRole("group", { name: "Resultado real" });
      await expect(projectedResult).toContainText(formatAggregateMoney(cashFlow.projected_income, "USD"));
      await expect(projectedResult).toContainText(formatAggregateMoney(cashFlow.projected_expenses, "USD"));
      await expect(projectedResult).toContainText(formatAggregateMoney(cashFlow.projected_net, "USD"));
      await expect(actualResult).toContainText(formatAggregateMoney(cashFlow.actual_income, "USD"));
      await expect(actualResult).toContainText(formatAggregateMoney(cashFlow.actual_expenses, "USD"));
      await expect(actualResult).toContainText(formatAggregateMoney(cashFlow.actual_net, "USD"));

      await page.goto(`/expenses?period=all&q=${encodeURIComponent(recurringTitle)}&currency=USD`);
      await page.getByRole("link", { name: "Pagados", exact: true }).click();
      await page.getByText("Categoría, clasificación, recurrencia y moneda", { exact: true }).click();
      await choose(page, "Categoría", categoryName);
      await choose(page, "Ámbito", "Negocio");
      await choose(page, "Tipo", "Fijo");
      await choose(page, "Recurrencia", "Recurrentes");
      await choose(page, "Moneda", "USD");
      await page.getByRole("button", { name: "Aplicar filtros" }).click();
      await expect.poll(() => Object.fromEntries(new URL(page.url()).searchParams)).toMatchObject({
        categoryId,
        costType: "fixed",
        currency: "USD",
        q: recurringTitle,
        recurrence: "recurring",
        scope: "business",
        status: "paid",
      });
      await expect(desktopExpenseRow(page, recurringTitle)).toHaveCount(1);
      await expect(desktopExpenseRow(page, editedRecurringTitle)).toHaveCount(0);

      await page.goto(`/expenses?period=all&q=${encodeURIComponent(marker)}&currency=ARS`);
      await expect(desktopExpenseRow(page, arsTitle)).toHaveCount(1);
      await expect(desktopExpenseRow(page, plannedTitle)).toHaveCount(0);
      const arsCashFlow = await readCashFlow(ownerId!, monthStart, monthEnd, "ARS");
      await expect(page.getByLabel("Resumen de gastos ARS")).toContainText(
        formatAggregateMoney(arsCashFlow.projected_expenses, "ARS"),
      );

      await page.goto(`/expenses?period=all&q=${encodeURIComponent(marker)}&currency=USD`);
      await expect(desktopExpenseRow(page, arsTitle)).toHaveCount(0);
      await expect(desktopExpenseRow(page, plannedTitle)).toHaveCount(1);

      await page.goto("/dashboard?currency=USD");
      const expenseCard = page.getByRole("article").filter({
        has: page.getByRole("heading", { name: "Gastos del mes" }),
      });
      const balanceCard = page.getByRole("article").filter({
        has: page.getByRole("heading", { name: "Balance proyectado" }),
      });
      await expect(expenseCard).toContainText(formatAggregateMoney(cashFlow.actual_expenses, "USD"));
      await expect(balanceCard).toContainText(formatAggregateMoney(cashFlow.projected_net, "USD"));
      await expect(page.getByRole("heading", { name: "Ingresos vs gastos — este mes" })).toBeVisible();
      await expect(page.getByRole("list", { name: "Próximos movimientos" })).toContainText(editedCopyTitle);

      await page.setViewportSize({ width: 390, height: 844 });
      await createExpense(page, {
        amount: "19,90",
        category: categoryName,
        dueDate: today,
        title: mobileTitle,
      });
      const mobileCard = mobileExpenseCard(page, mobileTitle);
      await expect(mobileCard).toBeVisible();
      await mobileCard
        .getByRole("button", { name: `Registrar pago de ${mobileTitle}` })
        .click();
      await choose(page, "Método de pago", "Mercado Pago");
      await page.getByRole("button", { name: "Registrar pago", exact: true }).click();
      await expect(mobileCard).toContainText("Pagado");
      await expect(mobileCard.getByRole("button", { name: `Cancelar gasto ${mobileTitle}` })).toHaveCount(0);
      await expect(mobileCard.getByRole("button", { name: `Eliminar gasto ${mobileTitle}` })).toHaveCount(0);

      await createExpense(page, {
        amount: "1,00",
        category: categoryName,
        dueDate: today,
        status: "Planificado",
        title: disposableTitle,
      });
      const disposableCard = mobileExpenseCard(page, disposableTitle);
      await disposableCard
        .getByRole("button", { name: `Eliminar gasto ${disposableTitle}` })
        .click();
      await disposableCard
        .getByRole("button", { name: "Confirmar eliminación" })
        .click();
      await expect(disposableCard).toHaveCount(0);

      const copyCard = mobileExpenseCard(page, editedCopyTitle);
      await copyCard
        .getByRole("button", { name: `Cancelar gasto ${editedCopyTitle}` })
        .click();
      await copyCard
        .getByRole("button", { name: "Confirmar cancelación" })
        .click();
      await expect(copyCard).toContainText("Cancelado");
    } finally {
      if (cleanupDatabase) {
        const fixtureCategories = categoryId
          ? [{ id: categoryId }]
          : await cleanupDatabase`
              select id from expense_categories
              where name = ${categoryName}
            `;

        for (const fixture of fixtureCategories) {
          await cleanupDatabase`delete from expenses where category_id = ${fixture.id}`;
          await cleanupDatabase`delete from recurring_expenses where category_id = ${fixture.id}`;
          await cleanupDatabase`
            delete from expense_categories where id = ${fixture.id}
              and name = ${categoryName}
          `;
        }
      }
    }
  });
});
