# Office readability and URL filters

The office controls use visible select-all and deselect-all buttons. Display-only legacy Longueuil labels retain office IDs and stored data. Calendar codes use actual office numbers (B101 etc), never selection position. Numeric-aware ordering and a minimum lane width preserve readability.

Office URL selections use b101.b102; all omits the filter and none keeps the existing none token. Legacy UUID filters remain accepted. Tokens resolve only against the authorized catalog; duplicate office numbers fall back to UUID rather than selecting an ambiguous office. No permission change or SQL migration.

Navigation source review covered central workspace routes and links in clinical workspace, admission, mandates, billing, and professional profiles. Existing unique professional slugs and UUID compatibility remain. Client/record/note/invoice identifiers intentionally remain opaque; converting these to identifying names was not included in this office release. No claim of a complete live browser audit.

User requested to perform behavioral tests. Diff reviewed, Vercel build is the publication gate.
