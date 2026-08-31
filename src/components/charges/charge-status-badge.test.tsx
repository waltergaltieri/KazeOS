import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChargeStatusBadge } from "./charge-status-badge";
describe("ChargeStatusBadge", () => { it("exposes the semantic Spanish status", () => { render(<ChargeStatusBadge status="overdue" />); expect(screen.getByText("Vencido")).toHaveClass("charge-status--overdue"); }); });
