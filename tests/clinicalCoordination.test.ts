import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { canAccessClinicalCoordination } from '../lib/clinicalCoordinationAccess.ts'
import { SUPER_ADMIN_EMAIL } from '../lib/superAdmin.ts'
const coordinator={id:'staff',profile_id:'coordinator',full_name:'Coordinatrice fictive',email:'coordinator@example.invalid',is_active:true}
test('coordination privée : direction autorisée et UUID explicitement lié seulement',()=>{
 assert.equal(canAccessClinicalCoordination({id:'owner',email:SUPER_ADMIN_EMAIL},{role:'direction'}),true)
 assert.equal(canAccessClinicalCoordination({id:'coordinator',email:coordinator.email},{role:'professionnel'},coordinator),true)
 for(const role of ['direction','professionnel','marketing'])for(const id of ['assistantA','assistantB','other'])assert.equal(canAccessClinicalCoordination({id,email:coordinator.email},{role},coordinator),false)
 assert.equal(canAccessClinicalCoordination({id:'coordinator'},{role:'professionnel'},{...coordinator,is_active:false}),false)
 assert.equal(canAccessClinicalCoordination({id:'coordinator'},{role:'professionnel',platform_access_enabled:false},coordinator),false)
 assert.equal(canAccessClinicalCoordination({id:'owner',email:SUPER_ADMIN_EMAIL},{role:'direction',platform_access_enabled:false}),false)
 assert.equal(canAccessClinicalCoordination(null,{role:'direction'},coordinator),false)
 assert.equal(canAccessClinicalCoordination({id:'coordinator'},null,coordinator),false)
})
test('les vraies routes coordination refusent les adjointes et ne font aucun envoi externe pendant les tests',()=>{
 const r=spawnSync(process.execPath,['--import','./tests/register-aliases.mjs','--experimental-strip-types','tests/helpers/clinicalCoordinationRoutes.mjs'],{encoding:'utf8',windowsHide:true,timeout:15000})
 assert.equal(r.status,0,`${r.stdout}\n${r.stderr}`)
})
