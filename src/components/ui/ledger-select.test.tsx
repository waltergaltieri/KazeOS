import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { LedgerSelect } from "./ledger-select";

const options = [
  { value: "usd", label: "Dólares" },
  { value: "ars", label: "Pesos" },
  { value: "eur", label: "Euros" },
];

describe("LedgerSelect", () => {
  it("opens as a coherent listbox and selects the active keyboard option", async () => {
    const user = userEvent.setup();
    render(
      <LedgerSelect
        name="currency"
        label="Moneda"
        defaultValue="ars"
        options={options}
      />,
    );

    const trigger = screen.getByRole("combobox", { name: "Moneda" });
    await user.click(trigger);
    const listbox = screen.getByRole("listbox", { name: "Moneda" });
    expect(listbox).toHaveFocus();
    expect(listbox).toHaveAttribute(
      "aria-activedescendant",
      screen.getByRole("option", { name: "Pesos" }).id,
    );

    await user.keyboard("{ArrowDown}{End}{Home}{ArrowUp}{Enter}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(trigger).toHaveTextContent("Dólares");
    expect(trigger).toHaveFocus();
    expect(document.querySelector<HTMLInputElement>('input[name="currency"]')?.value).toBe(
      "usd",
    );
  });

  it("restores the trigger on Escape and lets Tab leave without selecting", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <LedgerSelect name="currency" label="Moneda" options={options} />
        <button type="button">Siguiente</button>
      </div>,
    );

    const trigger = screen.getByRole("combobox", { name: "Moneda" });
    trigger.focus();
    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("listbox")).toHaveFocus();
    expect(screen.getByRole("option", { name: "Euros" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
    await user.keyboard("{Escape}");
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    await user.tab();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Siguiente" })).toHaveFocus();
  });

  it("exposes required, invalid and disabled semantics on the trigger", () => {
    render(
      <LedgerSelect
        name="currency"
        label="Moneda"
        options={options}
        required
        disabled
        error="Elegí una moneda"
      />,
    );

    const trigger = screen.getByRole("combobox", { name: "Moneda" });
    expect(trigger).toBeDisabled();
    expect(trigger).toHaveAttribute("aria-required", "true");
    expect(trigger).toHaveAttribute("aria-invalid", "true");
    expect(trigger).toHaveAccessibleDescription("Elegí una moneda");
  });
});
