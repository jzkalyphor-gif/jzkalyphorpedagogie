-- ============================================================================
-- JZ KALYPHOR — Schéma Supabase (base de données + sécurité + stockage)
-- ============================================================================
-- À exécuter UNE SEULE FOIS dans le SQL Editor du dashboard Supabase :
--   https://supabase.com/dashboard/project/<votre-projet>/sql/new
--
-- Ce script crée :
--   • les tables (étudiants, cours, progression, bilans hebdo, paramètres, rôles)
--   • la sécurité ligne par ligne (RLS) : un étudiant ne voit que ses données
--   • les fonctions d'administration (création/suppression d'étudiant, bannissement)
--   • le hook de jeton (rôle admin/étudiant dans le JWT)
--   • le bucket de stockage privé pour les preuves
--   • la publication temps réel
--   • les données de départ (formateur + étudiants de démonstration)
--
-- ENSUITE, dans le dashboard : Authentication → Hooks → "Custom Access Token"
--   → activer et choisir la fonction : public.custom_access_token_hook
-- ============================================================================

create extension if not exists pgcrypto with schema extensions;

-- ----------------------------------------------------------------------------
-- 1. TABLES
-- ----------------------------------------------------------------------------

create table if not exists public.user_roles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('admin', 'student'))
);

create table if not exists public.students (
  id text primary key,
  auth_user_id uuid not null unique references auth.users (id) on delete cascade,
  name text not null,
  whatsapp text not null,
  registration text not null unique,
  cohort text not null check (cohort ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  access_sent_at timestamptz
);

create table if not exists public.courses (
  id text primary key,
  title text not null,
  description text not null,
  type text not null check (type in ('youtube', 'link', 'document')),
  url text not null,
  -- 'all' | 'cohort:AAAA-MM' | id étudiant
  target text not null default 'all',
  created_at timestamptz not null default now(),
  external_credentials jsonb not null default '{}'::jsonb
);

create table if not exists public.progress (
  student_id text not null references public.students (id) on delete cascade,
  course_id text not null references public.courses (id) on delete cascade,
  status text not null default 'not_started'
    check (status in ('not_started', 'in_progress', 'submitted')),
  hours integer not null default 0,
  minutes integer not null default 0,
  report text not null default '',
  proofs jsonb not null default '[]'::jsonb,
  submitted_at timestamptz,
  timer_seconds integer not null default 0,
  timer_started_at bigint,
  resource_opened_at timestamptz,
  reviewed_at timestamptz,
  primary key (student_id, course_id)
);

create table if not exists public.weekly_reports (
  id text primary key,
  student_id text not null references public.students (id) on delete cascade,
  week_start date not null,
  hours integer not null default 0,
  minutes integer not null default 0,
  course_ids text[] not null default '{}',
  summary text not null default '',
  difficulties text not null default '',
  next_goals text not null default '',
  proofs jsonb not null default '[]'::jsonb,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  unique (student_id, week_start)
);

create table if not exists public.settings (
  id integer primary key default 1 check (id = 1),
  portal_url text not null default ''
);

-- Index utiles pour les politiques de sécurité
create index if not exists students_auth_user_id_idx on public.students (auth_user_id);
create index if not exists students_cohort_idx on public.students (cohort);
create index if not exists progress_student_id_idx on public.progress (student_id);
create index if not exists weekly_reports_student_id_idx on public.weekly_reports (student_id);
create index if not exists weekly_reports_week_start_idx on public.weekly_reports (week_start);

-- ----------------------------------------------------------------------------
-- 2. FONCTIONS UTILITAIRES (appelées par les politiques RLS)
-- ----------------------------------------------------------------------------

-- Rôle de l'utilisateur connecté (admin / student)
create or replace function public.is_admin()
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = (select auth.uid()) and role = 'admin'
  );
$$;

