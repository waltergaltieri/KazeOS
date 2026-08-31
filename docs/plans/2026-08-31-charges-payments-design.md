# Charges and Payments Design

## Intent

KazeOS serves an owner-operator who needs to identify what is due and record a payment in under fifteen seconds. The experience should feel like a calm, exact receivables ledger: quiet paper-and-ink surfaces, tabular money, restrained semantic color, and a chronological payment rail that preserves every financial movement.

## Domain and visual direction

- Domain: receivables ledger, due dates, balances, collection, proof of payment, chronological movements, client dossier.
- Color world: paper canvas, graphite ink, debt red, reminder amber, collection green, and action violet.
- Signature: each charge opens into a chronological payment rail, making its financial history visible rather than collapsing it into a single total.
- Replaced defaults: generic metric cards become filterable ledger rows; desktop-only tables become deliberate mobile charge cards; destructive payment replacement becomes append-preserving correction.

The existing KazeOS shell and tokens remain authoritative. New surfaces use quiet borders and subtle elevation, inputs remain inset, all spacing follows the 4px grid, and financial figures use tabular numerals.

## Architecture and data flow

Server queries validate every filter, verify the authenticated user, and run through the RLS-bound database runner. SQL derives display status with strict precedence: cancelled, paid, partial, overdue, due today, pending. Rows are deterministically ordered by due date and id. Aggregates group by currency and never combine USD with ARS.

Server actions parse structured form input, verify the user, and execute mutations transactionally. Manual charges are created, safely edited, or cancelled but never deleted. Payment creation locks the scoped charge `FOR UPDATE`, validates immutable owner/client/currency relationships and the synchronized balance, then inserts one payment row. The database trigger remains the sole mechanism that recomputes charge totals and persisted status. Concurrent attempts serialize on the charge lock. Overpayment requires an explicit confirmation flag. Corrections lock the same charge and update only mutable payment fields while preserving its identity and immutable relationships.

## Interface

The charges page leads with actionable filters and the ledger. Desktop uses a compact table; mobile uses cards whose first scan line is client, balance, and due state. Each charge exposes register-payment and view-history actions. The payment dialog is prefilled with client, charge, outstanding balance, today, and a sensible method; errors stay within the dialog and focus is managed on open/close. The client dossier gains a real Cobros tab. Loading, empty, failure, and confirmation states are explicit and contain no fake data.

## Safety and verification

Validation rejects unsafe money, invalid UUIDs/dates, mismatches, cancelled charges, and financially unsafe edits without leaking database details. Integration tests use real transactions/locks and exact marker cleanup. Authenticated Playwright coverage uses only supplied `E2E_AUTH_EMAIL` and `E2E_AUTH_PASSWORD`; it never creates a user and reports the external credential blocker honestly when absent.
