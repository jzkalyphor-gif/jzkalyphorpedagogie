-- Supabase RLS + auth bootstrap for JZ Kalyphor
-- Run after the base schema is applied.

create extension if not exists pgcrypto;

-- 1) Tables already expected by the app
-- public.user_roles
-- public.students
-- public.courses
-- public.progress
-- public.weekly_reports
-- public.settings

-- 2) Helper functions for role detection
create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.user_roles ur
    where ur.user_id = auth.uid() and ur.role = 'admin'
  );
$$;

create or replace function public.my_student_id()
returns text
language sql
stable
as $$
  select id
  from public.students
  where auth_user_id = auth.uid()
  limit 1;
$$;

create or replace function public.my_cohort()
returns text
language sql
stable
as $$
  select cohort
  from public.students
  where auth_user_id = auth.uid()
  limit 1;
$$;

create or replace function public.get_my_role()
returns text
language sql
stable
as $$
  select case
    when public.is_admin() then 'admin'
    when public.my_student_id() is not null then 'student'
    else null
  end;
$$;

-- 3) Auth hook: enrich JWT claims with app role
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  claims jsonb;
  v_role text;
begin
  claims := event->'claims';

  select role into v_role
  from public.user_roles
  where user_id = (event->>'user_id')::uuid
  limit 1;

  if v_role is null then
    v_role := 'student';
  end if;

  claims := jsonb_set(claims, '{app_role}', to_jsonb(v_role));
  return jsonb_build_object('claims', claims);
end;
$$;

grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;

-- 4) Tables policies: read/write by admins or self
alter table public.user_roles enable row level security;
alter table public.students enable row level security;
alter table public.courses enable row level security;
alter table public.progress enable row level security;
alter table public.weekly_reports enable row level security;
alter table public.settings enable row level security;

-- user_roles
create policy "user_roles_select" on public.user_roles
for select to authenticated
using (user_id = auth.uid() or public.is_admin());

create policy "user_roles_admin_write" on public.user_roles
for all to authenticated
using (public.is_admin())
with check (public.is_admin());

-- students
create policy "students_select" on public.students
for select to authenticated
using (auth_user_id = auth.uid() or public.is_admin());

create policy "students_update" on public.students
for update to authenticated
using (auth_user_id = auth.uid() or public.is_admin())
with check (auth_user_id = auth.uid() or public.is_admin());

create policy "students_admin_write" on public.students
for insert to authenticated
with check (public.is_admin());

create policy "students_admin_delete" on public.students
for delete to authenticated
using (public.is_admin());

-- courses
create policy "courses_select" on public.courses
for select to authenticated
using (true);

create policy "courses_admin_write" on public.courses
for all to authenticated
using (public.is_admin())
with check (public.is_admin());

-- progress
create policy "progress_select" on public.progress
for select to authenticated
using (student_id = public.my_student_id() or public.is_admin());

create policy "progress_insert" on public.progress
for insert to authenticated
with check (
  student_id = public.my_student_id() or public.is_admin()
);

create policy "progress_update" on public.progress
for update to authenticated
using (student_id = public.my_student_id() or public.is_admin())
with check (
  student_id = public.my_student_id() or public.is_admin()
);

create policy "progress_delete" on public.progress
for delete to authenticated
using (student_id = public.my_student_id() or public.is_admin());

-- weekly_reports
create policy "weekly_reports_select" on public.weekly_reports
for select to authenticated
using (student_id = public.my_student_id() or public.is_admin());

create policy "weekly_reports_insert" on public.weekly_reports
for insert to authenticated
with check (
  student_id = public.my_student_id() or public.is_admin()
);

create policy "weekly_reports_update" on public.weekly_reports
for update to authenticated
using (student_id = public.my_student_id() or public.is_admin())
with check (
  student_id = public.my_student_id() or public.is_admin()
);

create policy "weekly_reports_delete" on public.weekly_reports
for delete to authenticated
using (student_id = public.my_student_id() or public.is_admin());

-- settings
create policy "settings_select" on public.settings
for select to authenticated
using (true);

create policy "settings_admin_write" on public.settings
for all to authenticated
using (public.is_admin())
with check (public.is_admin());

