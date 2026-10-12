import assert from 'node:assert/strict'
import test from 'node:test'
import { isSuperAdmin, SUPER_ADMIN_EMAIL } from '../lib/superAdmin.ts'
import {
  ASSIGNMENT_REQUEST_MANAGER_EMAILS,
  canManageProfessionalAssignmentRequests,
} from '../lib/assignmentRequestAccess.ts'
import {
  ADMINISTRATIVE_PAYROLL_ACCESS_EMAILS,
  isAdministrativePayrollAuthorized,
  isPayrollAuthorized,
  PAYROLL_ACCESS_EMAILS,
} from '../lib/payrollAccess.ts'
import {
  ADMINISTRATIVE_TASK_USERS,
  getAdministrativeTaskAssigneesForEmail,
  isAdministrativeTaskAuthorized,
} from '../lib/administrativeTaskAccess.ts'

test('le privilege super administrateur exige le compte configure et le role direction charge', () => {
  const user = { email: `  ${SUPER_ADMIN_EMAIL.toUpperCase()}  ` }
  assert.equal(isSuperAdmin(user, { role: 'direction' }), true)
  for (const role of ['professionnel', 'marketing', null]) {
    assert.equal(isSuperAdmin(user, { role }), false)
  }
  assert.equal(isSuperAdmin({ email: 'direction@example.invalid' }, { role: 'direction' }), false)
  assert.equal(isSuperAdmin(null, { role: 'direction' }), false)
})

test('la gestion de demandes est reservee au super administrateur et aux adjointes autorisees', () => {
  for (const email of ASSIGNMENT_REQUEST_MANAGER_EMAILS) {
    assert.equal(canManageProfessionalAssignmentRequests({ email }, { role: 'direction' }), true)
    assert.equal(canManageProfessionalAssignmentRequests({ email }, { role: 'professionnel' }), false)
    assert.equal(canManageProfessionalAssignmentRequests({ email }, { role: 'marketing' }), false)
  }
  assert.equal(canManageProfessionalAssignmentRequests(
    { email: 'direction@example.invalid' }, { role: 'direction' }
  ), false)
})

test('les comptes ordinaires ne recoivent pas les autorisations de paie', () => {
  for (const role of ['direction', 'professionnel', 'marketing']) {
    const user = { email: 'ordinary@example.invalid' }
    assert.equal(isPayrollAuthorized(user, { role }), false)
    assert.equal(isAdministrativePayrollAuthorized(user, { role }), false)
  }
  for (const email of PAYROLL_ACCESS_EMAILS) {
    assert.equal(isPayrollAuthorized({ email }, { role: 'direction' }), true)
    assert.equal(isPayrollAuthorized({ email }, { role: 'marketing' }), false)
  }
  for (const email of ADMINISTRATIVE_PAYROLL_ACCESS_EMAILS) {
    assert.equal(isAdministrativePayrollAuthorized({ email }, { role: 'direction' }), true)
  }
})

test('les taches personnelles et partagees sont distinguees pour chaque adjointe', () => {
  for (const [key, staff] of Object.entries(ADMINISTRATIVE_TASK_USERS)) {
    assert.deepEqual(getAdministrativeTaskAssigneesForEmail(staff.emails[0]), [key, 'both'])
    assert.equal(isAdministrativeTaskAuthorized({ email: staff.emails[0] }, { role: 'professionnel' }), true)
  }
  assert.equal(isAdministrativeTaskAuthorized(
    { email: 'marketing@example.invalid' }, { role: 'marketing' }
  ), false)
  assert.equal(isAdministrativeTaskAuthorized(
    { email: 'direction@example.invalid' }, { role: 'direction' }
  ), true)
})
