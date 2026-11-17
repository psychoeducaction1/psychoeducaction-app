-- Complement to 001-library.sql. Private atomic binary storage, like existing document archives.
-- No bucket, public URL, membership, existing document or existing procedure is changed.
begin;
create table public.procedure_library_pdfs (
  id uuid primary key,
  article_id uuid not null references public.procedure_library_articles(id) on delete restrict,
  document_id uuid not null,
  version integer not null check(version>0),
  label text not null check(length(btrim(label)) between 1 and 160),
  file_name text not null check(length(file_name) between 1 and 180),
  bytes bytea not null check(octet_length(bytes) between 1 and 3145728),
  sha256 text not null,
  uploaded_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  unique(document_id,version)
);
create index procedure_library_pdfs_article on public.procedure_library_pdfs(article_id,document_id,version desc);
alter table public.procedure_library_pdfs enable row level security;
create policy procedure_pdfs_read on public.procedure_library_pdfs for select to authenticated using((public.procedure_library_access()->>'canRead')::boolean);

create function public.procedure_library_list_pdfs(p_article_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' set row_security=off as $$
begin
  if not (public.procedure_library_access()->>'canRead')::boolean then raise exception 'PROCEDURES_FORBIDDEN' using errcode='42501';end if;
  if not exists(select 1 from public.procedure_library_articles where id=p_article_id) then raise exception 'PROCEDURES_NOT_FOUND' using errcode='P0002';end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'articleId',f.article_id,'documentId',f.document_id,'version',f.version,'label',f.label,'fileName',f.file_name,'byteLength',octet_length(f.bytes),'createdAt',f.created_at) order by f.document_id,f.version desc),'[]') from public.procedure_library_pdfs f where f.article_id=p_article_id);
end $$;

create function public.procedure_library_read_pdf(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' set row_security=off as $$
declare f public.procedure_library_pdfs;
begin
  if not (public.procedure_library_access()->>'canRead')::boolean then raise exception 'PROCEDURES_FORBIDDEN' using errcode='42501';end if;
  select * into f from public.procedure_library_pdfs where id=p_id;
  if not found then raise exception 'PROCEDURES_NOT_FOUND' using errcode='P0002';end if;
  return jsonb_build_object('id',f.id,'articleId',f.article_id,'documentId',f.document_id,'version',f.version,'label',f.label,'fileName',f.file_name,'byteLength',octet_length(f.bytes),'mediaType','application/pdf','sha256',f.sha256,'bytesBase64',replace(encode(f.bytes,'base64'),E'\n',''),'createdAt',f.created_at);
end $$;

create function public.procedure_library_save_pdf(p_id uuid,p_article_id uuid,p_document_id uuid,p_expected_version integer,p_label text,p_file_name text,p_bytes_base64 text) returns jsonb
language plpgsql security definer set search_path='' set row_security=off as $$
declare data bytea;digest text;current_version integer;existing public.procedure_library_pdfs;
begin
  perform 1 from public.procedure_library_members m join public.profiles p on p.id=m.profile_id
    where m.profile_id=auth.uid() and m.active and m.can_edit and p.platform_access_enabled is distinct from false for share of m,p;
  if not found then raise exception 'PROCEDURES_FORBIDDEN' using errcode='42501';end if;
  if p_id is null or p_article_id is null or p_document_id is null or p_expected_version is null or p_expected_version<0
    or p_label is null or length(btrim(p_label)) not between 1 and 160 or p_file_name is null or length(p_file_name) not between 1 and 180
    or p_file_name !~* '\.pdf$' or p_file_name ~ '[[:cntrl:]/\\]'
    or p_bytes_base64 is null or length(p_bytes_base64) not between 4 and 4194304 or length(p_bytes_base64)%4<>0 or p_bytes_base64 !~ '^[A-Za-z0-9+/]*={0,2}$' then
    raise exception 'PROCEDURES_INVALID_PDF' using errcode='22023';end if;
  data:=decode(p_bytes_base64,'base64');
  if octet_length(data) not between 1 and 3145728 or substring(data from 1 for 5)<>convert_to('%PDF-','UTF8') or replace(encode(data,'base64'),E'\n','')<>p_bytes_base64 then raise exception 'PROCEDURES_INVALID_PDF' using errcode='22023';end if;
  digest:=encode(sha256(data),'hex');
  perform 1 from public.procedure_library_articles where id=p_article_id for update;
  if not found then raise exception 'PROCEDURES_NOT_FOUND' using errcode='P0002';end if;
  select * into existing from public.procedure_library_pdfs where id=p_id;
  if found then
    if existing.article_id=p_article_id and existing.document_id=p_document_id and existing.version=p_expected_version+1 and existing.label=btrim(p_label) and existing.file_name=p_file_name and existing.sha256=digest and existing.uploaded_by=auth.uid() then
      return jsonb_build_object('id',existing.id,'version',existing.version);
    end if;
    raise exception 'PROCEDURES_CONFLICT' using errcode='40001';
  end if;
  if exists(select 1 from public.procedure_library_pdfs where document_id=p_document_id and article_id<>p_article_id) then raise exception 'PROCEDURES_CONFLICT' using errcode='40001';end if;
  select coalesce(max(version),0) into current_version from public.procedure_library_pdfs where document_id=p_document_id;
  if current_version<>p_expected_version then raise exception 'PROCEDURES_CONFLICT' using errcode='40001';end if;
  insert into public.procedure_library_pdfs(id,article_id,document_id,version,label,file_name,bytes,sha256,uploaded_by)
    values(p_id,p_article_id,p_document_id,current_version+1,btrim(p_label),p_file_name,data,digest,auth.uid());
  return jsonb_build_object('id',p_id,'version',current_version+1);
end $$;

revoke all on public.procedure_library_pdfs from public,anon,authenticated,service_role;
grant select(id,article_id,document_id,version,label,file_name,sha256,uploaded_by,created_at) on public.procedure_library_pdfs to authenticated;
revoke all on function public.procedure_library_list_pdfs(uuid),public.procedure_library_read_pdf(uuid),public.procedure_library_save_pdf(uuid,uuid,uuid,integer,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.procedure_library_list_pdfs(uuid),public.procedure_library_read_pdf(uuid),public.procedure_library_save_pdf(uuid,uuid,uuid,integer,text,text,text) to authenticated;
commit;
