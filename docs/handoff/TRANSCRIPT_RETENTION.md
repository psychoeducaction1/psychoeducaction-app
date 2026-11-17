# Durable encounter transcript, audio-only expiry — prepared

Verified starting behavior: transcription lived only in React memory; clearWorkingData removed transcript and draft along with audio after 24h. The former footer was accurate for that implementation but did not meet the requested retention. Nothing has been changed in production during this preparation.

The two import controls are removed from the recorder block itself. The real-app mode is now passed from authenticated WorkspaceView.mode by both clinical-note entry points, rather than guessed from a global browser flag.

Migration 890 creates only a private append-only encounter_transcript_versions table and an authorized RPC. It never imports or rewrites existing notes or consent events. Transcripts are attached to case+appointment, restored when returning to a note, and visible as a collapsed read-only source on signed notes. They are separate from the signed note/PDF text. Reads require clinical case access; saves require the encounter's professional, an open writable case, version match and no signed/awaiting-signature note. Removed appointments deny access. RPC/table ACLs and RLS prevent direct access. Signed notes and saved transcript versions are never rewritten.

The UI autosaves transcript text and review status after 1.5s; an acknowledgement is required before displaying saved status. A serialized save queue and expected-version/idempotency keys prevent stale writes. Guards flush pending source text before navigation, generating a draft, creating the note and signing. Failed saves remain visible and block those operations; forced page close warns, and no claim of crash-proof preservation before an acknowledgement is made. Transcripts lost from earlier in-memory sessions cannot be reconstructed by this migration.

Audio is never uploaded or stored by this change. File/blob/worker references and the playback object URL expire within the page's 24h audio lifecycle or are lost on closing the tab. Cleanup also checks expiry on focus/pageshow/visibility changes after browser suspension. Real-mode expiry does not erase transcript, generated draft or clinical-note data. A new recording starts a new audio deadline.

Backups already covering the clinical schema must include the new table once applied. No new service, AI call, email or recurring job is introduced. Rollback after transcript records exist must preserve this table and its data; do not drop it or revert to a UI that claims only in-memory retention.

Validation on isolated fictional PostgreSQL: create/read, reload/versioned update, replay, changed-intent/stale conflict, another professional denied, signed-note save denied, original note and transcript unchanged after refusal, direct table writes and anonymous execution denied. All recipe data rolled back. TypeScript and targeted lint passed; build proof recorded separately. Browser acceptance remains with the user. Migration/publication require explicit authorization.
