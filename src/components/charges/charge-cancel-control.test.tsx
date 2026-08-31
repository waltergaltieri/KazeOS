import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/actions/charges", () => ({ cancelChargeAction: vi.fn() }));

import { ChargeCancelControl } from "./charge-cancel-control";

describe("ChargeCancelControl", () => {
  it("requires confirmation, moves focus and restores the opener when dismissed", async () => {
    const user = userEvent.setup();
    render(
      <ChargeCancelControl chargeId="11111111-1111-4111-8111-111111111111" />,
    );

    const opener = screen.getByRole("button", { name: "Cancelar cobro" });
    await user.click(opener);
    expect(screen.getByRole("group", { name: "Confirmar cancelación" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Confirmar cancelación" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Volver" }));
    expect(screen.queryByRole("group", { name: "Confirmar cancelación" })).not.toBeInTheDocument();
    await waitFor(() => expect(opener).toHaveFocus());
  });
});
