// Only schema is copied from the named local pilot. All test rows are synthetic.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
if(process.argv.length!==2)throw Error('NO_ARGUMENTS_OR_REMOTE_DATABASE_ACCEPTED');
const root=path.resolve(import.meta.dirname,'../..'),container='supabase_db_pea-unification-pilot',database='pea_not_held_test_'+Date.now();
if(!/^pea_not_held_test_[0-9]{13}$/.test(database))throw Error('ISOLATED_TARGET_REFUSED');
const run=(args,input)=>execFileSync('docker',['exec',...(input?['-i']:[]),container,...args],{input,encoding:'utf8',maxBuffer:64*1024*1024,stdio:['pipe','pipe','pipe']});
const sql=input=>run(['psql','-X','-v','ON_ERROR_STOP=1','-U','postgres','-d',database],input);
const file=p=>fs.readFileSync(path.join(root,p),'utf8');
let created=false;
try{
 run(['createdb','-U','postgres',database]);created=true;
 sql('create schema if not exists extensions;create extension if not exists pgcrypto with schema extensions;create extension if not exists "uuid-ossp" with schema extensions;create extension if not exists btree_gist with schema extensions;');
 const schema=run(['pg_dump','-U','postgres','-d','postgres','--schema-only','--no-owner','--no-privileges','-n','public','-n','clinical','-n','auth','-n','storage']).replace(/CREATE SCHEMA /g,'CREATE SCHEMA IF NOT EXISTS ');
 sql(schema);sql(file('tests/fixtures/automatic-invoice-defaults.sql'));sql(file('supabase/clinical/real-1000-automatic-invoices-manual-delivery.sql'));
 const identityQuery="select 'public.clinical_unified_calendar_command(text,text,uuid,jsonb,uuid)'::regprocedure::oid command_oid,'clinical.note_json(uuid)'::regprocedure::oid note_oid;";
 const identities=sql(identityQuery);sql(file('supabase/clinical/real-1030-not-held-encounters.sql'));
 if(sql(identityQuery)!==identities)throw Error('EXISTING_FUNCTION_IDENTITY_CHANGED');
 sql(file('tests/fixtures/automatic-invoice-client.sql')+'\n'+file('tests/integration/not-held-encounters.sql'));
 console.log(JSON.stringify({passed:true,mode:'local-schema-only-with-synthetic-data',sourceRowsCopied:0,remoteDatabase:false,providerCalls:0,transactionRolledBack:true}));
}catch(error){console.error(String(error.stderr||error.message).slice(0,2500));process.exitCode=1}
finally{if(created)run(['dropdb','-U','postgres',database])}
