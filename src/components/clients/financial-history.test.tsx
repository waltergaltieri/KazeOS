import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FinancialHistory } from "./financial-history";

describe("FinancialHistory", () => {
  it("renders exact, currency-separated movements and charge links newest first", () => {
    render(<FinancialHistory clientId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" result={{ hasMore: true, limit: 2, items: [
      { id: "p1", kind: "payment", chargeId: "c1", date: "2026-08-31", label: "Pago · Transferencia", amountMinor: "9007199254740991", currency: "ARS", status: null },
      { id: "c1", kind: "charge", chargeId: "c1", date: "2026-08-30", label: "Consultoría", amountMinor: "9007199254740991", currency: "USD", status: "overdue" },
    ] }} />);
    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      expect.stringContaining("ARS 90.071.992.547.409,91"),
      expect.stringContaining("USD 90.071.992.547.409,91"),
    ]);
    expect(screen.getAllByRole("link", { name: /Ver cobro/ })).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Mostrar más movimientos" })).toHaveAttribute("href", "/clients/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb?historyLimit=22#financial-history");
  });

  it("uses a truthful empty state", () => {
    render(<FinancialHistory clientId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" result={{ hasMore: false, limit: 20, items: [] }} />);
    expect(screen.getByText("Todavía no hay movimientos financieros.")).toBeVisible();
    expect(screen.getByRole("link", { name: "Crear primer cobro" })).toHaveAttribute("href", "/charges/new?clientId=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
  });
});
