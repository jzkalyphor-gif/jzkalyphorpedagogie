// Types métier partagés (application + couche API Supabase).

export type ResourceType = "youtube" | "link" | "document";
export type ProgressStatus = "not_started" | "in_progress" | "submitted";
export type AdminView =
  "overview" | "students" | "courses" | "tracking" | "weekly";
export type StudentView = "courses" | "weekly" | "progress" | "course";

export type Student = {
  id: string;
  name: string;
  whatsapp: string;
  /** Immatriculation unique, ex. AD-2026-10 (initiales + année + mois d'adhésion). */
  registration: string;
  /** Cohorte d'adhésion au format AAAA-MM. */
  cohort: string;
  active: boolean;
  createdAt: string;
  /** Date du dernier envoi des accès par WhatsApp. */
  accessSentAt?: string;
};

export type PlatformSettings = {
  /** Lien de l'espace étudiant communiqué dans les messages WhatsApp. */
  portalUrl: string;
};

export type ExternalCredentials = {
  username: string;
  password: string;
};

export type Course = {
  id: string;
  title: string;
  description: string;
  type: ResourceType;
  url: string;
  target: "all" | string;
  createdAt: string;
  externalCredentials?: Record<string, ExternalCredentials>;
};

export type Proof = {
  id: string;
  name: string;
  type: string;
  size: number;
  /** Mode local : contenu embarqué en base64. */
  dataUrl?: string;
  /** Mode en ligne : chemin dans le bucket Supabase Storage. */
  path?: string;
};

export type Progress = {
  studentId: string;
  courseId: string;
  status: ProgressStatus;
  hours: number;
  minutes: number;
  report: string;
  proofs: Proof[];
  submittedAt?: string;
  timerSeconds: number;
  timerStartedAt?: number;
  /** L'étudiant a ouvert la ressource externe. */
  resourceOpenedAt?: string;
  /** Le formateur a inspecté le rapport. */
  reviewedAt?: string;
};

/** État de l'accompagnement autoguidé (visites, checklist), conservé localement. */
export type GuideState = {
  adminTourDone: boolean;
  studentTourDone: Record<string, boolean>;
  courseTourDone: Record<string, boolean>;
  checklistHidden: boolean;
};

export type TourStep = {
  target: string;
  title: string;
  text: string;
  /** Ouvre le menu latéral sur mobile avant d'afficher l'étape. */
  requiresNav?: boolean;
};

/**
 * Bilan hebdomadaire : un compte-rendu par étudiant et par semaine (lundi → dimanche),
 * à transmettre avant le dimanche 23:59.
 */
export type WeeklyReport = {
  id: string;
  studentId: string;
  /** Lundi de la semaine concernée, au format AAAA-MM-JJ (heure locale). */
  weekStart: string;
  hours: number;
  minutes: number;
  courseIds: string[];
  summary: string;
  difficulties: string;
  nextGoals: string;
  proofs: Proof[];
  submittedAt?: string;
  reviewedAt?: string;
};

export type WeeklyStatus = "pending" | "on_time" | "late" | "missing";

export type AppData = {
  students: Student[];
  courses: Course[];
  progress: Progress[];
  weeklyReports: WeeklyReport[];
  settings: PlatformSettings;
};
export type Session =
  { role: "admin" } | { role: "student"; studentId: string };
export type Assignment = {
  student: Student;
  course: Course;
  progress: Progress;
};
export type Toast = {
  id: string;
  message: string;
  kind: "success" | "error" | "info";
};
export type ModalState =
  | { type: "studentForm" }
  | { type: "courseForm" }
  | { type: "externalCredentials"; courseId: string }
  | { type: "inspect"; studentId: string; courseId: string }
  | { type: "inspectWeekly"; reportId: string }
  | { type: "deleteStudent"; id: string }
  | { type: "deleteCourse"; id: string }
  | { type: "reset" };

export type LoginMode = "student" | "admin";
