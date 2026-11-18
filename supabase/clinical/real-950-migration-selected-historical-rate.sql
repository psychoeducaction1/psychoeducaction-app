-- Migration-only correction. No catalogue backdating or existing-data update.
begin;
do $migration$
declare d text;
 link_sql text:=$link$  insert into clinical.legacy_assignment_links(patient_id,episode_id,source_table,source_id,created_by)
    values(v_patient,v_episode,'assigned_clients',v_assignment.id,p_actor_id);$link$;
 case_sql text:='    returning id into v_case;';
 call_sql text:='linked:=clinical.migration_link_assignment((x->>''assignmentId'')::uuid,auth.uid());';
begin
 d:=replace(pg_get_functiondef('clinical.migration_link_assignment(uuid,uuid)'::regprocedure),E'\r','');
 if position(link_sql in d)=0 or position(case_sql in d)=0 or position('clinical.migration_can_delegate()' in d)=0 then raise exception 'MIGRATION_950_LINK_BASELINE_CHANGED';end if;
 -- Keep the original identity checks, locks, source associations and UUIDs.
 -- The case trigger sees no assignment link yet, so it does not build an
 -- intermediate mandate using the old assignment date. 920 prepares the final
 -- mandate once contacts, professional access and the selected rate are ready.
 d:=replace(d,'clinical.migration_link_assignment(', 'clinical.migration_link_assignment_individual(');
 d:=replace(d,link_sql,'');
 d:=replace(d,case_sql,case_sql||E'\n'||link_sql);
 d:=replace(d,E'begin\n',E'begin\n  perform clinical.migration_assert();\n  if p_actor_id is distinct from auth.uid() or not clinical.migration_can_delegate() then raise exception ''MIGRATION_FORBIDDEN'' using errcode=''42501'';end if;\n');
 execute d;
 d:=pg_get_functiondef('public.clinical_migration_command_805_base(text,uuid,jsonb)'::regprocedure);
 if position(call_sql in d)=0 then raise exception 'MIGRATION_950_COMMAND_BASELINE_CHANGED';end if;
 d:=replace(d,call_sql,$call$if x?'preparation' then
 linked:=clinical.migration_link_assignment_individual((x->>'assignmentId')::uuid,auth.uid());
 else linked:=clinical.migration_link_assignment((x->>'assignmentId')::uuid,auth.uid());end if;$call$);
 execute d;
end $migration$;
revoke all on function clinical.migration_link_assignment_individual(uuid,uuid) from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
