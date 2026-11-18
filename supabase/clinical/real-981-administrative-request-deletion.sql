-- Atomic administrative deletion; no request is deleted by installation.
begin;
create function public.clinical_admin_delete_assignment_request(p_id uuid,p_expected_version integer,p_key uuid) returns jsonb
language plpgsql security definer set search_path='' set row_security=off as $$
declare actor uuid:=auth.uid();r public.assignment_requests;pro uuid;intent text;receipt clinical.admission_receipts;answer jsonb;linked integer;taken integer;refused integer;pending integer;
begin
 perform 1 from public.profiles where id=actor for share;
 if actor is null or not public.is_super_admin() then raise exception 'REQUEST_DELETE_FORBIDDEN' using errcode='42501';end if;
 if p_id is null or p_key is null or p_expected_version is null or p_expected_version<1 then raise exception 'REQUEST_DELETE_INVALID' using errcode='22023';end if;
 intent:=encode(sha256(convert_to(jsonb_build_array('capacity.delete',p_id,p_expected_version)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('request-delete/'||actor::text||'/'||p_key::text,0));
 select * into receipt from clinical.admission_receipts where actor_id=actor and request_key=p_key;
 if found then
  if receipt.intent_hash<>intent then raise exception 'REQUEST_DELETE_CONFLICT' using errcode='40001';end if;
  return receipt.result;
 end if;
 select professional_id into pro from public.assignment_requests where id=p_id;
 if pro is null then raise exception 'REQUEST_DELETE_NOT_FOUND' using errcode='P0002';end if;
 perform pg_advisory_xact_lock(hashtextextended('clinical-capacity/'||pro::text,0));
 select * into r from public.assignment_requests where id=p_id for update;
 if r.id is null then raise exception 'REQUEST_DELETE_NOT_FOUND' using errcode='P0002';end if;
 if r.clinical_version<>p_expected_version then raise exception 'REQUEST_DELETE_CONFLICT' using errcode='40001';end if;
 select count(*),count(*)filter(where is_active is true),count(*)filter(where is_active is false),count(*)filter(where is_active is null)
 into linked,taken,refused,pending from public.assigned_clients where assignment_request_id=p_id and canceled_at is null;
 update public.assigned_clients set assignment_request_id=null where assignment_request_id=p_id;
 -- Existing FKs cascade the request's offers and clear the receipt pointer;
 -- all assignments, client files and appointment records remain in place.
 delete from public.assignment_requests where id=p_id;
 insert into public.audit_logs(actor_profile_id,actor_name,actor_role,action,entity_type,entity_id,description,metadata)
 select actor,p.full_name,p.role,'assignment_request_deleted','assignment_request',p_id::text,'Demande professionnelle supprimée.',
 jsonb_build_object('professional_id',pro,'requested_count',r.requested_count,'linkedClients',linked,'serviceTaken',taken,'serviceNotTaken',refused,'pending',pending)
 from public.profiles p where p.id=actor;
 answer:=jsonb_build_object('success',true,'id',p_id,'linkedClients',linked,'serviceTaken',taken,'serviceNotTaken',refused,'pending',pending);
 insert into clinical.admission_receipts(actor_id,request_key,intent_hash,result)values(actor,p_key,intent,answer);
 return answer;
end $$;
revoke all on function public.clinical_admin_delete_assignment_request(uuid,integer,uuid) from public,anon,service_role;
grant execute on function public.clinical_admin_delete_assignment_request(uuid,integer,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
