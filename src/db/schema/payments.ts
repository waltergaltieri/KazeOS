import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  pgTable,
  text,
  uuid,
} from "drizzle-orm/pg-core";

import { charges } from "./charges";
import { clients } from "./clients";
import { currencyEnum, paymentMethodEnum } from "./enums";
import {
  auditColumns,
  authenticatedOwnerPolicies,
  ownerIdColumn,
} from "./shared";

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: ownerIdColumn(),
    clientId: uuid("client_id").notNull(),
    chargeId: uuid("charge_id"),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currency: currencyEnum("currency").notNull(),
    paymentDate: date("payment_date", { mode: "string" }).notNull(),
    paymentMethod: paymentMethodEnum("payment_method").notNull(),
    reference: text("reference"),
    notes: text("notes"),
    ...auditColumns(),
  },
  (table) => [
    check("payments_amount_minor_positive", sql`${table.amountMinor} > 0`),
    check(
      "payments_amount_minor_js_safe",
      sql`${table.amountMinor} <= 9007199254740991`,
    ),
    foreignKey({
      name: "payments_owner_id_client_id_clients_owner_id_id_fk",
      columns: [table.ownerId, table.clientId],
      foreignColumns: [clients.ownerId, clients.id],
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    foreignKey({
      name: "payments_charge_owner_client_currency_charges_fk",
      columns: [
        table.chargeId,
        table.ownerId,
        table.clientId,
        table.currency,
      ],
      foreignColumns: [
        charges.id,
        charges.ownerId,
        charges.clientId,
        charges.currency,
      ],
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    index("payments_owner_id_client_id_idx").on(table.ownerId, table.clientId),
    index("payments_charge_owner_client_currency_idx").on(
      table.chargeId,
      table.ownerId,
      table.clientId,
      table.currency,
    ),
    index("payments_owner_id_payment_date_idx").on(
      table.ownerId,
      table.paymentDate,
    ),
    ...authenticatedOwnerPolicies("payments", table.ownerId),
  ],
).enableRLS();
