import { supabase } from "./supabaseClient";
import type {
  AppData,
  Course,
  ExternalCredentials,
  LoginMode,
  Progress,
  Proof,
  Session,
  Student,
  WeeklyReport,
} from "./types";

/**
 * Couche d'accès aux données en ligne (Supabase).
 *
 * Toutes les fonctions lèvent une Error avec un message en français.
 * La sécurité est assurée côté base (RLS) : un étudiant ne peut lire ou
 * modifier que ses propres lignes. La clé service_role n'est jamais utilisée ici.
 */

const db = supabase!;

/* ------------------------------ Utilitaires ------------------------------ */

export class ApiError extends Error {
  code: string;
  constructor(message: string, code = "error") {
    super(message);
    this.code = code;
  }
}

function sbId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function sha256Hex(text: string) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function normalizeName(name: string) {
  return name.trim().replace(/\s+/g, " ").toLocaleLowerCase("fr-FR");
}

export function normalizeRegistration(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

/** E-mail technique dérivé de l'immatriculation (invisible pour l'étudiant). */
export function studentLoginEmail(registration: string) {
  return `${normalizeRegistration(registration).toLowerCase()}@id.jzkalyphor.app`;
}

/** Mot de passe technique dérivé de l'immatriculation (identique au schéma SQL). */
export async function studentLoginPassword(registration: string) {
  return sha256Hex(
    `jzkalyphor|student|v1|${normalizeRegistration(registration)}`,
  );
}

function handleError(error: { message: string } | null, fallback: string) {
  if (!error) return;
  const message = error.message || fallback;
  // Erreurs Postgres renvoyées par les fonctions d'administration
  if (message.includes("Accès réservé")) throw new ApiError(message, "forbidden");
  if (message.includes("déjà ce nom")) throw new ApiError(message, "duplicate");
  if (message.includes("déjà associé")) throw new ApiError(message, "duplicate");
  if (message.includes("nom complet")) throw new ApiError(message, "invalid");
  if (message.includes("Mois d'adhésion")) throw new ApiError(message, "invalid");
  throw new ApiError(message, "error");
}

/* ------------------------------- Mappers --------------------------------- */

type StudentRow = {
  id: string;
  name: string;
  whatsapp: string;
  registration: string;
  cohort: string;
  active: boolean;
  created_at: string;
  access_sent_at: string | null;
};

type CourseRow = {
  id: string;
  title: string;
  description: string;
  type: "youtube" | "link" | "document";
  url: string;
  target: string;
  created_at: string;
  external_credentials: Record<string, ExternalCredentials> | null;
};

type ProgressRow = {
  student_id: string;
  course_id: string;
  status: Progress["status"];
  hours: number;
  minutes: number;
  report: string;
  proofs: Proof[];
  submitted_at: string | null;
  timer_seconds: number;
  timer_started_at: number | null;
  resource_opened_at: string | null;
  reviewed_at: string | null;
};

type WeeklyRow = {
  id: string;
  student_id: string;
  week_start: string;
  hours: number;
  minutes: number;
  course_ids: string[];
  summary: string;
  difficulties: string;
  next_goals: string;
  proofs: Proof[];
  submitted_at: string | null;
  reviewed_at: string | null;
};

function rowToStudent(row: StudentRow): Student {
  return {
    id: row.id,
    name: row.name,
    whatsapp: row.whatsapp,
    registration: row.registration,
    cohort: row.cohort,
    active: row.active,
    createdAt: row.created_at,
    accessSentAt: row.access_sent_at || undefined,
  };
}

function rowToCourse(row: CourseRow): Course {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    type: row.type,
    url: row.url,
    target: row.target,
    createdAt: row.created_at,
    externalCredentials: row.external_credentials || {},
  };
}

