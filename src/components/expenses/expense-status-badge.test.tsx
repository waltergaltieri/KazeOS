import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ExpenseStatusBadge } from "./expense-status-badge";

describe("ExpenseStatusBadge", () => {
  it.each([
    ["planned", "Planificado"],
    ["pending", "Pendiente"],
    ["overdue", "Vencido"],
    ["paid", "Pagado"],
    ["cancelled", "Cancelado"],
  ] as const)("presents %s as %s", (status, label) => {
    render(<ExpenseStatusBadge status={status} />);

    expect(screen.getByText(label)).toHaveClass(`expense-status--${status}`);
  });
});
