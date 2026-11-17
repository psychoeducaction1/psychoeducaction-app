# Integration delivery — 16 November 2026

This branch starts from the existing repository history and adds the exact published clinical application, including the note/signature simplifications and account-scoped AI. The six secondary-chat commits were then applied in order without conflicts. The shared working copies were not reset or cleaned.

- Reference deployment: dpl_Bgx7S9WA2KbGXDig94sWPPTfE2To.
- Clinical note editor, signatures and AI account restrictions remain in place.
- Office calendar filters, exclusion preferences, separate assignment/client views, simplified details and the non-service safeguard are integrated.
- Professional billing banner removed on the real application; technical save/session labels simplified. Laboratory safety warnings and all payment/email/AI controls are preserved.
- Approved database changes applied: non-service encounter guard, four missing offices and office grants. Existing 101/102 UUIDs preserved; Hicham has six offices, Ève four in Longueuil. No client, note, PDF, appointment or email created by this operation.
- Checks: 19 targeted tests passed; exact release candidate production build passed. Browser acceptance is left to the user as requested. No real note generation or clinical message sent.
- Seven Thinhinane assignment links remain deferred; they are outside this approved migration and office change.

Operational evidence is maintained by the principal chat in `docs/migration/INTEGRATED_UI_*.json`. Secrets, real client information and local backup files are excluded from the delivery.