function rowToProgress(row: ProgressRow): Progress {
  return {
    studentId: row.student_id,
    courseId: row.course_id,
    status: row.status,
    hours: row.hours,
    minutes: row.minutes,
    report: row.report,
    proofs: Array.isArray(row.proofs) ? row.proofs : [],
    submittedAt: row.submitted_at || undefined,
    timerSeconds: row.timer_seconds || 0,
    timerStartedAt: row.timer_started_at || undefined,
    resourceOpenedAt: row.resource_opened_at || undefined,
    reviewedAt: row.reviewed_at || undefined,
  };
}

function rowToWeekly(row: WeeklyRow): WeeklyReport {
  return {
    id: row.id,
    studentId: row.student_id,
    weekStart: row.week_start,
    hours: row.hours,
    minutes: row.minutes,
    courseIds: Array.isArray(row.course_ids) ? row.course_ids : [],
    summary: row.summary,
    difficulties: row.difficulties,
    nextGoals: row.next_goals,
    proofs: Array.isArray(row.proofs) ? row.proofs : [],
    submittedAt: row.submitted_at || undefined,
    reviewedAt: row.reviewed_at || undefined,
  };
}

function progressToRow(progress: Progress): Record<string, unknown> {
  return {
    student_id: progress.studentId,
    course_id: progress.courseId,
    status: progress.status,
    hours: progress.hours,
    minutes: progress.minutes,
    report: progress.report,
    proofs: progress.proofs,
    submitted_at: progress.submittedAt || null,
    timer_seconds: progress.timerSeconds,
    timer_started_at: progress.timerStartedAt || null,
    resource_opened_at: progress.resourceOpenedAt || null,
    reviewed_at: progress.reviewedAt || null,
  };
}

function weeklyToRow(report: WeeklyReport): Record<string, unknown> {
  return {
    id: report.id,
    student_id: report.studentId,
    week_start: report.weekStart,
    hours: report.hours,
    minutes: report.minutes,
    course_ids: report.courseIds,
    summary: report.summary,
    difficulties: report.difficulties,
    next_goals: report.nextGoals,
    proofs: report.proofs,
    submitted_at: report.submittedAt || null,
    reviewed_at: report.reviewedAt || null,
  };
}

/* ------------------------------ Authentification -------------------------- */

const ADMIN_EMAIL = "admin@jzkalyphor.app";

export async function loginRemote(
  mode: LoginMode,
  name: string,
  secret: string,
): Promise<{ session: Session; error: null } | { session: null; error: string }> {
  if (mode === "admin") {
    const { error } = await db.auth.signInWithPassword({
      email: ADMIN_EMAIL,
      password: secret,
    });
    if (error) {
      return {
        session: null,
        error: "Identifiant ou mot de passe formateur incorrect.",
      };
    }
    return { session: { role: "admin" }, error: null };
  }
  // Étudiant : nom + immatriculation (aucun mot de passe saisi)
  const registration = normalizeRegistration(secret);
  const password = await studentLoginPassword(registration);
  const { error } = await db.auth.signInWithPassword({
    email: studentLoginEmail(registration),
    password,
  });
  if (error) {
    if (/banned/i.test(error.message)) {
      return {
        session: null,
        error: "Ce compte est suspendu. Contactez votre formateur.",
      };
    }
    return { session: null, error: "Nom ou immatriculation incorrect." };
  }
  const student = await fetchStudentByAuthUid();
  if (!student) {
    await db.auth.signOut();
    return { session: null, error: "Nom ou immatriculation incorrect." };
  }
  if (!student.active) {
    await db.auth.signOut();
    return {
      session: null,
      error: "Ce compte est suspendu. Contactez votre formateur.",
    };
  }
  if (normalizeName(student.name) !== normalizeName(name)) {
    await db.auth.signOut();
    return {
      session: null,
      error:
        "Nom ou immatriculation incorrect. Vérifiez les informations reçues par WhatsApp.",
    };
  }
  return { session: { role: "student", studentId: student.id }, error: null };
}

export async function logoutRemote() {
  await db.auth.signOut();
}

