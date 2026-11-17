# Existing notes only and versioned RPC names

ClinicalRecordPanel no longer offers a new-note form, appointment association, template loading, or unused appointment-list calls. Existing note list, empty state, previews, PDFs, editing and protected correction workflow remain. AppointmentNotePage remains the calendar-based note entry point.

Root cause of the unavailable calendar: realClinicalTransport's RPC-name regex accepted lowercase letters/underscores only, so clinical_unified_calendar_query_870 and clinical_unified_billing_data_870 were rejected before fetch. A bounded final numeric version suffix is now accepted, preserving the clinical_ prefix and all JWT/RPC authorization checks. No SQL migration required.

Diagnosis: new function existence confirmed through anonymous denied request; isolated fictional calendar response passed the existing DTO validator. No real calendar query succeeded or wrote data. Broad production log export was rejected by automatic review; no logs were obtained, and metadata/fictional diagnostics sufficed. User performs browser acceptance. Diff reviewed. Publication pending explicit authorization.
