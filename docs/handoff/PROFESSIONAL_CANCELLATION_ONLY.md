# Calendar actions by role — prepared, not deployed

This replaces the earlier draft that merely disabled removal.

- Planned encounter: reuse AppointmentEditor for date/time/duration/modality/office changes and CancellationEditor for cancellation. Existing conflict checks, fees, and series scopes remain.
- Completed encounter: use the same prefilled AppointmentEditor through appointments.correct; one occurrence only, past dates only, with reason, confirmation and linked-note/invoice counts. New private append-only snapshots preserve each correction. Signed notes/signatures and existing invoices are not rewritten. Existing billing/fee review remains necessary for financial changes; there is no automatic invoice adjustment or mail. Actual duration/travel values are preserved when only unrelated fields change.
- Remove: administrative context plus Direction/admin finance capability only; assistants and the professional context are refused by SQL and HTTP. Existing private-event restrictions remain. Administration uses the existing removal confirmation and invoice-replacement workflow. Original signed notes remain protected as before.
- A completed encounter cannot be cancelled using the planned-encounter workflow. No new rescheduling of other professionals or changing client/professional identity during a correction.

Migration real-880-calendar-role-actions.sql adds the correction audit table, narrow appointment-guard exception, private correction helper, admin-only removal rule, versioned read RPC and command wrapper. Source function hashes fail if the production functions differ. Previous read RPCs remain compatible. No production changes have been made.

Validation: local fictional SQL recipe rolls back all records; checks pro removal denial, admin deletion with signed note and grouped invoice replacement, correction/replay, stale preview, time conflict, other professional refusal, original signed note/invoice preservation and private ACLs. New read DTOs verified for both roles. TypeScript and targeted ESLint passed. Browser acceptance reserved to user. Build result is recorded separately.

After real corrections, preserve markers and use compatible read models/fix-forward; do not drop audit records or roll back to financial readers that ignore removals.
