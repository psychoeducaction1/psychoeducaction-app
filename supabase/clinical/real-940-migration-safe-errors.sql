begin;
-- Keep only controlled semantic error identifiers; never expose SQL messages
-- containing values, names, contact details or query text.
do $$declare d text;needle text:='else ''IMPORT_FAILED_''||err end';replacement text:='else case when sqlerrm ~ ''^(MANDATE|MIGRATION|CLINICAL|CASE|PATIENT|ASSIGNMENT|SOURCE|DOCUMENTS)_[A-Z0-9_]{1,80}$'' then sqlerrm else ''IMPORT_FAILED_''||err end end';begin
 d:=pg_get_functiondef('public.clinical_migration_command_805_base(text,uuid,jsonb)'::regprocedure);
 if position(needle in d)=0 then raise exception 'MIGRATION_DIAGNOSTIC_BASELINE_CHANGED';end if;
 execute replace(d,needle,replacement);
end $$;
notify pgrst,'reload schema';
commit;
