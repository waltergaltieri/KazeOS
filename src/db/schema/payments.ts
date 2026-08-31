import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  pgPolicy,
  pgTable,
  text,
  uuid,
} from "drizzle-orm/pg-core";
import { authenticatedRole, authUid } from "drizzle-orm/supabase";

import { charges } from "./charges";
import { clients } from "./clients";
import { currencyEnum, paymentMethodEnum } from "./enums";
import { auditColumns, ownerIdColumn } from "./shared";

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
    foreignKey({
      name: "payments_owner_id_client_id_clients_owner_id_id_fk",
      columns: [table.ownerId, table.clientId],
      foreignColumns: [clients.ownerId, clients.id],
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    foreignKey({
      name: "payments_owner_id_charge_id_charges_owner_id_id_fk",
      columns: [table.ownerId, table.chargeId],
      foreignColumns: [charges.ownerId, charges.id],
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    index("payments_owner_id_client_id_idx").on(table.ownerId, table.clientId),
    index("payments_owner_id_charge_id_idx").on(table.ownerId, table.chargeId),
    index("payments_owner_id_payment_date_idx").on(
      table.ownerId,
      table.paymentDate,
    ),
    pgPolicy("payments_authenticated_owner_access", {
      as: "permissive",
      for: "all",
      to: authenticatedRole,
      using: sql`${authUid} = ${table.ownerId}`,
      withCheck: sql`${authUid} = ${table.ownerId}`,
    }),
  ],
).enableRLS();