-- Fiche étudiant de l'utilisateur connecté (null si formateur)
create or replace function public.my_student_id()
returns text
language sql
stable
set search_path = public
as $$
  select id from public.students where auth_user_id = (select auth.uid());
$$;

-- Cohorte de l'utilisateur connecté (null si formateur)
create or replace function public.my_cohort()
returns text
language sql
stable
set search_path = public
as $$
  select cohort from public.students where auth_user_id = (select auth.uid());
$$;

-- ----------------------------------------------------------------------------
-- 3. SÉCURITÉ LIGNE PAR LIGNE (RLS)
-- ----------------------------------------------------------------------------

alter table public.user_roles enable row level security;
alter table public.students enable row level security;
alter table public.courses enable row level security;
alter table public.progress enable row level security;
alter table public.weekly_reports enable row level security;
alter table public.settings enable row level security;

-- user_roles : chacun voit son rôle, le formateur voit tout
revoke all on public.user_roles from anon, authenticated;
grant select on public.user_roles to authenticated;
create policy "user_roles_select" on public.user_roles for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());
create policy "user_roles_admin_write" on public.user_roles for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- students : l'étudiant lit sa fiche, le formateur fait tout
revoke all on public.students from anon, authenticated;
grant select, update on public.students to authenticated;
create policy "students_select" on public.students for select to authenticated
  using (public.is_admin() or id = public.my_student_id());
create policy "students_admin_update" on public.students for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
-- insert/delete uniquement via les fonctions sécurisées (create_student / delete_student)

-- courses : l'étudiant lit les cours qui lui sont destinés
revoke all on public.courses from anon, authenticated;
grant select, insert, update, delete on public.courses to authenticated;
create policy "courses_select" on public.courses for select to authenticated
  using (
    public.is_admin()
    or target = 'all'
    or target = 'cohort:' || public.my_cohort()
    or target = public.my_student_id()
  );
create policy "courses_admin_insert" on public.courses for insert to authenticated
  with check (public.is_admin());
create policy "courses_admin_update" on public.courses for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "courses_admin_delete" on public.courses for delete to authenticated
  using (public.is_admin());

-- progress : l'étudiant gère ses lignes, le formateur lit et annote
revoke all on public.progress from anon, authenticated;
grant select, insert, update, delete on public.progress to authenticated;
create policy "progress_select" on public.progress for select to authenticated
  using (public.is_admin() or student_id = public.my_student_id());
create policy "progress_insert" on public.progress for insert to authenticated
  with check (student_id = public.my_student_id());
create policy "progress_update" on public.progress for update to authenticated
  using (public.is_admin() or student_id = public.my_student_id())
  with check (public.is_admin() or student_id = public.my_student_id());
create policy "progress_delete" on public.progress for delete to authenticated
  using (public.is_admin() or student_id = public.my_student_id());

-- weekly_reports : idem
revoke all on public.weekly_reports from anon, authenticated;
grant select, insert, update, delete on public.weekly_reports to authenticated;
create policy "weekly_select" on public.weekly_reports for select to authenticated
  using (public.is_admin() or student_id = public.my_student_id());
create policy "weekly_insert" on public.weekly_reports for insert to authenticated
  with check (student_id = public.my_student_id());
create policy "weekly_update" on public.weekly_reports for update to authenticated
  using (public.is_admin() or student_id = public.my_student_id())
  with check (public.is_admin() or student_id = public.my_student_id());
create policy "weekly_delete" on public.weekly_reports for delete to authenticated
  using (public.is_admin() or student_id = public.my_student_id());

