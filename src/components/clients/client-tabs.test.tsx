import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ClientTabs } from "./client-tabs";

describe("ClientTabs", () => {
  it("links the available service dossier and marks its active route", () => {
    const clientId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    render(<ClientTabs clientId={clientId} active="services" />);

    expect(screen.getByRole("link", { name: "Resumen" })).toHaveAttribute(
      "href",
      `/clients/${clientId}`,
    );
    expect(screen.getByRole("link", { name: "Servicios" })).toHaveAttribute(
      "href",
      `/clients/${clientId}/services`,
    );
    expect(screen.getByRole("link", { name: "Servicios" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});
