# Shared currency preference design

## Problem

The dashboard exposes its USD/ARS selector in the top bar, while the expenses
page renders a second selector inside the page heading. The two controls are not
the same component, do not occupy the same position, and both fall back to USD
whenever the URL does not contain a valid `currency` value.

This makes the expenses experience inconsistent and loses the operator's last
viewing preference when they leave and return.

## Design

Use the existing top-bar selector as the single currency control for both the
dashboard and the expenses index. Remove the expenses-only selector and its
styles. The control remains hidden on other routes, including expense creation,
editing, and recurring-expense administration.

The URL remains the source of truth for the current view because both pages are
server rendered and expense filters are already URL-backed. Switching currency
must preserve the current expense filters, discard pagination, and update only
the `currency` parameter.

Persist the last valid selection in a first-party cookie shared across the
application. A valid explicit URL parameter takes precedence over the cookie;
the cookie takes precedence over the USD fallback. The protected layout passes
the remembered value to the client top bar so the selected state is correct on
the first render, while the dashboard and expenses pages use the same resolver
for their server-side data. Clicking either currency also refreshes the cookie
for future visits.

The cookie stores only `USD` or `ARS`, uses `Path=/`, `SameSite=Lax`, and a
one-year lifetime. Invalid URL or cookie values are ignored.

## Verification

Tests must prove that:

1. The top-bar selector appears on `/dashboard` and `/expenses`, but not on
   unrelated or nested expense routes.
2. Currency links preserve expense filters, reset pagination, and keep the
   dashboard URL minimal.
3. Clicking a currency records the shared preference.
4. Both server pages prefer a valid URL value, then the remembered cookie, then
   USD.
5. The expenses page no longer renders a local currency selector.

Focused component and page tests run first, followed by type checking, linting,
and the production build.