-- settings : lecture publique (lien de l'espace), écriture formateur
revoke all on public.settings from anon, authenticated;
grant select on public.settings to anon, authenticated;
grant insert, update on public.settings to authenticated;
create policy "settings_select" on public.settings for select to anon, authenticated
  using (true);
create policy "settings_admin_write" on public.settings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ----------------------------------------------------------------------------
-- 4. HOOK DE JETON : ajoute le rôle (admin/student) dans le JWT
--    → À activer dans le dashboard : Authentication → Hooks → Custom Access Token
-- ----------------------------------------------------------------------------

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = public, extensions
as $$
declare
  claims jsonb;
  v_role text;
begin
  claims := event->'claims';
  select role into v_role from public.user_roles
  where user_id = (event->>'user_id')::uuid;
  claims := jsonb_set(claims, '{app_role}', to_jsonb(coalesce(v_role, 'student')));
  return jsonb_set(event, '{claims}', claims);
end;
$$;

grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
grant usage on schema public to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;

-- ----------------------------------------------------------------------------
-- 5. FONCTIONS D'ADMINISTRATION (appelées par le formateur, vérifient le rôle)
-- ----------------------------------------------------------------------------

-- Rôle de l'utilisateur connecté (pratique pour le client après connexion)
create or replace function public.get_my_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.user_roles where user_id = (select auth.uid());
$$;
revoke all on function public.get_my_role() from anon, public;
grant execute on function public.get_my_role() to authenticated;

-- Création d'un étudiant : immatriculation générée + compte de connexion créé.
-- Le mot de passe technique dérive de l'immatriculation (l'étudiant ne le connaît pas) :
--   sha256('jzkalyphor|student|v1|' || IMMATRICULATION_EN_MAJUSCULES)
-- L'étudiant se connecte avec son nom + son immatriculation ; l'application calcule
-- ces valeurs automatiquement.
create or replace function public.create_student(p_name text, p_whatsapp text, p_cohort text)
returns public.students
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_name text := btrim(regexp_replace(p_name, '\s+', ' ', 'g'));
  v_words text[];
  v_initials text;
  v_base text;
  v_registration text;
  v_suffix integer := 1;
  v_student_id text := gen_random_uuid()::text;
  v_auth_id uuid := gen_random_uuid();
  v_email text;
  v_password text;
  v_row public.students;
begin
  if not public.is_admin() then
    raise exception 'Accès réservé au formateur';
  end if;
  if length(v_name) < 3 or v_name !~ '\s' then
    raise exception 'Saisissez le nom complet de l''étudiant (prénom et nom)';
  end if;
  if p_cohort !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Mois d''adhésion invalide';
  end if;
  if exists (select 1 from public.students where lower(name) = lower(v_name)) then
    raise exception 'Un compte porte déjà ce nom';
  end if;
  if exists (select 1 from public.students where whatsapp = p_whatsapp) then
    raise exception 'Ce numéro WhatsApp est déjà associé à un étudiant';
  end if;

  -- Initiales (jusqu'à 3 mots, accents normalisés)
  v_words := string_to_array(
    upper(translate(v_name, 'àâäéèêëîïôöùûüçÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ', 'aaaeeeeiioouuucAAAEEEEIIOOUUUC')),
    ' '
  );
  select string_agg(left(w, 1), '') into v_initials
  from unnest((v_words)[1:3]) as w
  where w ~ '^[A-Z]';
  if coalesce(length(v_initials), 0) < 2 then
    select left(regexp_replace(v_words[1], '[^A-Z]', '', 'g'), 2) into v_initials;
  end if;
  v_initials := coalesce(nullif(v_initials, ''), 'JZ');

  -- Immatriculation unique : INITIALES-AAAA-MM (+ indice si homonymie)
  v_base := v_initials || '-' || p_cohort;
  v_registration := v_base;
  while exists (select 1 from public.students where registration = v_registration) loop
    v_suffix := v_suffix + 1;
    v_registration := v_base || '-' || v_suffix;
  end loop;

  v_email := lower(v_registration) || '@id.jzkalyphor.app';
  v_password := encode(
    extensions.digest('jzkalyphor|student|v1|' || upper(v_registration), 'sha256'),
    'hex'
  );

  -- Compte d'authentification (mot de passe technique, inconnu de l'étudiant)
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, is_sso_user, is_anonymous
  ) values (
    '00000000-0000-0000-0000-000000000000',
    v_auth_id, 'authenticated', 'authenticated',
    v_email, extensions.crypt(v_password, extensions.gen_salt('bf')),
    now(), false, false
  );

  insert into public.students
    (id, auth_user_id, name, whatsapp, registration, cohort, active, created_at)
  values
    (v_student_id, v_auth_id, v_name, p_whatsapp, v_registration, p_cohort, true, now());

  insert into public.user_roles (user_id, role) values (v_auth_id, 'student');

  select * into v_row from public.students where id = v_student_id;
  return v_row;
