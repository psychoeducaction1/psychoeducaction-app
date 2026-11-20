import assert from 'node:assert/strict'
import test from 'node:test'
import { extractMigrationIntake, extractPdfConsultationReason } from '../lib/clinical-migration/intake.ts'

test('migration : libellés exacts, variantes de colonnes et valeurs discordantes', () => {
  const intake = extractMigrationIntake(['Motif de la demande', 'Date du premier rendez-vous', 'Référé par'], ['Motif fictif', '2026-10-18', 'Référence fictive'])
  assert.equal(intake.consultationReason, 'Motif fictif')
  assert.equal(intake.firstAppointmentDate, '2026-10-18')
  assert.equal(intake.referredBy, 'Référence fictive')
  assert.equal(extractMigrationIntake(['Motif de consultation', 'Message initial'], ['A', 'B']).consultationReason, '')
  assert.equal(extractMigrationIntake(['Commentaire sur le motif de consultation'], ['À ignorer']).consultationReason, '')
})

test('migration : PDF explicite, aucune déduction d’un récit ou de valeurs concurrentes', () => {
  assert.equal(extractPdfConsultationReason(['Motif de consultation : Motif fictif\nDate : 2026-10-18']), 'Motif fictif')
  assert.equal(extractPdfConsultationReason(['Le client indique un motif de consultation : Motif fictif']), '')
  assert.equal(extractPdfConsultationReason(['Motif de consultation : A', 'Motif de la demande : B']), '')
})