-- 5) Student creation helper (kept aligned with app's API)
create or replace function public.create_student(p_name text, p_whatsapp text, p_cohort text)
returns public.students
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student public.students;
  v_name text := trim(p_name);
  v_whatsapp text := trim(p_whatsapp);
  v_cohort text := trim(p_cohort);
  v_registration text;
  v_initials text;
  v_base text;
  v_suffix int := 1;
  v_email text;
  v_password text;
  v_auth_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Accès réservé au formatteur';
  end if;

  if length(v_name) < 3 then
    raise exception 'Le nom complet est requis';
  end if;

  if v_cohort !~ '^[A-Z]{2,5}-[0-9]{2,4}$' then
    raise exception 'Mois d''adhésion invalide';
  end if;

  v_registration := upper(regexp_replace(v_name, '\s+', '', 'g'));
  v_initials := substring(v_registration from 1 for 3);
  v_base := lower(v_initials || '-' || v_cohort);
  v_email := lower(v_base || '@id.jzkalyphor.app');

  while exists (select 1 from public.students where registration = v_base || '-' || v_suffix::text) loop
    v_suffix := v_suffix + 1;
  end loop;

  v_registration := v_base || '-' || v_suffix;

  v_password := encode(digest('jzkalyphor|student|v1|' || upper(v_registration), 'sha256'), 'hex');

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, is_sso_user, is_anonymous
  )
  values (
    '00000000-0000-0000-0000-000000000000',
    gen_random_uuid(),
    'authenticated',
    'authenticated',
    v_email,
    v_password,
    now(),
    false,
    false
  )
  returning id into v_auth_id;

  insert into public.students (id, auth_user_id, name, whatsapp, registration, cohort, active, created_at)
  values (
    gen_random_uuid(),
    v_auth_id,
    v_name,
    v_whatsapp,
    v_registration,
    v_cohort,
    true,
    now()
  )
  returning * into v_student;

  insert into public.user_roles(user_id, role)
  values (v_auth_id, 'student')
  on conflict (user_id) do nothing;

  return v_student;
end;
$$;

grant execute on function public.create_student(text, text, text) to authenticated;

-- 6) Student deactivation / deletion helper
create or replace function public.set_student_active(p_student_id text, p_active boolean)
returns public.students
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.students;
begin
  if not public.is_admin() then
    raise exception 'Accès réservé au formatteur';
  end if;

  update public.students
  set active = p_active
  where id = p_student_id
  returning * into v_row;

  if p_active then
    update auth.users
    set banned_until = null
    where id = (select auth_user_id from public.students where id = p_student_id);
  else
    update auth.users
    set banned_until = 'infinity'::timestamptz
    where id = (select auth_user_id from public.students where id = p_student_id);
  end if;

  return v_row;
end;
$$;

grant execute on function public.set_student_active(text, boolean) to authenticated;

create or replace function public.delete_student(p_student_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Accès réservé au formatteur';
  end if;

  select auth_user_id into v_auth_id from public.students where id = p_student_id;

  delete from public.courses where target = p_student_id;
  delete from public.progress where student_id = p_student_id;
  delete from public.weekly_reports where student_id = p_student_id;
  delete from public.user_roles where user_id = v_auth_id;
  delete from auth.users where id = v_auth_id;
  delete from public.students where id = p_student_id;
end;
$$;

grant execute on function public.delete_student(text) to authenticated;

-- 7) Storage bucket for proofs
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('proofs', 'proofs', false, 2097152, array['image/png', 'image/jpeg', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

-- 8) Seed admin account (example)
-- change email/password to your real admin credentials before production
-- Insert only if not already present.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, is_sso_user, is_anonymous
)
values (
  '00000000-0000-0000-0000-000000000000',
  '11111111-1111-1111-1111-111111111111',
  'authenticated',
  'authenticated',
  'admin@jzkalyphor.app',
  crypt('Admin2026@JZ', gen_salt('bf')),
  now(),
  false,
  false
)
on conflict (id) do nothing;

insert into public.user_roles (user_id, role)
values ('11111111-1111-1111-1111-111111111111', 'admin')
on conflict (user_id) do nothing;

-- 9) Real-time publication for app tables
alter publication supabase_realtime add table public.students;
alter publication supabase_realtime add table public.courses;
alter publication supabase_realtime add table public.progress;
alter publication supabase_realtime add table public.weekly_reports;
alter publication supabase_realtime add table public.settings;