end;
$$;
revoke all on function public.create_student(text, text, text) from anon, public;
grant execute on function public.create_student(text, text, text) to authenticated;

-- Activation / suspension : la suspension bannit aussi le compte de connexion
create or replace function public.set_student_active(p_student_id text, p_active boolean)
returns public.students
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_row public.students;
begin
  if not public.is_admin() then
    raise exception 'Accès réservé au formateur';
  end if;
  update public.students set active = p_active where id = p_student_id;
  update auth.users
  set banned_until = case when p_active then null else 'infinity'::timestamptz end
  where id = (select auth_user_id from public.students where id = p_student_id);
  select * into v_row from public.students where id = p_student_id;
  return v_row;
end;
$$;
revoke all on function public.set_student_active(text, boolean) from anon, public;
grant execute on function public.set_student_active(text, boolean) to authenticated;

-- Suppression : cours ciblés, accès externes, rapports, bilans, compte de connexion
create or replace function public.delete_student(p_student_id text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_auth_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Accès réservé au formateur';
  end if;
  select auth_user_id into v_auth_id from public.students where id = p_student_id;
  -- Retire l'étudiant des accès externes des cours
  update public.courses
  set external_credentials = external_credentials - p_student_id
  where external_credentials ? p_student_id;
  -- Supprime les cours qui lui étaient exclusivement attribués
  delete from public.courses where target = p_student_id;
  -- progress / weekly_reports / user_roles supprimés en cascade (FK)
  delete from auth.users where id = v_auth_id;
  delete from public.students where id = p_student_id;
end;
$$;
revoke all on function public.delete_student(text) from anon, public;
grant execute on function public.delete_student(text) to authenticated;

-- ----------------------------------------------------------------------------
-- 6. STOCKAGE PRIVÉ DES PREUVES (bucket « proofs »)
-- ----------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'proofs', 'proofs', false, 2097152,
  array['image/png', 'image/jpeg', 'image/webp', 'application/pdf']
)
on conflict (id) do nothing;

-- Chemin attendu : <auth_user_id>/<student_id>/<scope>/<fichier>
create policy "proofs_select" on storage.objects for select to authenticated
  using (
    bucket_id = 'proofs'
    and (public.is_admin() or owner = (select auth.uid()))
  );
create policy "proofs_insert" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'proofs'
    and owner = (select auth.uid())
    and name like (select auth.uid())::text || '/%'
  );
create policy "proofs_update" on storage.objects for update to authenticated
  using (bucket_id = 'proofs' and (public.is_admin() or owner = (select auth.uid())));
create policy "proofs_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'proofs' and (public.is_admin() or owner = (select auth.uid())));

-- ----------------------------------------------------------------------------
-- 7. TEMPS RÉEL (synchronisation multi-appareils)
-- ----------------------------------------------------------------------------

alter publication supabase_realtime add table public.students;
alter publication supabase_realtime add table public.courses;
alter publication supabase_realtime add table public.progress;
alter publication supabase_realtime add table public.weekly_reports;
alter publication supabase_realtime add table public.settings;

-- ----------------------------------------------------------------------------
-- 8. DONNÉES DE DÉPART
-- ----------------------------------------------------------------------------

