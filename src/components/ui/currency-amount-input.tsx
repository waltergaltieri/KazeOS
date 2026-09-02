"use client";

import { useState } from "react";

type Currency = "USD" | "ARS";

function groupDigits(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function normalizeEditableAmount(input: string): { display: string; clean: string } {
  const sanitized = input.replace(/[^\d,]/g, "");
  if (!sanitized) return { display: "", clean: "" };

  const comma = sanitized.indexOf(",");
  const hasDecimal = comma >= 0;
  const integerInput = (hasDecimal ? sanitized.slice(0, comma) : sanitized).replace(/\D/g, "");
  const decimalInput = hasDecimal
    ? sanitized.slice(comma + 1).replace(/\D/g, "").slice(0, 2)
    : "";
  const integer = (integerInput || "0").replace(/^0+(?=\d)/, "");
  const suffix = hasDecimal ? `,${decimalInput}` : "";

  return {
    display: `${groupDigits(integer)}${suffix}`,
    clean: `${integer}${suffix}`,
  };
}

export function CurrencyAmountInput({
  currency,
  defaultValue = "",
  error,
}: {
  currency: Currency;
  defaultValue?: string;
  error?: string;
}) {
  const initial = normalizeEditableAmount(defaultValue);
  const [display, setDisplay] = useState(initial.display);
  const [clean, setClean] = useState(initial.clean);
  const errorId = "amount-error";
  const prefix = currency === "ARS" ? "$" : "US$";
  const placeholder = currency === "ARS" ? "50.000" : "1.250,00";

  return (
    <>
      <span className="money-control" data-prefix={prefix}>
        <input
          className="form-control"
          aria-label="Monto *"
          inputMode="decimal"
          placeholder={placeholder}
          required
          value={display}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : "amount-format-note"}
          onChange={(event) => {
            const normalized = normalizeEditableAmount(event.target.value);
            setDisplay(normalized.display);
            setClean(normalized.clean);
          }}
        />
      </span>
      <input type="hidden" name="amount" value={clean} />
      <small id="amount-format-note" className="field-note">
        {currency === "ARS" ? "Pesos argentinos" : "Dólares estadounidenses"}
      </small>
      {error ? <small id={errorId} className="field-error">{error}</small> : null}
    </>
  );
}
