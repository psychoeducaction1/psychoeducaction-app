import test from 'node:test'
import assert from 'node:assert/strict'
import {mandateLoadError} from '../lib/clinical-mandates/loadError.ts'
test('mandat archivé : erreur de chargement distincte du statut de fermeture',()=>{
 assert.equal(mandateLoadError(Error('Le service clinique est momentanément indisponible.'),true),'Le mandat archivé n’a pas pu être chargé. Réessayez.')
 assert.equal(mandateLoadError(Error('Le service clinique est momentanément indisponible.'),false),'Le mandat n’a pas pu être chargé. Réessayez.')
 assert.equal(mandateLoadError(Error('Accès refusé.'),true),'Accès refusé.')
})