-- Compte formateur : Yves Jonathan / Admin2026@JZ
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, is_sso_user, is_anonymous
) values (
  '00000000-0000-0000-0000-000000000000',
  '11111111-1111-1111-1111-111111111111',
  'authenticated', 'authenticated',
  'admin@jzkalyphor.app',
  extensions.crypt('Admin2026@JZ', extensions.gen_salt('bf')),
  now(), false, false
)
on conflict (id) do nothing;

insert into public.user_roles (user_id, role)
values ('11111111-1111-1111-1111-111111111111', 'admin')
on conflict (user_id) do nothing;

-- Étudiants de démonstration (connexion : nom + immatriculation)
do -- Amina Diallo / AD-2026-09
declare
  v_auth_id uuid := '22222222-2222-2222-2222-222222222222';
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, is_sso_user, is_anonymous
  ) values (
    '00000000-0000-0000-0000-000000000000', v_auth_id,
    'authenticated', 'authenticated',
    'ad-2026-09@id.jzkalyphor.app',
    extensions.crypt(
      encode(extensions.digest('jzkalyphor|student|v1|AD-2026-09', 'sha256'), 'hex'),
      extensions.gen_salt('bf')
    ),
    now(), false, false
  ) on conflict (id) do nothing;
  insert into public.students
    (id, auth_user_id, name, whatsapp, registration, cohort, active, created_at)
  values (
    'amina', v_auth_id, 'Amina Diallo', '+2250708091011',
    'AD-2026-09', '2026-09', true, now() - interval '18 days'
  ) on conflict (id) do nothing;
  insert into public.user_roles (user_id, role)
  values (v_auth_id, 'student') on conflict (user_id) do nothing;
end $$;

do -- Kouassi Marc / KM-2026-10
declare
  v_auth_id uuid := '33333333-3333-3333-3333-333333333333';
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, is_sso_user, is_anonymous
  ) values (
    '00000000-0000-0000-0000-000000000000', v_auth_id,
    'authenticated', 'authenticated',
    'km-2026-10@id.jzkalyphor.app',
    extensions.crypt(
      encode(extensions.digest('jzkalyphor|student|v1|KM-2026-10', 'sha256'), 'hex'),
      extensions.gen_salt('bf')
    ),
    now(), false, false
  ) on conflict (id) do nothing;
  insert into public.students
    (id, auth_user_id, name, whatsapp, registration, cohort, active, created_at)
  values (
    'marc', v_auth_id, 'Kouassi Marc', '+2250506070809',
    'KM-2026-10', '2026-10', true, now() - interval '12 days'
  ) on conflict (id) do nothing;
  insert into public.user_roles (user_id, role)
  values (v_auth_id, 'student') on conflict (user_id) do nothing;
end $$;

-- Cours de démonstration
insert into public.courses (id, title, description, type, url, target, created_at)
values
  ('marketing', 'Les fondamentaux du marketing digital',
   'Découvrez les principes essentiels du marketing numérique. Prenez des notes sur les canaux, les audiences et les leviers de croissance, puis partagez votre synthèse.',
   'youtube', 'https://www.youtube.com/watch?v=iU2yx3L-cXI', 'all', now() - interval '10 days'),
  ('contenu', 'Construire une stratégie de contenu',
   'Lisez cette ressource et identifiez trois actions concrètes pour créer une communication digitale cohérente et utile à votre projet.',
   'link', 'https://www.francenum.gouv.fr/guides-et-conseils/communication-et-publicite/strategie-de-communication/communication-en-ligne', 'all', now() - interval '7 days'),
  ('guide', 'Guide pratique : réussir sa transition numérique',
   'Consultez le guide PDF et préparez un plan d''action personnel en vous appuyant sur les étapes proposées dans le document.',
   'document', 'https://www.francenum.gouv.fr/files/Documents/En_avant_vers_le_numerique_juin_2019.pdf', 'all', now() - interval '4 days')
