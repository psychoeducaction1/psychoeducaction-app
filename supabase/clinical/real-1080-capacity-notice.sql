-- Keep the old rule for any account outside the controlled clinical rollout.
-- Preserve the existing idempotent replay before checking the clock.
begin;
do $patch$
declare
  original text;
  needle text:='if v_start_at<=clock_timestamp() then';
  restricted_rule text:=$rule$if v_start_at<=clock_timestamp() or (
    v_start_at<statement_timestamp()+interval '72 hours'
    and exists(select 1 from clinical.controlled_activation activation
      join clinical.actor_capabilities capability on capability.profile_id=activation.profile_id
      join public.profiles profile on profile.id=activation.profile_id
      where activation.profile_id=v_actor and activation.enabled
        and profile.role='professionnel' and profile.is_active is distinct from false
        and profile.platform_access_enabled is distinct from false
        and capability.actor_kind in ('professional','supervisor'))
  ) then$rule$;
begin
  original:=pg_get_functiondef('public.clinical_create_capacity_offer(jsonb,integer,text,text,uuid)'::regprocedure);
  if length(original)-length(replace(original,needle,''))<>length(needle) then raise exception 'CAPACITY_NOTICE_SOURCE_CHANGED';end if;
  execute replace(original,needle,restricted_rule);
end $patch$;
notify pgrst,'reload schema';
commit;
