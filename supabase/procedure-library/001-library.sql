-- Prepared migration only. No real membership is created by this script.
begin;
create table public.procedure_library_members (
  profile_id uuid primary key references public.profiles(id) on delete restrict,
  active boolean not null default true,
  can_edit boolean not null default false
);
create table public.procedure_library_sections (
  id uuid primary key,
  title text not null check(length(btrim(title)) between 1 and 120),
  position integer not null default 0,
  version integer not null default 1 check(version>0)
);
create table public.procedure_library_articles (
  id uuid primary key,
  section_id uuid not null references public.procedure_library_sections(id) on delete restrict,
  title text not null check(length(btrim(title)) between 1 and 160),
  body text not null default '' check(length(body)<=40000),
  keywords text[] not null default '{}',
  status text not null default 'review' check(status in('current','review','draft')),
  version integer not null default 1 check(version>0),
  source_title text,
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid references public.profiles(id) on delete restrict
);
create table public.procedure_library_revisions (
  article_id uuid not null references public.procedure_library_articles(id) on delete restrict,
  version integer not null,
  section_id uuid not null references public.procedure_library_sections(id) on delete restrict,
  title text not null,
  body text not null,
  keywords text[] not null,
  status text not null,
  edited_by uuid references public.profiles(id) on delete restrict,
  edited_at timestamptz not null default clock_timestamp(),
  primary key(article_id,version)
);

create function public.procedure_library_access() returns jsonb
language sql stable security definer set search_path='' set row_security=off as $$
  select jsonb_build_object('canRead',exists(select 1 from public.procedure_library_members m join public.profiles p on p.id=m.profile_id
    where m.profile_id=auth.uid() and m.active and p.platform_access_enabled is distinct from false),
    'canEdit',exists(select 1 from public.procedure_library_members m join public.profiles p on p.id=m.profile_id
    where m.profile_id=auth.uid() and m.active and m.can_edit and p.platform_access_enabled is distinct from false));
$$;
alter table public.procedure_library_members enable row level security;
alter table public.procedure_library_sections enable row level security;
alter table public.procedure_library_articles enable row level security;
alter table public.procedure_library_revisions enable row level security;
create policy procedure_member_self on public.procedure_library_members for select to authenticated
  using(profile_id=auth.uid() and (public.procedure_library_access()->>'canRead')::boolean);
create policy procedure_sections_read on public.procedure_library_sections for select to authenticated using((public.procedure_library_access()->>'canRead')::boolean);
create policy procedure_articles_read on public.procedure_library_articles for select to authenticated using((public.procedure_library_access()->>'canRead')::boolean);
create policy procedure_revisions_read on public.procedure_library_revisions for select to authenticated using((public.procedure_library_access()->>'canRead')::boolean);

create function public.procedure_library_snapshot() returns jsonb
language plpgsql stable security definer set search_path='' set row_security=off as $$
declare access jsonb:=public.procedure_library_access();
begin
  if not (access->>'canRead')::boolean then raise exception 'PROCEDURES_FORBIDDEN' using errcode='42501';end if;
  return jsonb_build_object('canEdit',(access->>'canEdit')::boolean,
    'sections',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'title',s.title,'position',s.position,'version',s.version) order by s.position,s.title),'[]') from public.procedure_library_sections s),
    'articles',(select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'sectionId',a.section_id,'title',a.title,'body',a.body,'keywords',a.keywords,'status',a.status,'version',a.version,'sourceTitle',a.source_title,'updatedAt',a.updated_at) order by a.title),'[]') from public.procedure_library_articles a));
end $$;