on conflict (id) do nothing;

-- Progression de démonstration
insert into public.progress
  (student_id, course_id, status, hours, minutes, report, proofs, submitted_at)
values
  ('amina', 'marketing', 'submitted', 2, 20,
   'J''ai étudié les bases du marketing digital et compris l''importance de définir une audience précise avant de choisir ses canaux. Je retiens surtout la complémentarité entre contenu, référencement et analyse des résultats. Pour mon projet, je commencerai par clarifier mon client idéal et établir un calendrier de publication hebdomadaire.',
   '[]'::jsonb, now() - interval '2 days'),
  ('amina', 'contenu', 'in_progress', 1, 10, '', '[]'::jsonb, null),
  ('marc', 'marketing', 'in_progress', 0, 45, '', '[]'::jsonb, null),
  ('marc', 'contenu', 'submitted', 1, 30,
   'La lecture m''a aidé à distinguer les objectifs de visibilité et de conversion. J''ai préparé trois pistes pour mon activité : publier des conseils pratiques, raconter des retours d''expérience et suivre les résultats chaque mois. Je vais tester ces formats avant d''ajuster ma stratégie.',
   '[]'::jsonb, now() - interval '1 day')
on conflict (student_id, course_id) do nothing;

-- Bilans hebdomadaires de démonstration
insert into public.weekly_reports
  (id, student_id, week_start, hours, minutes, course_ids, summary, difficulties, next_goals, submitted_at, reviewed_at)
values
  ('amina-' || to_char(date_trunc('week', now()) - interval '14 days', 'YYYY-MM-DD'),
   'amina', (date_trunc('week', now()) - interval '14 days')::date, 3, 30, '{marketing}',
   'Première semaine consacrée aux fondamentaux du marketing digital : canaux, audiences et objectifs. J''ai pris des notes structurées et identifié mon client idéal.',
   'Distinguer clairement les objectifs de visibilité et de conversion.',
   'Terminer le module marketing et préparer mon compte-rendu de cours.',
   (date_trunc('week', now()) - interval '14 days' + interval '6 days 21 hours')::timestamptz,
   (date_trunc('week', now()) - interval '14 days' + interval '6 days 21 hours')::timestamptz),
  ('amina-' || to_char(date_trunc('week', now()) - interval '7 days', 'YYYY-MM-DD'),
   'amina', (date_trunc('week', now()) - interval '7 days')::date, 4, 15, '{marketing,contenu}',
   'J''ai finalisé le cours sur le marketing digital et transmis mon rapport. J''ai commencé la ressource sur la stratégie de contenu et défini trois formats à tester.',
   'Trouver le temps de publier régulièrement.',
   'Finaliser la stratégie de contenu et démarrer le guide pratique.',
   (date_trunc('week', now()) - interval '7 days' + interval '6 days 21 hours')::timestamptz,
   (date_trunc('week', now()) - interval '7 days' + interval '6 days 21 hours')::timestamptz),
  ('marc-' || to_char(date_trunc('week', now()) - interval '7 days', 'YYYY-MM-DD'),
   'marc', (date_trunc('week', now()) - interval '7 days')::date, 2, 15, '{contenu}',
   'Lecture de la ressource sur la stratégie de contenu et préparation de trois pistes pour mon activité. Rapport de cours transmis.',
   'Organisation de mon temps d''étude en semaine.',
   'Reprendre le module marketing digital et le terminer avant dimanche.',
   -- Transmis APRÈS l'échéance (lundi matin) → apparaît « Rendu en retard »
   (date_trunc('week', now()) + interval '1 hour')::timestamptz,
   null)
on conflict (id) do nothing;

-- Paramètres
insert into public.settings (id, portal_url)
values (1, 'https://jzkalyphorpedagogie.netlify.app')
on conflict (id) do update set portal_url = excluded.portal_url;