export async function getRemoteRole(): Promise<"admin" | "student" | null> {
  try {
    const { data, error } = await db.rpc("get_my_role");
    if (error || !data) return null;
    return data === "admin" ? "admin" : "student";
  } catch {
    return null;
  }
}

export async function fetchStudentByAuthUid(): Promise<Student | null> {
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return null;
  const { data, error } = await db
    .from("students")
    .select("*")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (error || !data) return null;
  return rowToStudent(data as StudentRow);
}

/** Résout la session courante (au rechargement de la page). */
export async function resolveRemoteSession(): Promise<Session | null> {
  const {
    data: { session },
  } = await db.auth.getSession();
  if (!session) return null;
  const role = await getRemoteRole();
  if (role === "admin") return { role: "admin" };
  if (role === "student") {
    const student = await fetchStudentByAuthUid();
    if (!student || !student.active) {
      await db.auth.signOut();
      return null;
    }
    return { role: "student", studentId: student.id };
  }
  return null;
}

export function onAuthChange(callback: (event: string) => void) {
  const { data } = db.auth.onAuthStateChange((event) => callback(event));
  return () => data.subscription.unsubscribe();
}

/* ------------------------------ Chargement ------------------------------- */

export async function fetchAllRemote(): Promise<AppData> {
  const [students, courses, progress, weekly, settings] = await Promise.all([
    db.from("students").select("*").order("created_at", { ascending: true }),
    db.from("courses").select("*").order("created_at", { ascending: true }),
    db.from("progress").select("*"),
    db.from("weekly_reports").select("*").order("week_start", { ascending: true }),
    db.from("settings").select("*").eq("id", 1).maybeSingle(),
  ]);
  for (const result of [students, courses, progress, weekly]) {
    if (result.error) handleError(result.error, "Chargement impossible.");
  }
  if (settings.error) handleError(settings.error, "Chargement impossible.");
  return {
    students: (students.data || []).map((row) => rowToStudent(row as StudentRow)),
    courses: (courses.data || []).map((row) => rowToCourse(row as CourseRow)),
    progress: (progress.data || []).map((row) => rowToProgress(row as ProgressRow)),
    weeklyReports: (weekly.data || []).map((row) => rowToWeekly(row as WeeklyRow)),
    settings: {
      portalUrl: (settings.data as { portal_url?: string } | null)?.portal_url || "",
    },
  };
}

/** Abonnement temps réel sur les 4 tables métier. */
export function subscribeRemote(onChange: () => void): () => void {
  const channel = db
    .channel("jzkalyphor-sync")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "students" },
      onChange,
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "courses" },
      onChange,
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "progress" },
      onChange,
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "weekly_reports" },
      onChange,
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "settings" },
      onChange,
    )
    .subscribe();
  return () => {
    void db.removeChannel(channel);
  };
}

/* ------------------------------- Étudiants ------------------------------- */

export async function createStudentRemote(values: {
  name: string;
  whatsapp: string;
  cohort: string;
}): Promise<Student> {
  const { data, error } = await db.rpc("create_student", {
    p_name: values.name,
    p_whatsapp: values.whatsapp,
    p_cohort: values.cohort,
  });
  handleError(error, "Création de l'étudiant impossible.");
  return rowToStudent(data as StudentRow);
}

export async function setStudentActiveRemote(
  studentId: string,
  active: boolean,
): Promise<Student> {
  const { data, error } = await db.rpc("set_student_active", {
    p_student_id: studentId,
    p_active: active,
  });
  handleError(error, "Mise à jour impossible.");
  return rowToStudent(data as StudentRow);
}

export async function deleteStudentRemote(studentId: string) {
  const { error } = await db.rpc("delete_student", { p_student_id: studentId });
  handleError(error, "Suppression impossible.");
}

export async function markAccessSentRemote(studentId: string): Promise<Student> {
  const { data, error } = await db
    .from("students")
    .update({ access_sent_at: new Date().toISOString() })
    .eq("id", studentId)
    .select()
    .single();
  handleError(error, "Mise à jour impossible.");
  return rowToStudent(data as StudentRow);
}

