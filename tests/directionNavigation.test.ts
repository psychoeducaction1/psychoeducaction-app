import test from 'node:test'
import assert from 'node:assert/strict'
import {usesUnifiedDirectionNavigation} from '../lib/directionNavigation.ts'

test('unification limitée au compte demandé et à ses accès administratifs existants',()=>{
 const account='3c514611-b530-4f48-84e4-32871b32f320'
 assert.equal(usesUnifiedDirectionNavigation(account,true,true),true)
 assert.equal(usesUnifiedDirectionNavigation(account,false,true),false)
 assert.equal(usesUnifiedDirectionNavigation(account,true,false),false)
 assert.equal(usesUnifiedDirectionNavigation('11111111-1111-4111-8111-111111111111',true,true),false)
 assert.equal(usesUnifiedDirectionNavigation(null,true,true),false)
})
