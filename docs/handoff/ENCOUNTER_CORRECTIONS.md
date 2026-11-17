# Encounter, invoice and payment corrections — prepared

## Requested behavior
- A professional can remove their own incorrectly created encounter and its linked notes, including signed notes, while their clinical write access is current.
- A short confirmation warns when notes or invoices are linked. A hash binds confirmation to the exact encounter, note versions and invoice versions; changes require a new preview.
- Removal affects this occurrence only. Original signed content/signatures remain immutable in protected history, and normal note/encounter views exclude the removed items.
- Linked invoices are voided without creating credit entries or refunding money. Remaining encounters are copied to a draft replacement (or the same payer's already-open draft group).
- Existing payments are preserved. An administrator must remove/reassign them before the replacement can be finalized; no duplicate payment, automatic transfer or bank refund is performed.
- Direction/administrators only may record, remove or restore payments. SQL checks the real role and administrative context, including older direct payment RPCs. Professionals and administrative assistants cannot bypass the restriction by changing the UI.
- A voided invoice is excluded from normal financial lists and has zero receivable balance in its display. It remains available via the Annulées filter. Removed payments are collapsed behind Paiements retirés, rather than displayed as a running audit history.
- Existing refunds constrain corrections: a withdrawal cannot make recorded net payments less than refunds. No old payroll or settled fee statement is rewritten; current fee quotations omit removed sources and retain historical snapshots for review.

## Prepared files and activation
- Migration: `supabase/clinical/real-870-encounter-financial-corrections.sql`.
- Original laboratory calendar/billing components and adapters are extended; no parallel interface or dependency.
- Versioned read RPCs preserve the response contract of the still-running application while migration and publication are sequenced.
- Production schema definitions were inspected read-only. Migration applied only to the isolated fictional PostgreSQL; the transaction recipe creates fictional encounters/invoices/notes and rolls back all data writes.
- No real encounter, note, invoice or payment has been changed. No email or real AI call. Remote migration and publication require the principal chat's targeted authorization once the candidate is compiled.

## Validation and rollback
TypeScript, targeted ESLint, locked-candidate build and fictional transaction recipe passed. No browser acceptance or real-record mutation. After any real correction, preserve correction markers and use a compatible read model/fix-forward; do not blindly restore old financial readers or drop correction tables.
