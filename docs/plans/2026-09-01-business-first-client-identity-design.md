# Business-first client identity design

## Intent

KazeOS is a commercial ledger. When the operator scans the client portfolio,
the business being billed is the primary identity; the human contact is the
secondary reference. The interface should remain compact, calm, and consistent
with the existing dark, borders-only visual system.

## Hierarchy

- If a company exists, render it as the large linked title and render the full
  contact name underneath in secondary text with a person icon.
- If no company exists, render the contact name as the large linked title and
  render `Cliente particular` underneath.
- Apply the same rule in the desktop table, responsive client cards, accessible
  open-link labels, and the individual client header.
- Do not change stored data, search behavior, balances, status, colors, spacing,
  or navigation.

## Verification

Component tests will lock the company-first hierarchy and the individual-client
fallback. The updated page will be inspected at desktop and mobile widths before
the Vercel Preview alias is updated.
