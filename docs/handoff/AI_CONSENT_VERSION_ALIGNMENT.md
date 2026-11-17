# Single consent notice reference

ClinicalEncounterConsent now always submits ai-encounter-pilot-v1, the single identifier accepted by the current hosted and local consent function. Remove the hostname-based v1/v2 distinction; keep all attestation checkboxes, participant decisions, withdrawal logic and text unchanged. Previously recorded events are neither rewritten nor recreated. No automatic attestation, consent bypass, AI call or email.

The hosted function definition was checked read-only before this fix and contains only v1. This release requires no SQL migration or data change. User performs browser acceptance; the deployment build is the release gate.
