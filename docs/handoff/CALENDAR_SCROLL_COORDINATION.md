# Calendar scroll and coordination entry

The professional-profile navigation previously invoked scrollIntoView after every history change, including appointment selection. Capture the source URL before history updates and scroll to the profile section only when entering the profile or switching tabs. Opening/closing an appointment on the same tab preserves the current document position.

The real clinical sidebar now reuses loadClinicalCoordinationAccess and displays Coordination clinique only for the current authenticated actor authorized by the existing coordination endpoint. Existing unsaved-form guards are respected. API/RLS permission enforcement is unchanged.

Eve's existing active staff registration and professional-only profile were checked read-only; a role-scoped read-only transaction confirmed her own staff row is visible. No role, client, permission, or business-data mutation was needed. No emails sent. Browser acceptance is left to the user.
