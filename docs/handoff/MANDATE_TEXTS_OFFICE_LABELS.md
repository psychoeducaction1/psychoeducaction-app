# Complete new-mandate texts and consistent office labels

New drafts already call withStandardClinicalConsent and withStandardAdministrativeConsent in createDraft and withServiceDefaults. These defaults are retained, including service-specific text and the existing AI clause. The two manual completion buttons are removed; both textareas remain editable, and saving does not reinsert text removed by the professional. Existing revision initialization and all signed documents are unchanged.

AppointmentEditor, EventDetail, CalendarWorkspace and CalendarSettings now reuse officeDisplayName, already used in office availability. Legacy office 101/102 identifiers display as Longueuil — bureau 101/102. Stored office names, UUIDs, grants and reservations are unchanged.

No SQL migration, production mutation or email. Diff reviewed; targeted lint result is in the private local check log. User performs behavioral acceptance. Publication awaits explicit authorization.