create function public.procedure_library_save_section(p_id uuid,p_title text,p_expected_version integer) returns jsonb
language plpgsql security definer set search_path='' set row_security=off as $$
declare result public.procedure_library_sections;
begin
  perform 1 from public.procedure_library_members m join public.profiles p on p.id=m.profile_id
    where m.profile_id=auth.uid() and m.active and m.can_edit and p.platform_access_enabled is distinct from false for share of m,p;
  if not found then raise exception 'PROCEDURES_FORBIDDEN' using errcode='42501';end if;
  if p_id is null or p_title is null or length(btrim(p_title)) not between 1 and 120 or p_expected_version is null or p_expected_version<0 then raise exception 'PROCEDURES_INVALID' using errcode='22023';end if;
  if p_expected_version=0 then
    insert into public.procedure_library_sections(id,title,position) values(p_id,btrim(p_title),(select coalesce(max(position),0)+1 from public.procedure_library_sections)) returning * into result;
  else
    update public.procedure_library_sections set title=btrim(p_title),version=version+1 where id=p_id and version=p_expected_version returning * into result;
    if not found then raise exception 'PROCEDURES_CONFLICT' using errcode='40001';end if;
  end if;
  return jsonb_build_object('id',result.id,'version',result.version);
end $$;

create function public.procedure_library_save_article(p_id uuid,p_section_id uuid,p_title text,p_body text,p_keywords text[],p_status text,p_expected_version integer) returns jsonb
language plpgsql security definer set search_path='' set row_security=off as $$
declare result public.procedure_library_articles;
begin
  -- Membership/profile locks serialize saves with revocation, without granting membership administration.
  perform 1 from public.procedure_library_members m join public.profiles p on p.id=m.profile_id
    where m.profile_id=auth.uid() and m.active and m.can_edit and p.platform_access_enabled is distinct from false for share of m,p;
  if not found then raise exception 'PROCEDURES_FORBIDDEN' using errcode='42501';end if;
  if p_id is null or p_section_id is null or p_title is null or length(btrim(p_title)) not between 1 and 160
    or p_body is null or length(p_body)>40000 or (p_status='current' and length(btrim(p_body))=0) or p_keywords is null or cardinality(p_keywords)>30
    or exists(select 1 from unnest(p_keywords) word where word is null or length(btrim(word)) not between 1 and 60)
    or p_status is null or p_status not in('current','review','draft') or p_expected_version is null or p_expected_version<0 then
    raise exception 'PROCEDURES_INVALID' using errcode='22023';end if;
  if p_expected_version=0 then
    insert into public.procedure_library_articles(id,section_id,title,body,keywords,status,updated_by)
      values(p_id,p_section_id,btrim(p_title),p_body,p_keywords,p_status,auth.uid()) returning * into result;
  else
    update public.procedure_library_articles set section_id=p_section_id,title=btrim(p_title),body=p_body,keywords=p_keywords,status=p_status,version=version+1,updated_at=clock_timestamp(),updated_by=auth.uid()
      where id=p_id and version=p_expected_version returning * into result;
    if not found then raise exception 'PROCEDURES_CONFLICT' using errcode='40001';end if;
  end if;
  insert into public.procedure_library_revisions(article_id,version,section_id,title,body,keywords,status,edited_by,edited_at)
    values(result.id,result.version,result.section_id,result.title,result.body,result.keywords,result.status,auth.uid(),result.updated_at);
  return jsonb_build_object('id',result.id,'version',result.version);
end $$;

revoke all on public.procedure_library_members,public.procedure_library_sections,public.procedure_library_articles,public.procedure_library_revisions from public,anon,authenticated,service_role;
grant select on public.procedure_library_members,public.procedure_library_sections,public.procedure_library_articles,public.procedure_library_revisions to authenticated;
revoke all on function public.procedure_library_access(),public.procedure_library_snapshot(),public.procedure_library_save_section(uuid,text,integer),public.procedure_library_save_article(uuid,uuid,text,text,text[],text,integer) from public,anon,authenticated,service_role;
grant execute on function public.procedure_library_access(),public.procedure_library_snapshot(),public.procedure_library_save_section(uuid,text,integer),public.procedure_library_save_article(uuid,uuid,text,text,text[],text,integer) to authenticated;
commit;