/* --------------------------------- Cours --------------------------------- */

export async function insertCourseRemote(course: Course): Promise<Course> {
  const { data, error } = await db
    .from("courses")
    .insert({
      id: course.id,
      title: course.title,
      description: course.description,
      type: course.type,
      url: course.url,
      target: course.target,
      created_at: course.createdAt,
      external_credentials: course.externalCredentials || {},
    })
    .select()
    .single();
  handleError(error, "Publication impossible.");
  return rowToCourse(data as CourseRow);
}

export async function updateCourseRemote(course: Course): Promise<Course> {
  const { data, error } = await db
    .from("courses")
    .update({
      title: course.title,
      description: course.description,
      type: course.type,
      url: course.url,
      target: course.target,
      external_credentials: course.externalCredentials || {},
    })
    .eq("id", course.id)
    .select()
    .single();
  handleError(error, "Mise à jour impossible.");
  return rowToCourse(data as CourseRow);
}

export async function deleteCourseRemote(courseId: string) {
  const { error } = await db.from("courses").delete().eq("id", courseId);
  handleError(error, "Suppression impossible.");
}

/* ------------------- Progression et bilans hebdomadaires ------------------ */

export async function upsertProgressRemote(progress: Progress): Promise<Progress> {
  const { data, error } = await db
    .from("progress")
    .upsert(progressToRow(progress), { onConflict: "student_id,course_id" })
    .select()
    .single();
  handleError(error, "Enregistrement impossible.");
  return rowToProgress(data as ProgressRow);
}

export async function upsertWeeklyRemote(report: WeeklyReport): Promise<WeeklyReport> {
  const { data, error } = await db
    .from("weekly_reports")
    .upsert(weeklyToRow(report), { onConflict: "id" })
    .select()
    .single();
  handleError(error, "Enregistrement impossible.");
  return rowToWeekly(data as WeeklyRow);
}

/* -------------------------------- Paramètres ----------------------------- */

export async function saveSettingsRemote(portalUrl: string) {
  const { error } = await db
    .from("settings")
    .upsert({ id: 1, portal_url: portalUrl }, { onConflict: "id" });
  handleError(error, "Enregistrement impossible.");
}

/* --------------------------- Stockage des preuves ------------------------ */

const PROOFS_BUCKET = "proofs";

function sanitizeFileName(name: string) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .slice(-80);
}

/** Envoie un fichier dans le bucket privé et retourne la preuve (chemin). */
export async function uploadProofRemote(
  file: File,
  studentId: string,
  scope: string,
): Promise<Proof> {
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) throw new ApiError("Session expirée. Reconnectez-vous.", "auth");
  const path = `${user.id}/${studentId}/${scope}/${sbId()}-${sanitizeFileName(file.name)}`;
  const { error } = await db.storage
    .from(PROOFS_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) {
    if (/payload|size|too large/i.test(error.message))
      throw new ApiError("Fichier trop volumineux (2 Mo maximum).", "size");
    if (/mime|type/i.test(error.message))
      throw new ApiError("Format non accepté (PNG, JPG, WEBP ou PDF).", "type");
    throw new ApiError("Envoi du fichier impossible. Réessayez.", "upload");
  }
  return { id: sbId(), name: file.name, type: file.type, size: file.size, path };
}

export async function deleteProofRemote(path: string) {
  await db.storage.from(PROOFS_BUCKET).remove([path]);
}

/** URL signée (1 h) pour prévisualiser ou télécharger une preuve distante. */
export async function proofUrlRemote(proof: Proof): Promise<string> {
  if (proof.dataUrl) return proof.dataUrl;
  if (!proof.path) return "";
  const { data, error } = await db.storage
    .from(PROOFS_BUCKET)
    .createSignedUrl(proof.path, 3600);
  if (error || !data?.signedUrl) {
    throw new ApiError("Impossible d'ouvrir la pièce jointe.", "storage");
  }
  return data.signedUrl;
}
