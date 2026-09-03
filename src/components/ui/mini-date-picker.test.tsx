import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { MiniDatePicker } from "./mini-date-picker";

describe("MiniDatePicker", () => {
  it("supports named required and optional commercial dates with accessible errors", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    const { unmount } = render(
      <MiniDatePicker
        name="paidDate"
        label="Fecha de pago"
        required
        defaultValue="2026-09-15"
        error="Elegí la fecha efectiva."
        onValueChange={onValueChange}
      />,
    );

    const trigger = screen.getByRole("combobox", { name: "Fecha de pago: 15/09/2026" });
    expect(trigger).toHaveAccessibleDescription(/Campo obligatorio.*Elegí la fecha efectiva/);
    expect(trigger).not.toHaveAttribute("aria-required");
    expect(trigger).toHaveAttribute("aria-invalid", "true");
    expect(document.querySelector('input[name="paidDate"]')).toHaveValue("2026-09-15");
    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "20/09/2026" }));
    expect(onValueChange).toHaveBeenCalledWith("2026-09-20");

    unmount();
    render(<MiniDatePicker name="endDate" label="Fin" required={false} />);
    expect(screen.getByRole("combobox", { name: "Fin: sin fecha" })).not.toHaveAttribute("aria-describedby");
    expect(document.querySelector('input[name="endDate"]')).toHaveValue("");
  });

  it("restores focus to the date trigger after Escape and after choosing a day", async () => {
    const user = userEvent.setup();
    render(<MiniDatePicker defaultValue="2026-09-15" />);

    const trigger = screen.getByRole("combobox", { name: "Vencimiento: 15/09/2026" });
    await user.click(trigger);
    await user.keyboard("{Escape}");
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "20/09/2026" }));
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
