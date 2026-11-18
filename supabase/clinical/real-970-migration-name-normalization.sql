-- Same name comparison as the UI. No existing records or access are changed.
begin;
create function clinical.migration_name_key(p_value text) returns text
language sql immutable set search_path='' as $$
 select regexp_replace(normalize(lower(coalesce(p_value,'')),NFD),'[^a-z0-9]','','g')
$$;
revoke all on function clinical.migration_name_key(text) from public,anon,authenticated,service_role;
do $migration$
declare d text;
 needle text:=$old$lower(btrim(a.first_name))=lower(btrim(x->>'firstName')) and lower(btrim(a.last_name))=lower(btrim(x->>'lastName'))$old$;
 replacement text:=$new$clinical.migration_name_key(a.first_name)<>'' and clinical.migration_name_key(a.last_name)<>'' and clinical.migration_name_key(a.first_name)=clinical.migration_name_key(x->>'firstName') and clinical.migration_name_key(a.last_name)=clinical.migration_name_key(x->>'lastName')$new$;
begin
 d:=pg_get_functiondef('public.clinical_migration_command_930_base(text,uuid,jsonb)'::regprocedure);
 if position(needle in d)=0 or position('OPERATIONAL_ASSOCIATION_CHANGED' in d)=0 then raise exception 'MIGRATION_970_BASELINE_CHANGED';end if;
 execute replace(d,needle,replacement);
end $migration$;
notify pgrst,'reload schema';
commit;
