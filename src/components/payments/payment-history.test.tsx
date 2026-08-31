import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PaymentHistory } from "./payment-history";
describe("PaymentHistory", () => { it("renders every payment as a chronological movement", () => { render(<PaymentHistory payments={[{ id: "1", amountMinor: 1000, currency: "USD", paymentDate: "2026-08-31", paymentMethod: "cash", reference: null, notes: null, createdAt: new Date() }, { id: "2", amountMinor: 2000, currency: "USD", paymentDate: "2026-08-30", paymentMethod: "bank_transfer", reference: "OP", notes: null, createdAt: new Date() }]} />); expect(screen.getAllByRole("listitem")).toHaveLength(2); expect(screen.getByText("OP")).toBeInTheDocument(); }); });
