# Client form hotfix design

## Problem

The deployed new-client form crashes when a malformed website such as `656.ar`
is submitted. The URL schema calls `new URL(value)` from a refinement even when
the preceding URL check has already failed, and Zod continues running checks.
The resulting exception bypasses normal field-error handling.

The form also groups `Nombre`, `Apellido`, and `Empresa` under the generic title
`Identidad`, followed by a second section named `Contacto`. This makes it unclear
which fields identify the company and which identify the person who hired the
operator.

## Design

Keep the current database columns and submission contract. Replace the unsafe
protocol refinement with a non-throwing helper so malformed websites return the
existing `website` field error. Reorganize only the presentation:

1. `Datos del cliente`: `Empresa o nombre comercial` and status.
2. `Persona de contacto`: contact first name, last name, email, phone, WhatsApp.
3. `Datos comerciales`: tax ID, website, and address.
4. `Notas`: free-form context.

The contact first name remains required in this hotfix because the current
database requires it. The company field stays optional so individual clients are
still supported. A future data-model change can allow company-only records
without overloading a hotfix.

## Error handling and verification

Regression tests must prove malformed create and update website values return
validation failures without throwing. A component test must prove the company
and contact labels are unambiguous. After unit, lint, type, and build checks, the
preview deployment will be replaced and the original flow tested again.
