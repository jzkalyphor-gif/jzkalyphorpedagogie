import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, CSSProperties, FormEvent, ReactNode } from "react";
import type {
  AdminView,
  AppData,
  Assignment,
  Course,
  ExternalCredentials,
  GuideState,
  LoginMode,
  ModalState,
  PlatformSettings,
  Progress,
  ProgressStatus,
  Proof,
  ResourceType,
  Session,
  Student,
  StudentView,
  Toast,
  TourStep,
  WeeklyReport,
  WeeklyStatus,
} from "./types";
import { isSupabaseConfigured } from "./supabaseClient";
import {
  createStudentRemote,
  deleteCourseRemote,
  deleteProofRemote,
  deleteStudentRemote,
  fetchAllRemote,
  insertCourseRemote,
  loginRemote,
  logoutRemote,
  markAccessSentRemote,
  onAuthChange,
  proofUrlRemote,
  resolveRemoteSession,
  saveSettingsRemote,
  setStudentActiveRemote,
  subscribeRemote,
  updateCourseRemote,
  upsertProgressRemote,
  upsertWeeklyRemote,
  uploadProofRemote,
} from "./api";

/** Mode connecté (Supabase) ou mode local (démonstration hors ligne). */
const REMOTE = isSupabaseConfigured();

const DATA_KEY = "jz-kalyphor-platform-v2";
const SESSION_KEY = "jz-kalyphor-session-v2";
const GUIDE_KEY = "jz-kalyphor-guide-v1";

const DEFAULT_GUIDE: GuideState = {
  adminTourDone: false,
  studentTourDone: {},
  courseTourDone: {},
  checklistHidden: false,
};

const ADMIN_TOUR: TourStep[] = [
  {
    target: "kpis",
    title: "Vos indicateurs en temps réel",
    text: "Étudiants inscrits, cours actifs, temps d'apprentissage cumulé et rapports rendus : l'essentiel de votre activité, mis à jour instantanément.",
  },
  {
    target: "checklist",
    title: "Votre parcours de démarrage",
    text: "Cette checklist vous guide pas à pas : inscrire, envoyer les accès, publier, inspecter. Chaque étape se coche automatiquement.",
  },
  {
    target: "nav-students",
    title: "Inscrire et accompagner vos étudiants",
    text: "Ajoutez un étudiant : son immatriculation est générée automatiquement. Envoyez-lui ses accès par WhatsApp en un clic, organisés par cohorte.",
    requiresNav: true,
  },
  {
    target: "nav-courses",
    title: "Publier vos cours",
    text: "Vidéo YouTube, plateforme externe ou document : ciblez tous les étudiants, une cohorte ou une personne, et joignez si besoin ses accès externes.",
    requiresNav: true,
  },
  {
    target: "nav-tracking",
    title: "Suivre et inspecter",
    text: "Temps déclaré, statut de chaque cours, comptes-rendus et preuves de visionnage : tout est consultable ici, avec relance WhatsApp intégrée.",
    requiresNav: true,
  },
  {
    target: "nav-weekly",
    title: "Bilans hebdomadaires",
    text: "Chaque étudiant rend son bilan avant le dimanche 23:59. Visualisez semaine par semaine qui est à temps, en retard ou non rendu, et relancez en un clic.",
    requiresNav: true,
  },
  {
    target: "help",
    title: "Une aide toujours disponible",
    text: "Ce bouton ouvre le guide d'utilisation et permet de relancer cette visite à tout moment.",
  },
];

const STUDENT_TOUR: TourStep[] = [
  {
    target: "student-identity",
    title: "Votre identité JZ KALYPHOR",
    text: "Votre cohorte et votre immatriculation. Cette dernière est votre clé de connexion : conservez-la précieusement.",
  },
  {
    target: "student-next",
    title: "Votre prochaine étape",
    text: "Nous vous indiquons toujours quoi faire ensuite. Un clic suffit pour reprendre là où vous en étiez.",
  },
  {
    target: "student-weekly",
    title: "Votre bilan hebdomadaire",
    text: "Chaque semaine, rendez votre bilan avant le dimanche 23:59 : temps d'étude, cours travaillés, acquis et objectifs. Le compte à rebours vous indique le temps restant.",
  },
  {
    target: "student-courses",
    title: "Vos cours",
    text: "Chaque cours affiche son statut : Non commencé, En cours ou Terminé. Ouvrez-le pour apprendre, puis transmettre votre rapport.",
  },
  {
    target: "help",
    title: "Besoin d'aide ?",
    text: "Le guide d'utilisation répond aux questions fréquentes et vous permet de relancer cette visite.",
  },
];

const COURSE_TOUR: TourStep[] = [
  {
    target: "course-resource",
    title: "1 · Consultez la ressource",
    text: "Regardez la vidéo ici même ou ouvrez la plateforme externe. Si des accès vous ont été attribués, ils apparaissent juste en dessous, prêts à copier.",
  },
  {
    target: "course-steps",
    title: "Votre progression guidée",
    text: "Quatre étapes à valider. Elles se cochent automatiquement au fur et à mesure.",
  },
  {
    target: "course-timer",
    title: "2 · Déclarez votre temps",
    text: "Lancez le chronomètre pendant votre séance, ou saisissez directement les heures et minutes consacrées.",
  },
  {
    target: "course-report",
    title: "3 · Rédigez votre compte-rendu",
    text: "Quelques lignes sur ce que vous avez appris et ce que vous allez mettre en pratique.",
  },
  {
    target: "course-proofs",
    title: "4 · Joignez vos preuves",
    text: "Captures d'écran ou PDF attestant de votre visionnage. Vous pouvez les prévisualiser avant envoi.",
  },
  {
    target: "course-submit",
    title: "Transmettez à votre formateur",
    text: "Une fois les étapes validées, envoyez officiellement votre rapport. Vous pourrez le mettre à jour ensuite.",
  },
];
/** Adresse officielle de l'espace étudiant, communiquée dans les messages WhatsApp. */
const DEFAULT_PORTAL_URL = "https://jzkalyphorpedagogie.netlify.app";
/** Ancienne adresse par défaut, jamais mise en ligne : remplacée par DEFAULT_PORTAL_URL. */
const LEGACY_PORTAL_URL = "https://jzkalyphor.app";
const ADMIN_NAME = "Yves Jonathan";
const ADMIN_PASSWORD = "Admin2026@JZ";

const glyphs = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  users: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  courses: (
    <>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
      <path d="M8 7h8M8 11h6" />
    </>
  ),
  tracking: (
    <>
      <path d="M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8l-5-5h-3" />
      <path d="M16 3v5h5M8 13h8M8 17h5" />
      <path d="M8 3h5" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  arrowRight: (
    <>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </>
  ),
  arrowLeft: (
    <>
      <path d="M19 12H5M11 18l-6-6 6-6" />
    </>
  ),
  external: (
    <>
      <path d="M13 5h6v6M19 5l-9 9" />
      <path d="M19 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
  checkCircle: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12 2.5 2.5L16 9" />
    </>
  ),
  cloud: (
    <>
      <path d="M7 18a4.5 4.5 0 0 1-.4-8.98A6 6 0 0 1 18.3 10.2 3.8 3.8 0 0 1 17.5 18Z" />
      <path d="M12 12v6M9.5 15.5 12 18l2.5-2.5" />
    </>
  ),
  cloudOff: (
    <>
      <path d="M7 18a4.5 4.5 0 0 1-.4-8.98A6 6 0 0 1 15 7.7" />
      <path d="M17.5 18H7" />
      <path d="m4 4 16 16" />
    </>
  ),
  play: <path d="m8 5 11 7-11 7V5Z" />,
  pause: (
    <>
      <path d="M8 5v14M16 5v14" />
    </>
  ),
  file: (
    <>
      <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" />
      <path d="M13 2v7h7M8 14h8M8 18h6" />
    </>
  ),
  link: (
    <>
      <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
      <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
    </>
  ),
  video: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="m10 9 5 3-5 3V9Z" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16V3m0 0L7 8m5-5 5 5" />
      <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </>
  ),
  close: <path d="M5 5l14 14M19 5 5 19" />,
  logout: (
    <>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5M21 12H9" />
    </>
  ),
  shield: (
    <>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  reset: (
    <>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  eye: (
    <>
      <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" />
      <circle cx="12" cy="12" r="2.5" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M4 4l16 16M9.9 6.2A11 11 0 0 1 12 6c6.5 0 10 6 10 6a15 15 0 0 1-3.1 3.6M6.1 8.4C3.4 10.1 2 12 2 12s3.5 6 10 6c1.4 0 2.7-.3 3.8-.7" />
      <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
    </>
  ),
  download: (
    <>
      <path d="M12 3v12m0 0 5-5m-5 5-5-5M4 17v3h16v-3" />
    </>
  ),
  copy: (
    <>
      <rect x="8" y="8" width="13" height="13" rx="2" />
      <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
    </>
  ),
  trash: (
    <>
      <path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15M10 10v7M14 10v7" />
    </>
  ),
  phone: (
    <>
      <path d="M21 11.5a8.5 8.5 0 0 1-12.5 7.4L3 21l2.1-5.5A8.5 8.5 0 1 1 21 11.5Z" />
      <path d="M9 8c.5 2.5 2.5 4.5 5 5l1.3-1.2 2 1-.4 2c-.5.7-1.5.9-2.3.8-4.1-.7-7.3-3.9-8-8-.1-.8.1-1.8.8-2.3l2-.4 1 2L9 8Z" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10" width="14" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
  chevron: <path d="m9 18 6-6-6-6" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m16 16 5 5" />
    </>
  ),
  sparkle: (
    <>
      <path d="m12 2 1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8L12 2ZM19 17l.7 2.3L22 20l-2.3.7L19 23l-.7-2.3L16 20l2.3-.7L19 17Z" />
    </>
  ),
  alert: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v6M12 17h.01" />
    </>
  ),
  send: (
    <>
      <path d="m22 2-7 20-4-9-9-4L22 2Z" />
      <path d="M22 2 11 13" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M7 3v4M17 3v4M3 10h18" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1" />
    </>
  ),
};

type IconName = keyof typeof glyphs;

function Icon({
  name,
  size = 20,
  className = "",
  strokeWidth = 1.8,
}: {
  name: IconName;
  size?: number;
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {glyphs[name]}
    </svg>
  );
}

function BrandMark({ size = 47 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 56 56"
      fill="none"
      aria-hidden="true"
      className="brand-mark"
    >
      <defs>
        <linearGradient
          id="jzGold"
          x1="3"
          y1="5"
          x2="51"
          y2="51"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#F3D89F" />
          <stop offset=".48" stopColor="#C49B4B" />
          <stop offset="1" stopColor="#E6C280" />
        </linearGradient>
        <linearGradient
          id="jzBlue"
          x1="10"
          y1="3"
          x2="52"
          y2="55"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#28517A" />
          <stop offset="1" stopColor="#07213E" />
        </linearGradient>
      </defs>
      <path
        d="M13 5h29l9 9v28l-9 9H13V5Z"
        fill="url(#jzBlue)"
        stroke="url(#jzGold)"
        strokeWidth="1.4"
      />
      <path
        d="M5 8v40"
        stroke="url(#jzGold)"
        strokeWidth="5"
        strokeLinecap="square"
      />
      <path
        d="M18 15h19v5H27v12c0 6.4-3.3 10.2-10 10v-5.2c3.5.1 4.5-1.6 4.5-4.8V20H18v-5Z"
        fill="url(#jzGold)"
      />
      <path d="M33 25h11v4.3L36 39h8v5H28v-4.3l8-9.7h-6V25h3Z" fill="#F8F5EE" />
    </svg>
  );
}

function Brand({
  light = false,
  large = false,
}: {
  light?: boolean;
  large?: boolean;
}) {
  return (
    <div
      className={`brand ${light ? "brand-light" : ""} ${large ? "brand-large" : ""}`}
    >
      <BrandMark size={large ? 57 : 45} />
      <div className="brand-copy">
        <div className="brand-name">
          <span>JZ</span> KALYPHOR
        </div>
        <div className="brand-motto">
          Prenez le contrôle de votre avenir professionnel.
        </div>
      </div>
    </div>
  );
}

function makeId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function emptyProgress(studentId: string, courseId: string): Progress {
  return {
    studentId,
    courseId,
    status: "not_started",
    hours: 0,
    minutes: 0,
    report: "",
    proofs: [],
    timerSeconds: 0,
  };
}

function getProgress(
  data: AppData,
  studentId: string,
  courseId: string,
): Progress {
  return (
    data.progress.find(
      (item) => item.studentId === studentId && item.courseId === courseId,
    ) || emptyProgress(studentId, courseId)
  );
}

function seedData(): AppData {
  const dateAgo = (days: number) =>
    new Date(Date.now() - days * 86400000).toISOString();
  const sampleSvg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="560" viewBox="0 0 900 560"><rect width="900" height="560" fill="#0C3460"/><rect x="35" y="35" width="830" height="490" rx="10" fill="#133F6D" stroke="#C49B4B" stroke-width="2"/><text x="75" y="104" fill="#E6C280" font-family="Arial" font-size="24" font-weight="bold">JZ KALYPHOR / PARCOURS DIGITAL</text><rect x="75" y="145" width="750" height="300" rx="8" fill="#092743"/><circle cx="450" cy="295" r="46" fill="#C49B4B"/><path d="M438 271L475 295 438 319Z" fill="white"/><text x="75" y="486" fill="white" font-family="Arial" font-size="22">Les fondamentaux du marketing digital</text></svg>';
  const sampleProof: Proof = {
    id: "proof-demo",
    name: "capture-visionnage.svg",
    type: "image/svg+xml",
    size: sampleSvg.length,
    dataUrl: `data:image/svg+xml;base64,${btoa(sampleSvg)}`,
  };
  const contentSvg = sampleSvg.replace(
    "Les fondamentaux du marketing digital",
    "Construire une strategie de contenu",
  );
  const contentProof: Proof = {
    id: "proof-contenu-demo",
    name: "capture-strategie.svg",
    type: "image/svg+xml",
    size: contentSvg.length,
    dataUrl: `data:image/svg+xml;base64,${btoa(contentSvg)}`,
  };

  return {
    students: [
      {
        id: "amina",
        name: "Amina Diallo",
        whatsapp: "+2250708091011",
        registration: "AD-2026-09",
        cohort: "2026-09",
        active: true,
        createdAt: dateAgo(18),
      },
      {
        id: "marc",
        name: "Kouassi Marc",
        whatsapp: "+2250506070809",
        registration: "KM-2026-10",
        cohort: "2026-10",
        active: true,
        createdAt: dateAgo(12),
      },
    ],
    settings: { portalUrl: DEFAULT_PORTAL_URL },
    weeklyReports: seedWeeklyReports(dateAgo),
    courses: [
      {
        id: "marketing",
        title: "Les fondamentaux du marketing digital",
        description:
          "Découvrez les principes essentiels du marketing numérique. Prenez des notes sur les canaux, les audiences et les leviers de croissance, puis partagez votre synthèse.",
        type: "youtube",
        url: "https://www.youtube.com/watch?v=iU2yx3L-cXI",
        target: "all",
        createdAt: dateAgo(10),
      },
      {
        id: "contenu",
        title: "Construire une stratégie de contenu",
        description:
          "Lisez cette ressource et identifiez trois actions concrètes pour créer une communication digitale cohérente et utile à votre projet.",
        type: "link",
        url: "https://www.francenum.gouv.fr/guides-et-conseils/communication-et-publicite/strategie-de-communication/communication-en-ligne",
        target: "all",
        createdAt: dateAgo(7),
      },
      {
        id: "guide",
        title: "Guide pratique : réussir sa transition numérique",
        description:
          "Consultez le guide PDF et préparez un plan d'action personnel en vous appuyant sur les étapes proposées dans le document.",
        type: "document",
        url: "https://www.francenum.gouv.fr/files/Documents/En_avant_vers_le_numerique_juin_2019.pdf",
        target: "all",
        createdAt: dateAgo(4),
      },
    ],
    progress: [
      {
        studentId: "amina",
        courseId: "marketing",
        status: "submitted",
        hours: 2,
        minutes: 20,
        report:
          "J'ai étudié les bases du marketing digital et compris l'importance de définir une audience précise avant de choisir ses canaux. Je retiens surtout la complémentarité entre contenu, référencement et analyse des résultats. Pour mon projet, je commencerai par clarifier mon client idéal et établir un calendrier de publication hebdomadaire.",
        proofs: [sampleProof],
        submittedAt: dateAgo(2),
        timerSeconds: 0,
      },
      {
        studentId: "amina",
        courseId: "contenu",
        status: "in_progress",
        hours: 1,
        minutes: 10,
        report: "",
        proofs: [],
        timerSeconds: 0,
      },
      {
        studentId: "marc",
        courseId: "marketing",
        status: "in_progress",
        hours: 0,
        minutes: 45,
        report: "",
        proofs: [],
        timerSeconds: 0,
      },
      {
        studentId: "marc",
        courseId: "contenu",
        status: "submitted",
        hours: 1,
        minutes: 30,
        report:
          "La lecture m'a aidé à distinguer les objectifs de visibilité et de conversion. J'ai préparé trois pistes pour mon activité : publier des conseils pratiques, raconter des retours d'expérience et suivre les résultats chaque mois. Je vais tester ces formats avant d'ajuster ma stratégie.",
        proofs: [contentProof],
        submittedAt: dateAgo(1),
        timerSeconds: 0,
      },
    ],
  };
}

/** Historique initial : Amina rend à temps, Marc a rendu en retard la semaine passée. */
function seedWeeklyReports(dateAgo: (days: number) => string): WeeklyReport[] {
  const now = Date.now();
  const lastWeek = weekKeyOf(new Date(now - 7 * 86400000));
  const twoWeeksAgo = addWeeks(lastWeek, -1);
  const enrolledBy = (createdAt: string, week: string) =>
    new Date(createdAt).getTime() <= weekDeadline(week).getTime();
  const onTime = (week: string) =>
    new Date(weekDeadline(week).getTime() - 26 * 3600000).toISOString();
  const reports: WeeklyReport[] = [];
  const amina = dateAgo(18);
  const marc = dateAgo(12);
  if (enrolledBy(amina, twoWeeksAgo))
    reports.push({
      ...emptyWeeklyReport("amina", twoWeeksAgo),
      hours: 3,
      minutes: 30,
      courseIds: ["marketing"],
      summary:
        "Première semaine consacrée aux fondamentaux du marketing digital : canaux, audiences et objectifs. J'ai pris des notes structurées et identifié mon client idéal.",
      difficulties:
        "Distinguer clairement les objectifs de visibilité et de conversion.",
      nextGoals:
        "Terminer le module marketing et préparer mon compte-rendu de cours.",
      submittedAt: onTime(twoWeeksAgo),
      reviewedAt: onTime(twoWeeksAgo),
    });
  reports.push({
    ...emptyWeeklyReport("amina", lastWeek),
    hours: 4,
    minutes: 15,
    courseIds: ["marketing", "contenu"],
    summary:
      "J'ai finalisé le cours sur le marketing digital et transmis mon rapport. J'ai commencé la ressource sur la stratégie de contenu et défini trois formats à tester.",
    difficulties: "Trouver le temps de publier régulièrement.",
    nextGoals:
      "Finaliser la stratégie de contenu et démarrer le guide pratique.",
    submittedAt: onTime(lastWeek),
    reviewedAt: onTime(lastWeek),
  });
  if (enrolledBy(marc, lastWeek)) {
    const lateAt = Math.min(
      weekDeadline(lastWeek).getTime() + 10 * 3600000,
      now - 60000,
    );
    reports.push({
      ...emptyWeeklyReport("marc", lastWeek),
      hours: 2,
      minutes: 15,
      courseIds: ["contenu"],
      summary:
        "Lecture de la ressource sur la stratégie de contenu et préparation de trois pistes pour mon activité. Rapport de cours transmis.",
      difficulties: "Organisation de mon temps d'étude en semaine.",
      nextGoals:
        "Reprendre le module marketing digital et le terminer avant dimanche.",
      submittedAt: new Date(lateAt).toISOString(),
    });
  }
  return reports;
}

function isValidData(value: unknown): value is AppData {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AppData>;
  return (
    Array.isArray(candidate.students) &&
    Array.isArray(candidate.courses) &&
    Array.isArray(candidate.progress) &&
    candidate.students.every(
      (student) =>
        typeof student?.registration === "string" &&
        typeof student?.cohort === "string",
    )
  );
}

function loadData(): AppData {
  try {
    const saved = localStorage.getItem(DATA_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (isValidData(parsed))
        return {
          ...parsed,
          weeklyReports: Array.isArray(parsed.weeklyReports)
            ? parsed.weeklyReports
            : [],
          settings: {
            portalUrl:
              parsed.settings?.portalUrl &&
              parsed.settings.portalUrl !== LEGACY_PORTAL_URL
                ? parsed.settings.portalUrl
                : DEFAULT_PORTAL_URL,
          },
        };
    }
  } catch {
    /* Invalid or unavailable storage falls back to the initial data. */
  }
  return seedData();
}

/* ---------- Calendrier hebdomadaire ---------- */

function toDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parseDateKey(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/** Lundi 00:00 (heure locale) de la semaine contenant la date. */
function startOfWeek(date: Date) {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const offset = (monday.getDay() + 6) % 7;
  monday.setDate(monday.getDate() - offset);
  return monday;
}

function weekKeyOf(date: Date) {
  return toDateKey(startOfWeek(date));
}

/** Échéance du bilan : dimanche 23:59:59 de la semaine. */
function weekDeadline(weekKey: string) {
  const deadline = parseDateKey(weekKey);
  deadline.setDate(deadline.getDate() + 6);
  deadline.setHours(23, 59, 59, 999);
  return deadline;
}

function addWeeks(weekKey: string, count: number) {
  const date = parseDateKey(weekKey);
  date.setDate(date.getDate() + count * 7);
  return toDateKey(date);
}

/** Numéro de semaine ISO 8601. */
function isoWeekNumber(weekKey: string) {
  const thursday = parseDateKey(weekKey);
  thursday.setDate(thursday.getDate() + 3);
  const firstThursday = new Date(thursday.getFullYear(), 0, 4);
  const firstWeekStart = startOfWeek(firstThursday);
  return (
    1 +
    Math.round(
      (thursday.getTime() - firstWeekStart.getTime() - 3 * 86400000) /
        (7 * 86400000),
    )
  );
}

function weekLabel(weekKey: string, withYear = true) {
  const start = parseDateKey(weekKey);
  const end = parseDateKey(weekKey);
  end.setDate(end.getDate() + 6);
  const sameMonth = start.getMonth() === end.getMonth();
  const startText = new Intl.DateTimeFormat(
    "fr-FR",
    sameMonth ? { day: "numeric" } : { day: "numeric", month: "short" },
  ).format(start);
  const endText = new Intl.DateTimeFormat(
    "fr-FR",
    withYear
      ? { day: "numeric", month: "long", year: "numeric" }
      : { day: "numeric", month: "long" },
  ).format(end);
  return `Semaine du ${startText} au ${endText}`;
}

function formatDeadline(weekKey: string) {
  return `dimanche ${new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long" }).format(weekDeadline(weekKey))} à 23:59`;
}

/** Temps restant avant échéance, ex. « 2 j 05 h » ou « 3 h 12 min ». */
function formatRemaining(milliseconds: number) {
  if (milliseconds <= 0) return "échéance dépassée";
  const totalMinutes = Math.floor(milliseconds / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days} j ${String(hours).padStart(2, "0")} h`;
  if (hours > 0) return `${hours} h ${String(minutes).padStart(2, "0")} min`;
  return `${Math.max(1, minutes)} min`;
}

function weeklyStatus(
  report: WeeklyReport | undefined,
  weekKey: string,
  now: number,
): WeeklyStatus {
  const deadline = weekDeadline(weekKey).getTime();
  if (report?.submittedAt)
    return new Date(report.submittedAt).getTime() <= deadline
      ? "on_time"
      : "late";
  return now <= deadline ? "pending" : "missing";
}

/** Semaines concernées par un étudiant : de son inscription à la semaine en cours (récentes d'abord). */
function studentWeeks(student: Student, now: number) {
  const first = weekKeyOf(new Date(student.createdAt));
  const current = weekKeyOf(new Date(now));
  const weeks: string[] = [];
  for (
    let key = current;
    key >= first && weeks.length < 104;
    key = addWeeks(key, -1)
  )
    weeks.push(key);
  return weeks;
}

function emptyWeeklyReport(studentId: string, weekStart: string): WeeklyReport {
  return {
    id: `${studentId}-${weekStart}`,
    studentId,
    weekStart,
    hours: 0,
    minutes: 0,
    courseIds: [],
    summary: "",
    difficulties: "",
    nextGoals: "",
    proofs: [],
  };
}

function findWeeklyReport(data: AppData, studentId: string, weekStart: string) {
  return data.weeklyReports.find(
    (report) =>
      report.studentId === studentId && report.weekStart === weekStart,
  );
}

/** Horloge partagée, rafraîchie régulièrement pour les comptes à rebours. */
function useNow(intervalMs = 30000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/* ---------- Immatriculation & cohortes ---------- */

/** Cohorte du mois courant au format AAAA-MM. */
function currentCohort() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function isValidCohort(value: string) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function cohortLabel(cohort: string) {
  return `Cohorte ${cohort}`;
}

/** Initiales normalisées (sans accents), 2 à 3 lettres. */
function registrationInitials(name: string) {
  const parts = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .split(/[\s'-]+/)
    .filter((part) => /^[A-Z]/.test(part));
  let initials = parts
    .slice(0, 3)
    .map((part) => part[0])
    .join("");
  if (initials.length < 2 && parts[0])
    initials = parts[0].replace(/[^A-Z]/g, "").slice(0, 2);
  return initials || "JZ";
}

/**
 * Génère une immatriculation unique : INITIALES-AAAA-MM.
 * En cas d'homonymie dans la même cohorte, un indice est ajouté (…-2, …-3).
 */
function buildRegistration(
  name: string,
  cohort: string,
  students: Student[],
  excludeId?: string,
) {
  const base = `${registrationInitials(name)}-${cohort}`;
  const taken = new Set(
    students
      .filter((student) => student.id !== excludeId)
      .map((student) => student.registration.toUpperCase()),
  );
  if (!taken.has(base)) return base;
  let index = 2;
  while (taken.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

function normalizeRegistration(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

/** Cible d'un cours : tous, une cohorte (cohort:AAAA-MM) ou un étudiant précis. */
function studentMatchesTarget(student: Student, target: string) {
  return (
    target === "all" ||
    target === `cohort:${student.cohort}` ||
    target === student.id
  );
}

function describeTarget(target: string, students: Student[]) {
  if (target === "all") return "Tous les étudiants";
  if (target.startsWith("cohort:")) return cohortLabel(target.slice(7));
  return (
    students.find((student) => student.id === target)?.name ||
    "Étudiant supprimé"
  );
}

function listCohorts(students: Student[]) {
  return [...new Set(students.map((student) => student.cohort))].sort((a, b) =>
    b.localeCompare(a),
  );
}

/** Lien de l'espace étudiant : paramétré par le formateur, sinon l'adresse officielle. */
function resolvePortalUrl(settings: PlatformSettings) {
  const url = settings.portalUrl.trim().replace(/\/+$/, "");
  return url && url !== LEGACY_PORTAL_URL ? url : DEFAULT_PORTAL_URL;
}

/** URL d'affichage d'une preuve : dataURL en mode local, URL signée en mode connecté. */
function useProofUrl(proof: Proof | null | undefined): string {
  const [url, setUrl] = useState(proof?.dataUrl || "");
  useEffect(() => {
    let active = true;
    setUrl(proof?.dataUrl || "");
    if (proof?.path && REMOTE) {
      proofUrlRemote(proof)
        .then((signed) => {
          if (active) setUrl(signed);
        })
        .catch(() => {});
    }
    return () => {
      active = false;
    };
  }, [proof]);
  return url;
}

/** Vignette de preuve : image si possible, icône document sinon. */
function ProofThumb({
  proof,
  className,
  onClick,
  label,
}: {
  proof: Proof;
  className: string;
  onClick?: () => void;
  label: string;
}) {
  const url = useProofUrl(proof);
  const Tag = onClick ? "button" : "span";
  return (
    <Tag
      className={className}
      onClick={onClick}
      type={onClick ? "button" : undefined}
      aria-label={onClick ? label : undefined}
    >
      {proof.type.startsWith("image/") ? (
        url ? (
          <img src={url} alt={label} />
        ) : (
          <Icon name="file" size={20} />
        )
      ) : (
        <Icon name="file" size={20} />
      )}
    </Tag>
  );
}

/** Lien de téléchargement d'une preuve (dataURL ou URL signée). */
function ProofDownloadLink({
  proof,
  className,
  label,
  children,
}: {
  proof: Proof;
  className?: string;
  label: string;
  children: ReactNode;
}) {
  const url = useProofUrl(proof);
  return (
    <a
      className={className}
      href={url || "#"}
      download={proof.name}
      aria-label={label}
      onClick={(event) => {
        if (!url) event.preventDefault();
      }}
    >
      {children}
    </a>
  );
}

/**
 * Fusionne un rechargement distant dans l'état local : les lignes en cours
 * d'édition (non encore synchronisées) sont préservées telles quelles.
 */
function mergeRemoteData(current: AppData, fresh: AppData, dirty: {
  progress: Set<string>;
  weekly: Set<string>;
}): AppData {
  const progress = fresh.progress.map((row) => {
    const key = `${row.studentId}/${row.courseId}`;
    if (!dirty.progress.has(key)) return row;
    return (
      current.progress.find(
        (item) =>
          item.studentId === row.studentId && item.courseId === row.courseId,
      ) || row
    );
  });
  for (const row of current.progress) {
    const key = `${row.studentId}/${row.courseId}`;
    if (
      dirty.progress.has(key) &&
      !fresh.progress.some(
        (item) =>
          item.studentId === row.studentId && item.courseId === row.courseId,
      )
    )
      progress.push(row);
  }
  const weeklyReports = fresh.weeklyReports.map((row) => {
    const key = `${row.studentId}/${row.weekStart}`;
    if (!dirty.weekly.has(key)) return row;
    return (
      current.weeklyReports.find(
        (item) =>
          item.studentId === row.studentId && item.weekStart === row.weekStart,
      ) || row
    );
  });
  for (const row of current.weeklyReports) {
    const key = `${row.studentId}/${row.weekStart}`;
    if (
      dirty.weekly.has(key) &&
      !fresh.weeklyReports.some(
        (item) =>
          item.studentId === row.studentId && item.weekStart === row.weekStart,
      )
    )
      weeklyReports.push(row);
  }
  return { ...fresh, progress, weeklyReports };
}

function loadGuide(): GuideState {
  try {
    const saved = localStorage.getItem(GUIDE_KEY);
    if (saved) return { ...DEFAULT_GUIDE, ...JSON.parse(saved) };
  } catch {
    /* Guide state is optional; start fresh when unavailable. */
  }
  return DEFAULT_GUIDE;
}

function loadSession(): Session | null {
  try {
    const saved = localStorage.getItem(SESSION_KEY);
    if (!saved) return null;
    const parsed = JSON.parse(saved);
    if (
      parsed.role === "admin" ||
      (parsed.role === "student" && typeof parsed.studentId === "string")
    )
      return parsed;
  } catch {
    /* A stale session should never block the login screen. */
  }
  return null;
}

function formatDate(value: string, long = false) {
  return new Intl.DateTimeFormat(
    "fr-FR",
    long
      ? { day: "numeric", month: "long", year: "numeric" }
      : { day: "2-digit", month: "short", year: "numeric" },
  ).format(new Date(value));
}

function formatDuration(hours: number, minutes: number) {
  const total = Math.max(0, hours * 60 + minutes);
  return total
    ? `${Math.floor(total / 60)} h ${String(total % 60).padStart(2, "0")}`
    : "0 min";
}

function formatClock(seconds: number) {
  const safe = Math.max(0, seconds);
  return [Math.floor(safe / 3600), Math.floor((safe % 3600) / 60), safe % 60]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

function getYouTubeId(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase();
    if (host === "youtu.be" || host === "www.youtu.be")
      return /^[\w-]{11}$/.test(url.pathname.slice(1).split("/")[0])
        ? url.pathname.slice(1).split("/")[0]
        : null;
    if (
      host === "youtube.com" ||
      host === "www.youtube.com" ||
      host === "m.youtube.com" ||
      host === "youtube-nocookie.com" ||
      host === "www.youtube-nocookie.com"
    ) {
      const id =
        url.searchParams.get("v") ||
        url.pathname.match(/^\/(?:embed|shorts|live)\/([\w-]{11})/)?.[1];
      return id && /^[\w-]{11}$/.test(id) ? id : null;
    }
  } catch {
    return null;
  }
  return null;
}

function isWebUrl(rawUrl: string) {
  try {
    return ["http:", "https:"].includes(new URL(rawUrl).protocol);
  } catch {
    return false;
  }
}

function validateExternalCredentials(
  values: Record<string, ExternalCredentials>,
  recipients: Student[],
): { credentials: Record<string, ExternalCredentials>; error: string | null } {
  const credentials: Record<string, ExternalCredentials> = {};
  for (const student of recipients) {
    const username = values[student.id]?.username?.trim() || "";
    const password = values[student.id]?.password || "";
    if ((username && !password) || (!username && password)) {
      return {
        credentials: {},
        error: `Renseignez l'e-mail (ou le nom d'utilisateur) et le mot de passe de ${student.name}, ou laissez les deux champs vides.`,
      };
    }
    if (username && password) credentials[student.id] = { username, password };
  }
  if (
    Object.keys(credentials).length > 0 &&
    Object.keys(credentials).length < recipients.length
  ) {
    const missing = recipients.filter((student) => !credentials[student.id]);
    return {
      credentials: {},
      error: `Ajoutez aussi les accès de ${missing.map((student) => student.name).join(", ")}, ou ciblez uniquement les étudiants concernés.`,
    };
  }
  return { credentials, error: null };
}

async function copyToClipboard(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Local HTML files can block the Clipboard API; try the legacy selection path.
  }
  const field = document.createElement("textarea");
  field.value = value;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.appendChild(field);
  field.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    field.remove();
  }
}

function getInitials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("");
}

function Avatar({ name, small = false }: { name: string; small?: boolean }) {
  const shade = name.charCodeAt(0) % 3;
  return (
    <span
      className={`avatar avatar-${shade} ${small ? "avatar-small" : ""}`}
      aria-hidden="true"
    >
      {getInitials(name)}
    </span>
  );
}

function StatusBadge({
  status,
  studentLabel = false,
}: {
  status: ProgressStatus;
  studentLabel?: boolean;
}) {
  const label =
    status === "submitted"
      ? studentLabel
        ? "Terminé"
        : "Rapport & preuves transmis"
      : status === "in_progress"
        ? "En cours"
        : "Non commencé";
  return (
    <span className={`status-badge status-${status}`}>
      <span className="status-dot" />
      {label}
    </span>
  );
}

function ResourceIcon({
  type,
  size = 19,
}: {
  type: ResourceType;
  size?: number;
}) {
  return (
    <span className={`resource-icon resource-${type}`}>
      <Icon
        name={type === "youtube" ? "video" : type === "link" ? "link" : "file"}
        size={size}
      />
    </span>
  );
}

function ToastStack({
  toasts,
  dismiss,
}: {
  toasts: Toast[];
  dismiss: (id: string) => void;
}) {
  return (
    <div className="toast-stack" aria-live="polite" aria-atomic="false">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`toast toast-${toast.kind}`}
          role={toast.kind === "error" ? "alert" : "status"}
        >
          <span className="toast-symbol">
            <Icon
              name={
                toast.kind === "error"
                  ? "alert"
                  : toast.kind === "success"
                    ? "checkCircle"
                    : "sparkle"
              }
              size={19}
            />
          </span>
          <span>{toast.message}</span>
          <button
            className="icon-button toast-close"
            type="button"
            onClick={() => dismiss(toast.id)}
            aria-label="Fermer la notification"
          >
            <Icon name="close" size={15} />
          </button>
        </div>
      ))}
    </div>
  );
}

function LoginScreen({
  onLogin,
}: {
  onLogin: (
    mode: LoginMode,
    name: string,
    secret: string,
  ) => Promise<string | null>;
}) {
  const [mode, setMode] = useState<LoginMode>("student");
  const [name, setName] = useState("");
  const [secret, setSecret] = useState("");
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const result = await onLogin(mode, name, secret);
      setError(result || "");
    } catch {
      setError("Connexion impossible. Vérifiez votre connexion internet.");
    } finally {
      setPending(false);
    }
  }

  function switchMode(next: LoginMode) {
    setMode(next);
    setSecret("");
    setError("");
  }

  return (
    <div className="login-layout">
      <section className="login-story" aria-label="JZ KALYPHOR">
        <div className="login-story-inner">
          <Brand light large />
          <div className="login-story-center">
            <span className="overline overline-gold">
              <span className="gold-line" />
              L'EXCELLENCE EN MOUVEMENT
            </span>
            <h1>
              Apprenez avec intention.
              <br />
              <em>Avancez avec confiance.</em>
            </h1>
            <p>
              Un espace pensé pour transformer chaque apprentissage en une
              nouvelle possibilité professionnelle.
            </p>
          </div>
          <div className="login-story-bottom">
            <span className="story-index">01 / 01</span>
            <span>PLATEFORME PÉDAGOGIQUE JZ KALYPHOR</span>
          </div>
        </div>
        <div className="story-geometry" aria-hidden="true">
          <span className="geometry-ring ring-one" />
          <span className="geometry-ring ring-two" />
          <span className="geometry-ring ring-three" />
          <span className="geometry-core" />
        </div>
      </section>

      <section className="login-form-side">
        <div className="login-form-top">
          <span className="login-top-rule" />
          ACCÈS SÉCURISÉ
        </div>
        <div className="login-form-wrap">
          <div className="login-mobile-brand">
            <Brand />
          </div>
          <div className="form-eyebrow">BIENVENUE SUR JZ KALYPHOR</div>
          <h2>
            Heureux de vous
            <br />
            retrouver.
          </h2>
          <p className="login-intro">
            {mode === "student"
              ? "Connectez-vous avec votre nom complet et l'immatriculation transmise par votre formateur."
              : "Espace réservé à l'administration pédagogique."}
          </p>
          <div className="login-mode" role="tablist" aria-label="Type d'accès">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "student"}
              className={mode === "student" ? "mode-active" : ""}
              onClick={() => switchMode("student")}
            >
              <Icon name="user" size={16} />
              Étudiant
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "admin"}
              className={mode === "admin" ? "mode-active" : ""}
              onClick={() => switchMode("admin")}
            >
              <Icon name="shield" size={16} />
              Formateur
            </button>
          </div>
          <form onSubmit={submit} className="login-form">
            <label htmlFor="login-name">
              {mode === "student" ? "Nom complet" : "Identifiant formateur"}
            </label>
            <div className="input-with-icon">
              <Icon name="user" size={19} />
              <input
                id="login-name"
                autoComplete="username"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setError("");
                }}
                placeholder={
                  mode === "student" ? "Votre nom complet" : "Votre identifiant"
                }
                required
              />
            </div>
            {mode === "student" ? (
              <>
                <label htmlFor="login-registration">Immatriculation</label>
                <div className="input-with-icon">
                  <Icon name="target" size={19} />
                  <input
                    id="login-registration"
                    className="registration-input"
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    value={secret}
                    onChange={(event) => {
                      setSecret(event.target.value.toUpperCase());
                      setError("");
                    }}
                    placeholder="Ex. AD-2026-10"
                    required
                  />
                </div>
              </>
            ) : (
              <>
                <label htmlFor="login-password">Mot de passe</label>
                <div className="input-with-icon">
                  <Icon name="lock" size={19} />
                  <input
                    id="login-password"
                    type={visible ? "text" : "password"}
                    autoComplete="current-password"
                    value={secret}
                    onChange={(event) => {
                      setSecret(event.target.value);
                      setError("");
                    }}
                    placeholder="Votre mot de passe"
                    required
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    onClick={() => setVisible(!visible)}
                    aria-label={
                      visible
                        ? "Masquer le mot de passe"
                        : "Afficher le mot de passe"
                    }
                  >
                    <Icon name={visible ? "eyeOff" : "eye"} size={19} />
                  </button>
                </div>
              </>
            )}
            {error && (
              <div className="form-error" role="alert">
                <Icon name="alert" size={17} />
                {error}
              </div>
            )}
            <button
              type="submit"
              className="button button-primary login-submit"
              disabled={pending}
            >
              {pending ? "Connexion en cours…" : "Accéder à mon espace"}{" "}
              {!pending && <Icon name="arrowRight" size={19} />}
            </button>
          </form>
          <p className="login-help">
            <Icon name="shield" size={15} />
            <span>
              {mode === "student"
                ? "Votre immatriculation vous a été transmise par WhatsApp lors de votre inscription. En cas de difficulté, contactez votre formateur."
                : "Accès strictement réservé à l'équipe pédagogique JZ KALYPHOR."}
            </span>
          </p>
        </div>
        <div className="login-bottom">
          <span>
            © {new Date().getFullYear()} JZ KALYPHOR. Tous droits réservés.
          </span>
          <span>{DEFAULT_PORTAL_URL.replace(/^https?:\/\//, "")}</span>
        </div>
      </section>
    </div>
  );
}

function Sidebar({
  role,
  activeView,
  studentName,
  studentRegistration,
  onNavigate,
  onLogout,
  open,
  onClose,
  badges = {},
}: {
  role: "admin" | "student";
  activeView: string;
  studentName?: string;
  studentRegistration?: string;
  onNavigate: (view: string) => void;
  onLogout: () => void;
  open: boolean;
  onClose: () => void;
  /** Pastilles d'alerte par rubrique (nombre ou libellé court). */
  badges?: Record<string, string | number>;
}) {
  const items: { id: string; label: string; icon: IconName }[] =
    role === "admin"
      ? [
          { id: "overview", label: "Vue d'ensemble", icon: "dashboard" },
          { id: "students", label: "Étudiants", icon: "users" },
          { id: "courses", label: "Cours & ressources", icon: "courses" },
          { id: "tracking", label: "Suivi & rapports", icon: "tracking" },
          { id: "weekly", label: "Bilans hebdo", icon: "calendar" },
        ]
      : [
          { id: "courses", label: "Mes cours", icon: "courses" },
          { id: "weekly", label: "Bilan hebdo", icon: "calendar" },
          { id: "progress", label: "Mon parcours", icon: "tracking" },
        ];

  return (
    <>
      {open && (
        <button
          className="sidebar-backdrop"
          type="button"
          aria-label="Fermer le menu"
          onClick={onClose}
        />
      )}
      <aside className={`sidebar ${open ? "sidebar-open" : ""}`}>
        <div className="sidebar-brand">
          <Brand light />
          <button
            className="icon-button sidebar-mobile-close"
            type="button"
            onClick={onClose}
            aria-label="Fermer le menu"
          >
            <Icon name="close" size={20} />
          </button>
        </div>
        <div className="sidebar-section-label">ESPACE DE TRAVAIL</div>
        <nav className="sidebar-nav" aria-label="Navigation principale">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              data-tour={`nav-${item.id}`}
              className={`nav-item ${activeView === item.id || (activeView === "course" && item.id === "courses") ? "nav-active" : ""}`}
              onClick={() => {
                onNavigate(item.id);
                onClose();
              }}
            >
              <Icon name={item.icon} size={20} />
              <span>{item.label}</span>
              {badges[item.id] !== undefined && (
                <span
                  className="nav-badge"
                  aria-hidden="true"
                  title={
                    badges[item.id] === "!"
                      ? "Action attendue"
                      : `${badges[item.id]} élément(s) à traiter`
                  }
                >
                  {badges[item.id]}
                </span>
              )}
              {(activeView === item.id ||
                (activeView === "course" && item.id === "courses")) && (
                <span className="nav-indicator" />
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-account">
            <Avatar
              name={role === "admin" ? ADMIN_NAME : studentName || "Étudiant"}
              small
            />
            <div>
              <strong>{role === "admin" ? ADMIN_NAME : studentName}</strong>
              <span>
                {role === "admin"
                  ? "Formateur / Admin"
                  : studentRegistration || "Espace étudiant"}
              </span>
            </div>
            <button
              type="button"
              className="icon-button sidebar-logout"
              aria-label="Se déconnecter"
              title="Se déconnecter"
              onClick={onLogout}
            >
              <Icon name="logout" size={18} />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

function Topbar({
  title,
  role,
  name,
  onMenu,
  onHelp,
  pendingReviews = 0,
  onPendingClick,
}: {
  title: string;
  role: "admin" | "student";
  name: string;
  onMenu: () => void;
  onHelp: () => void;
  pendingReviews?: number;
  onPendingClick?: () => void;
  remote?: boolean;
}) {
  return (
    <header className="topbar">
      <div className="topbar-left">
        <button
          type="button"
          className="icon-button mobile-menu"
          onClick={onMenu}
          aria-label="Ouvrir le menu"
        >
          <Icon name="menu" size={22} />
        </button>
        <span className="topbar-path">
          Espace {role === "admin" ? "formateur" : "étudiant"}
        </span>
        <Icon name="chevron" size={14} className="topbar-chevron" />
        <strong>{title}</strong>
      </div>
      <div className="topbar-right">
        <span
          className={`mode-chip ${REMOTE ? "mode-chip-online" : "mode-chip-local"}`}
          title={
            REMOTE
              ? "Vos données sont synchronisées en ligne (Supabase)."
              : "Mode démonstration hors ligne : les données restent sur cet appareil."
          }
        >
          <Icon name={REMOTE ? "cloud" : "cloudOff"} size={14} />
          {REMOTE ? "Synchronisé en ligne" : "Mode démo local"}
        </span>
        {pendingReviews > 0 && onPendingClick && (
          <button
            type="button"
            className="pending-chip"
            onClick={onPendingClick}
            title="Rapports transmis en attente d'inspection"
          >
            <span className="pending-dot" />
            {pendingReviews} rapport{pendingReviews > 1 ? "s" : ""} à inspecter
          </button>
        )}
        <span className="topbar-date">
          <Icon name="calendar" size={16} />
          {new Intl.DateTimeFormat("fr-FR", {
            day: "numeric",
            month: "long",
            year: "numeric",
          }).format(new Date())}
        </span>
        <button
          type="button"
          className="help-button"
          onClick={onHelp}
          data-tour="help"
          aria-label="Ouvrir le guide d'utilisation"
          title="Guide d'utilisation et visite guidée"
        >
          <span>?</span>
          <small>Aide</small>
        </button>
        <span className="topbar-divider" />
        <Avatar name={name} small />
      </div>
    </header>
  );
}

function PageHeading({
  eyebrow,
  title,
  subtitle,
  action,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <span className="section-eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {action && <div className="heading-action">{action}</div>}
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  note,
  tone,
}: {
  icon: IconName;
  label: string;
  value: string;
  note: string;
  tone: string;
}) {
  return (
    <div className="kpi-card">
      <div className="kpi-top">
        <span className={`kpi-icon kpi-${tone}`}>
          <Icon name={icon} size={21} />
        </span>
        <Icon name="arrowRight" size={17} className="kpi-arrow" />
      </div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-label">{label}</div>
      <div className="kpi-note">{note}</div>
    </div>
  );
}

function AdminOverview({
  assignments,
  studentsCount,
  cohortsCount,
  coursesCount,
  onNavigate,
  onInspect,
  onCreateCourse,
  checklist,
  weeklyBanner,
}: {
  assignments: Assignment[];
  studentsCount: number;
  cohortsCount: number;
  coursesCount: number;
  onNavigate: (view: AdminView) => void;
  onInspect: (studentId: string, courseId: string) => void;
  onCreateCourse: () => void;
  checklist: ReactNode;
  weeklyBanner: ReactNode;
}) {
  const submitted = assignments.filter(
    (item) => item.progress.status === "submitted",
  ).length;
  const toReview = assignments.filter(
    (item) => item.progress.status === "submitted" && !item.progress.reviewedAt,
  ).length;
  const inProgress = assignments.filter(
    (item) => item.progress.status === "in_progress",
  ).length;
  const totalMinutes = assignments.reduce(
    (sum, item) => sum + item.progress.hours * 60 + item.progress.minutes,
    0,
  );
  const rate = assignments.length
    ? Math.round((submitted / assignments.length) * 100)
    : 0;
  const recent = [...assignments]
    .sort((a, b) => {
      const score = (item: Assignment) =>
        item.progress.status === "submitted"
          ? 2
          : item.progress.status === "in_progress"
            ? 1
            : 0;
      return (
        score(b) - score(a) ||
        (b.progress.submittedAt || b.course.createdAt).localeCompare(
          a.progress.submittedAt || a.course.createdAt,
        )
      );
    })
    .slice(0, 5);

  return (
    <>
      <PageHeading
        eyebrow="TABLEAU DE BORD"
        title="Bonjour, Yves Jonathan"
        subtitle="Voici l'essentiel de votre activité pédagogique aujourd'hui."
        action={
          <button
            className="button button-primary"
            type="button"
            onClick={onCreateCourse}
          >
            <Icon name="plus" size={19} />
            Publier un cours
          </button>
        }
      />
      <div className="kpi-grid" data-tour="kpis">
        <KpiCard
          icon="users"
          label="Étudiants inscrits"
          value={String(studentsCount).padStart(2, "0")}
          note={`${cohortsCount} cohorte${cohortsCount > 1 ? "s" : ""} active${cohortsCount > 1 ? "s" : ""}`}
          tone="blue"
        />
        <KpiCard
          icon="courses"
          label="Cours actifs"
          value={String(coursesCount).padStart(2, "0")}
          note="Ressources publiées"
          tone="gold"
        />
        <KpiCard
          icon="clock"
          label="Temps d'apprentissage"
          value={formatDuration(
            Math.floor(totalMinutes / 60),
            totalMinutes % 60,
          )}
          note="Cumul déclaré par les étudiants"
          tone="violet"
        />
        <KpiCard
          icon="tracking"
          label="Rapports rendus"
          value={`${submitted} / ${assignments.length}`}
          note={
            toReview
              ? `${toReview} à inspecter · ${Math.max(0, assignments.length - submitted)} en attente`
              : `${Math.max(0, assignments.length - submitted)} en attente de transmission`
          }
          tone="green"
        />
      </div>
      {weeklyBanner}
      {checklist}
      <div className="overview-grid">
        <section className="surface recent-panel">
          <div className="panel-heading">
            <div>
              <span className="panel-kicker">VUE D'ENSEMBLE</span>
              <h2>Suivi des apprentissages</h2>
              <p>Le point sur les cours attribués à vos étudiants.</p>
            </div>
            <button
              className="text-action"
              type="button"
              onClick={() => onNavigate("tracking")}
            >
              Voir tout <Icon name="arrowRight" size={16} />
            </button>
          </div>
          <div className="table-scroll">
            <table className="data-table overview-table">
              <thead>
                <tr>
                  <th>ÉTUDIANT</th>
                  <th>COURS ATTRIBUÉ</th>
                  <th>TEMPS</th>
                  <th>STATUT</th>
                  <th aria-label="Action" />
                </tr>
              </thead>
              <tbody>
                {recent.map(({ student, course, progress }) => (
                  <tr key={`${student.id}-${course.id}`}>
                    <td>
                      <div className="person-cell">
                        <Avatar name={student.name} small />
                        <strong>{student.name}</strong>
                      </div>
                    </td>
                    <td>
                      <span className="table-course-title" title={course.title}>
                        {course.title}
                      </span>
                    </td>
                    <td className="table-time">
                      {formatDuration(progress.hours, progress.minutes)}
                    </td>
                    <td>
                      <StatusBadge status={progress.status} />
                    </td>
                    <td>
                      <button
                        className="row-arrow"
                        type="button"
                        onClick={() => {
                          if (progress.status === "submitted")
                            onInspect(student.id, course.id);
                          else onNavigate("tracking");
                        }}
                        aria-label={`Voir le suivi de ${student.name}`}
                      >
                        <Icon name="arrowRight" size={17} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {recent.length === 0 && (
              <EmptyState
                icon="tracking"
                title="Aucun suivi pour le moment"
                text="Ajoutez des étudiants et publiez un cours pour commencer."
              />
            )}
          </div>
        </section>
        <section className="insight-panel">
          <div className="insight-pattern" aria-hidden="true" />
          <div className="insight-content">
            <span className="insight-overline">PROGRESSION GLOBALE</span>
            <h2>
              Chaque étape
              <br />
              compte.
            </h2>
            <div className="donut-wrap">
              <div
                className="donut"
                style={{ "--percent": `${rate}%` } as CSSProperties}
              >
                <div>
                  <strong>{rate}%</strong>
                  <span>complétés</span>
                </div>
              </div>
            </div>
            <div className="insight-legend">
              <span>
                <i className="legend-gold" /> Rapports rendus{" "}
                <strong>{submitted}</strong>
              </span>
              <span>
                <i className="legend-blue" /> En cours{" "}
                <strong>{inProgress}</strong>
              </span>
              <span>
                <i className="legend-muted" /> Non commencés{" "}
                <strong>{assignments.length - submitted - inProgress}</strong>
              </span>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}

function EmptyState({
  icon,
  title,
  text,
  action,
}: {
  icon: IconName;
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span>
        <Icon name={icon} size={25} />
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  );
}

/* ---------- Accompagnement autoguidé ---------- */

type SpotlightRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

/**
 * Visite guidée interactive : met en lumière un élément de l'interface
 * (attribut data-tour) et affiche une carte explicative étape par étape.
 */
function GuidedTour({
  steps,
  onStep,
  onClose,
}: {
  steps: TourStep[];
  onStep?: (step: TourStep) => void;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<SpotlightRect | null>(null);
  const step = steps[index];

  useEffect(() => {
    onStep?.(step);
    let frame = 0;
    let attempts = 0;
    function measure() {
      const element = document.querySelector<HTMLElement>(
        `[data-tour="${step.target}"]`,
      );
      if (!element) {
        if (attempts++ < 20) frame = window.setTimeout(measure, 60);
        else setRect(null);
        return;
      }
      const box = element.getBoundingClientRect();
      if (box.width === 0 && box.height === 0) {
        if (attempts++ < 20) frame = window.setTimeout(measure, 60);
        else setRect(null);
        return;
      }
      const margin = 8;
      setRect({
        top: box.top - margin,
        left: box.left - margin,
        width: box.width + margin * 2,
        height: box.height + margin * 2,
      });
    }
    const element = document.querySelector<HTMLElement>(
      `[data-tour="${step.target}"]`,
    );
    element?.scrollIntoView({ block: "center", behavior: "smooth" });
    frame = window.setTimeout(measure, element ? 320 : 0);
    const refresh = () => measure();
    window.addEventListener("resize", refresh);
    window.addEventListener("scroll", refresh, true);
    return () => {
      window.clearTimeout(frame);
      window.removeEventListener("resize", refresh);
      window.removeEventListener("scroll", refresh, true);
    };
  }, [step, onStep]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight" && index < steps.length - 1)
        setIndex(index + 1);
      if (event.key === "ArrowLeft" && index > 0) setIndex(index - 1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, steps.length, onClose]);

  const isLast = index === steps.length - 1;
  const viewportHeight = typeof window !== "undefined" ? window.innerHeight : 0;
  const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 0;
  const compact = viewportWidth < 700;
  let cardStyle: CSSProperties = {};
  if (!compact && rect) {
    const below = rect.top + rect.height + 250 < viewportHeight;
    const left = Math.min(Math.max(16, rect.left), viewportWidth - 376);
    cardStyle = below
      ? { top: rect.top + rect.height + 14, left }
      : { bottom: viewportHeight - rect.top + 14, left };
  }

  return (
    <div
      className="tour-layer"
      role="dialog"
      aria-modal="true"
      aria-label="Visite guidée"
    >
      <div className="tour-backdrop" onClick={onClose} />
      {rect ? (
        <div
          className="tour-spotlight"
          style={{
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
          }}
        />
      ) : (
        <div className="tour-spotlight tour-spotlight-hidden" />
      )}
      <div
        className={`tour-card ${compact || !rect ? "tour-card-docked" : ""}`}
        style={cardStyle}
      >
        <div className="tour-card-top">
          <span className="tour-progress">
            Étape {index + 1} / {steps.length}
          </span>
          <button
            type="button"
            className="icon-button tour-close"
            onClick={onClose}
            aria-label="Quitter la visite"
          >
            <Icon name="close" size={16} />
          </button>
        </div>
        <h3>{step.title}</h3>
        <p>{step.text}</p>
        <div className="tour-dots" aria-hidden="true">
          {steps.map((item, dot) => (
            <i
              key={item.target}
              className={dot === index ? "dot-active" : ""}
            />
          ))}
        </div>
        <div className="tour-actions">
          <button type="button" className="tour-skip" onClick={onClose}>
            {isLast ? "Fermer" : "Passer la visite"}
          </button>
          <div className="tour-nav">
            {index > 0 && (
              <button
                type="button"
                className="button button-secondary tour-button"
                onClick={() => setIndex(index - 1)}
              >
                Précédent
              </button>
            )}
            <button
              type="button"
              className="button button-primary tour-button"
              onClick={() => (isLast ? onClose() : setIndex(index + 1))}
            >
              {isLast ? "Terminer" : "Suivant"}
              {!isLast && <Icon name="arrowRight" size={16} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

type HelpTopic = { question: string; answer: string };

const ADMIN_HELP: HelpTopic[] = [
  {
    question: "Comment inscrire un étudiant ?",
    answer:
      "Étudiants → Ajouter un étudiant. Saisissez son nom complet, son WhatsApp et son mois d'adhésion : l'immatriculation (initiales + année + mois) est générée automatiquement et devient sa clé de connexion.",
  },
  {
    question: "Comment lui transmettre ses accès ?",
    answer:
      "Dans la liste, cliquez sur « Envoyer les accès ». WhatsApp s'ouvre avec un message prêt : nom, immatriculation, cohorte et lien de l'espace étudiant. La date d'envoi est ensuite mémorisée sous son nom.",
  },
  {
    question: "Comment publier un cours ciblé ?",
    answer:
      "Cours & ressources → Publier un cours. Choisissez le format, l'URL et la diffusion : tous les étudiants, une cohorte ou une personne. Pour une plateforme externe, vous pouvez renseigner les accès propres à chaque étudiant.",
  },
  {
    question: "Les liens externes sont-ils envoyés par WhatsApp ?",
    answer:
      "Non. Seul le lien de l'espace étudiant est communiqué. L'étudiant découvre la plateforme externe uniquement en cliquant sur le bouton d'accès dans son cours.",
  },
  {
    question: "Comment vérifier un rapport ?",
    answer:
      "Suivi & rapports → Inspecter. Vous consultez le temps déclaré, le compte-rendu et les preuves (prévisualisation et téléchargement). Le rapport est alors marqué comme inspecté.",
  },
  {
    question: "Comment fonctionnent les bilans hebdomadaires ?",
    answer:
      "Chaque étudiant rend un bilan par semaine (lundi → dimanche) avant le dimanche 23:59 : temps d'étude, cours travaillés, compte-rendu, difficultés et objectifs. Dans « Bilans hebdo », naviguez de semaine en semaine : rendu à temps, en retard, à rendre ou non rendu. Un rappel WhatsApp est pré-rédigé pour chaque situation.",
  },
  {
    question: "Que faire si un étudiant ne rend pas son rapport ?",
    answer:
      "Utilisez « Relancer » : un message professionnel, adapté à sa situation, est pré-rédigé. Vous pouvez aussi suspendre son accès à tout moment.",
  },
];

const STUDENT_HELP: HelpTopic[] = [
  {
    question: "Comment me connecter ?",
    answer:
      "Avec votre nom complet et votre immatriculation (ex. AD-2026-10), reçus par WhatsApp. Aucun mot de passe n'est nécessaire.",
  },
  {
    question: "Quand dois-je rendre mon bilan hebdomadaire ?",
    answer:
      "Chaque semaine, avant le dimanche 23:59. Ouvrez « Bilan hebdo », renseignez votre temps d'étude, les cours travaillés, votre compte-rendu et vos objectifs, puis transmettez. Votre brouillon est enregistré automatiquement et vous pouvez le modifier jusqu'à l'échéance. Après, un bilan non rendu peut encore être transmis, mais il est signalé en retard.",
  },
  {
    question: "Comment valider un cours ?",
    answer:
      "Ouvrez le cours, consultez la ressource, déclarez votre temps d'étude, rédigez votre compte-rendu, joignez une preuve (capture ou PDF) puis cliquez sur « Envoyer mon rapport ».",
  },
  {
    question: "Où trouver mes accès à une plateforme externe ?",
    answer:
      "Dans la page du cours concerné, sous le bouton d'accès : votre e-mail ou nom d'utilisateur et votre mot de passe, copiables en un clic. Ces accès sont personnels.",
  },
  {
    question: "Le chronomètre compte-t-il si je quitte la page ?",
    answer:
      "Oui. Il reste actif tant que vous ne le mettez pas en pause, même si vous changez de page ou fermez l'onglet.",
  },
  {
    question: "Puis-je modifier un rapport déjà envoyé ?",
    answer:
      "Oui. Rouvrez le cours, ajustez vos informations puis cliquez sur « Mettre à jour mon rapport ».",
  },
];

/** Panneau d'aide latéral : questions fréquentes et relance de la visite guidée. */
function HelpPanel({
  role,
  onClose,
  onStartTour,
}: {
  role: "admin" | "student";
  onClose: () => void;
  onStartTour: () => void;
}) {
  const topics = role === "admin" ? ADMIN_HELP : STUDENT_HELP;
  return (
    <div
      className="help-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        className="help-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Guide d'utilisation"
      >
        <div className="help-panel-top">
          <div>
            <span className="section-eyebrow">GUIDE D'UTILISATION</span>
            <h2>{role === "admin" ? "Espace formateur" : "Espace étudiant"}</h2>
          </div>
          <button
            type="button"
            className="icon-button modal-close help-close"
            onClick={onClose}
            aria-label="Fermer l'aide"
          >
            <Icon name="close" size={20} />
          </button>
        </div>
        <button
          type="button"
          className="help-tour-button"
          onClick={onStartTour}
        >
          <span className="help-tour-icon">
            <Icon name="sparkle" size={18} />
          </span>
          <span>
            <strong>Relancer la visite guidée</strong>
            <small>
              Un tour interactif des fonctions essentielles, en 1 minute.
            </small>
          </span>
          <Icon name="arrowRight" size={17} />
        </button>
        <div className="help-topics">
          {topics.map((topic) => (
            <details key={topic.question} className="help-topic">
              <summary>
                <span>{topic.question}</span>
                <Icon name="chevron" size={15} />
              </summary>
              <p>{topic.answer}</p>
            </details>
          ))}
        </div>
        <p className="help-footer">
          <Icon name="shield" size={14} />
          {role === "admin"
            ? "Les données sont enregistrées automatiquement sur cet appareil."
            : "Pour toute difficulté, contactez directement votre formateur."}
        </p>
      </aside>
    </div>
  );
}

type ChecklistItem = {
  id: string;
  label: string;
  hint: string;
  done: boolean;
  actionLabel: string;
  onAction: () => void;
};

/** Checklist de démarrage du formateur : chaque étape se valide automatiquement. */
function OnboardingChecklist({
  items,
  onHide,
}: {
  items: ChecklistItem[];
  onHide: () => void;
}) {
  const done = items.filter((item) => item.done).length;
  const next = items.find((item) => !item.done);
  const complete = done === items.length;
  return (
    <section
      className={`surface checklist ${complete ? "checklist-complete" : ""}`}
      data-tour="checklist"
    >
      <div className="checklist-heading">
        <div>
          <span className="panel-kicker">PARCOURS DE DÉMARRAGE</span>
          <h2>
            {complete
              ? "Votre plateforme est opérationnelle."
              : `Prochaine étape : ${next?.label}`}
          </h2>
          <p>
            {complete
              ? "Toutes les étapes clés sont validées. Vous pouvez masquer ce guide."
              : next?.hint}
          </p>
        </div>
        <div className="checklist-meter">
          <strong>
            {done}/{items.length}
          </strong>
          <div>
            <i style={{ width: `${(done / items.length) * 100}%` }} />
          </div>
          <button type="button" className="checklist-hide" onClick={onHide}>
            Masquer
          </button>
        </div>
      </div>
      <ol className="checklist-items">
        {items.map((item, position) => (
          <li
            key={item.id}
            className={`checklist-item ${item.done ? "item-done" : ""} ${item.id === next?.id ? "item-current" : ""}`}
          >
            <span className="checklist-mark">
              {item.done ? <Icon name="check" size={14} /> : position + 1}
            </span>
            <div>
              <strong>{item.label}</strong>
              <span>{item.hint}</span>
            </div>
            {!item.done && (
              <button
                type="button"
                className="checklist-action"
                onClick={item.onAction}
              >
                {item.actionLabel}
                <Icon name="arrowRight" size={14} />
              </button>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Carte « prochaine étape » de l'étudiant : indique toujours quoi faire ensuite. */
function NextActionCard({
  assignments,
  onOpen,
}: {
  assignments: Assignment[];
  onOpen: (courseId: string) => void;
}) {
  const next =
    assignments.find((item) => item.progress.status === "in_progress") ||
    assignments.find((item) => item.progress.status === "not_started");
  if (!assignments.length) return null;
  return (
    <section className="next-action" data-tour="student-next">
      <span className="next-action-icon">
        <Icon name={next ? "sparkle" : "checkCircle"} size={21} />
      </span>
      <div className="next-action-copy">
        <span className="panel-kicker">PROCHAINE ÉTAPE</span>
        {next ? (
          <>
            <strong>
              {next.progress.status === "in_progress"
                ? "Reprendre"
                : "Commencer"}{" "}
              « {next.course.title} »
            </strong>
            <span>
              {next.progress.status === "in_progress"
                ? "Votre séance est en cours : finalisez votre temps, votre compte-rendu et vos preuves."
                : "Ouvrez le cours, consultez la ressource puis suivez les quatre étapes guidées."}
            </span>
          </>
        ) : (
          <>
            <strong>Votre parcours est à jour.</strong>
            <span>
              Tous vos rapports ont été transmis. De nouveaux cours apparaîtront
              ici dès leur publication.
            </span>
          </>
        )}
      </div>
      {next && (
        <button
          type="button"
          className="button button-gold"
          onClick={() => onOpen(next.course.id)}
        >
          {next.progress.status === "in_progress" ? "Reprendre" : "Commencer"}
          <Icon name="arrowRight" size={17} />
        </button>
      )}
    </section>
  );
}

function AdminStudents({
  students,
  assignments,
  portalUrl,
  query,
  setQuery,
  filter,
  setFilter,
  cohortFilter,
  setCohortFilter,
  onAdd,
  onToggle,
  onDelete,
  onRemind,
  onSendAccess,
  onSavePortalUrl,
}: {
  students: Student[];
  assignments: Assignment[];
  portalUrl: string;
  query: string;
  setQuery: (value: string) => void;
  filter: "all" | "active" | "suspended";
  setFilter: (value: "all" | "active" | "suspended") => void;
  cohortFilter: string;
  setCohortFilter: (value: string) => void;
  onAdd: () => void;
  onToggle: (student: Student) => void;
  onDelete: (student: Student) => void;
  onRemind: (student: Student) => void;
  onSendAccess: (student: Student) => void;
  onSavePortalUrl: (value: string) => string | null;
}) {
  const [portalDraft, setPortalDraft] = useState(portalUrl);
  const [portalError, setPortalError] = useState("");
  const cohorts = listCohorts(students);
  const search = query.trim().toLowerCase();
  const filtered = students.filter(
    (student) =>
      (student.name.toLowerCase().includes(search) ||
        student.registration.toLowerCase().includes(search)) &&
      (filter === "all" ||
        (filter === "active" ? student.active : !student.active)) &&
      (cohortFilter === "all" || student.cohort === cohortFilter),
  );
  const groups = listCohorts(filtered).map((cohort) => ({
    cohort,
    students: filtered
      .filter((student) => student.cohort === cohort)
      .sort((a, b) => a.name.localeCompare(b.name, "fr")),
  }));

  function savePortal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPortalError(onSavePortalUrl(portalDraft) || "");
  }

  return (
    <>
      <PageHeading
        eyebrow="GESTION DES ACCÈS"
        title="Vos étudiants"
        subtitle="Organisez vos cohortes, transmettez les accès et gardez le contrôle de chaque inscription."
        action={
          <button
            className="button button-primary"
            type="button"
            onClick={onAdd}
          >
            <Icon name="plus" size={19} />
            Ajouter un étudiant
          </button>
        }
      />
      <section className="surface portal-card">
        <div className="portal-card-copy">
          <span className="panel-kicker">LIEN DE L'ESPACE ÉTUDIANT</span>
          <h2>Adresse communiquée dans les messages WhatsApp</h2>
          <p>
            Seule cette adresse accompagne l'immatriculation dans les messages
            d'accès, de relance et de notification de cours. Les liens des
            plateformes externes ne sont jamais transmis : l'étudiant y accède
            uniquement depuis son espace.
          </p>
        </div>
        <form className="portal-form" onSubmit={savePortal}>
          <div className="input-with-icon portal-input">
            <Icon name="link" size={18} />
            <input
              aria-label="Lien de l'espace étudiant"
              type="text"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              value={portalDraft}
              onChange={(event) => {
                setPortalDraft(event.target.value);
                setPortalError("");
              }}
              placeholder={DEFAULT_PORTAL_URL}
            />
          </div>
          <button type="submit" className="button button-secondary">
            Enregistrer
          </button>
          {portalError && (
            <span className="portal-error" role="alert">
              {portalError}
            </span>
          )}
        </form>
      </section>
      <section className="surface management-panel">
        <div className="panel-heading management-heading">
          <div>
            <span className="panel-kicker">RÉPERTOIRE PAR COHORTE</span>
            <h2>
              Liste des étudiants{" "}
              <span className="heading-count">{students.length}</span>
            </h2>
          </div>
          <div className="toolbar">
            <div className="search-field">
              <Icon name="search" size={18} />
              <input
                aria-label="Rechercher un étudiant"
                placeholder="Nom ou immatriculation..."
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <select
              aria-label="Filtrer par cohorte"
              value={cohortFilter}
              onChange={(event) => setCohortFilter(event.target.value)}
            >
              <option value="all">Toutes les cohortes</option>
              {cohorts.map((cohort) => (
                <option key={cohort} value={cohort}>
                  {cohortLabel(cohort)}
                </option>
              ))}
            </select>
            <select
              aria-label="Filtrer par statut"
              value={filter}
              onChange={(event) =>
                setFilter(event.target.value as "all" | "active" | "suspended")
              }
            >
              <option value="all">Tous les statuts</option>
              <option value="active">Actifs</option>
              <option value="suspended">Suspendus</option>
            </select>
          </div>
        </div>
        <div className="table-scroll">
          <table className="data-table management-table students-table">
            <thead>
              <tr>
                <th>ÉTUDIANT</th>
                <th>IMMATRICULATION</th>
                <th>WHATSAPP</th>
                <th>PROGRESSION</th>
                <th>ACCÈS</th>
                <th className="actions-heading">ACTIONS</th>
              </tr>
            </thead>
            {groups.map((group) => (
              <tbody key={group.cohort}>
                <tr className="cohort-row">
                  <td colSpan={6}>
                    <span className="cohort-chip">
                      <Icon name="calendar" size={13} />
                      {cohortLabel(group.cohort)}
                    </span>
                    <span className="cohort-count">
                      {group.students.length} étudiant
                      {group.students.length > 1 ? "s" : ""}
                    </span>
                  </td>
                </tr>
                {group.students.map((student) => {
                  const studentAssignments = assignments.filter(
                    (item) => item.student.id === student.id,
                  );
                  const done = studentAssignments.filter(
                    (item) => item.progress.status === "submitted",
                  ).length;
                  return (
                    <tr key={student.id}>
                      <td>
                        <div className="person-cell">
                          <Avatar name={student.name} />
                          <div>
                            <strong>{student.name}</strong>
                            <span className="cell-subtext">
                              Inscrit le {formatDate(student.createdAt)}
                            </span>
                            {student.accessSentAt ? (
                              <span className="access-sent">
                                <Icon name="checkCircle" size={11} />
                                Accès envoyés le{" "}
                                {formatDate(student.accessSentAt)}
                              </span>
                            ) : (
                              <span className="access-pending">
                                <Icon name="alert" size={11} />
                                Accès à envoyer
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td>
                        <code className="registration-code">
                          {student.registration}
                        </code>
                      </td>
                      <td className="muted-cell">{student.whatsapp}</td>
                      <td>
                        <div className="mini-progress">
                          <span>
                            {done} / {studentAssignments.length} cours
                          </span>
                          <div>
                            <i
                              style={{
                                width: `${studentAssignments.length ? (done / studentAssignments.length) * 100 : 0}%`,
                              }}
                            />
                          </div>
                        </div>
                      </td>
                      <td>
                        <span
                          className={`access-badge ${student.active ? "access-active" : "access-suspended"}`}
                        >
                          <span />
                          {student.active ? "Actif" : "Suspendu"}
                        </span>
                      </td>
                      <td>
                        <div className="table-actions">
                          <button
                            className="button button-table button-whatsapp"
                            type="button"
                            onClick={() => onSendAccess(student)}
                            title="Envoyer l'immatriculation et le lien de l'espace étudiant par WhatsApp"
                          >
                            <Icon name="send" size={15} />
                            Envoyer les accès
                          </button>
                          <button
                            className="button button-table"
                            type="button"
                            onClick={() => onRemind(student)}
                            title="Envoyer une relance WhatsApp"
                          >
                            <Icon name="phone" size={16} />
                            Relancer
                          </button>
                          <button
                            className={`button button-table ${student.active ? "button-warn" : "button-activate"}`}
                            type="button"
                            onClick={() => onToggle(student)}
                          >
                            {student.active ? "Suspendre" : "Activer"}
                          </button>
                          <button
                            className="icon-button delete-action"
                            type="button"
                            onClick={() => onDelete(student)}
                            title="Supprimer l'étudiant"
                            aria-label={`Supprimer ${student.name}`}
                          >
                            <Icon name="trash" size={17} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            ))}
          </table>
          {filtered.length === 0 && (
            <EmptyState
              icon="users"
              title="Aucun étudiant trouvé"
              text={
                students.length
                  ? "Essayez une autre recherche ou un autre filtre."
                  : "Ajoutez votre premier étudiant : son immatriculation sera générée automatiquement."
              }
              action={
                !students.length && (
                  <button
                    className="button button-primary"
                    type="button"
                    onClick={onAdd}
                  >
                    <Icon name="plus" size={18} />
                    Ajouter un étudiant
                  </button>
                )
              }
            />
          )}
        </div>
      </section>
    </>
  );
}

function AdminCourses({
  courses,
  students,
  assignments,
  onAdd,
  onDelete,
  onCredentials,
}: {
  courses: Course[];
  students: Student[];
  assignments: Assignment[];
  onAdd: () => void;
  onDelete: (course: Course) => void;
  onCredentials: (course: Course) => void;
}) {
  return (
    <>
      <PageHeading
        eyebrow="BIBLIOTHÈQUE PÉDAGOGIQUE"
        title="Cours & ressources"
        subtitle="Publiez le bon contenu, au bon apprenant, au bon moment."
        action={
          <button
            className="button button-primary"
            type="button"
            onClick={onAdd}
          >
            <Icon name="plus" size={19} />
            Publier un cours
          </button>
        }
      />
      <section className="surface management-panel">
        <div className="panel-heading management-heading">
          <div>
            <span className="panel-kicker">CONTENUS DISPONIBLES</span>
            <h2>
              Bibliothèque de cours{" "}
              <span className="heading-count">{courses.length}</span>
            </h2>
          </div>
          <span className="panel-caption">Vidéo, lien web ou document</span>
        </div>
        <div className="table-scroll">
          <table className="data-table management-table course-table">
            <thead>
              <tr>
                <th>COURS</th>
                <th>FORMAT</th>
                <th>DIFFUSION</th>
                <th>RAPPORTS</th>
                <th>PUBLICATION</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {[...courses].reverse().map((course) => {
                const courseAssignments = assignments.filter(
                  (item) => item.course.id === course.id,
                );
                const completed = courseAssignments.filter(
                  (item) => item.progress.status === "submitted",
                ).length;
                const targetName = describeTarget(course.target, students);
                return (
                  <tr key={course.id}>
                    <td>
                      <div className="course-cell">
                        <ResourceIcon type={course.type} />
                        <div>
                          <strong>{course.title}</strong>
                          <span className="cell-subtext truncate-text">
                            {course.description}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className="format-label">
                        {course.type === "youtube"
                          ? "YouTube"
                          : course.type === "link"
                            ? "Lien web"
                            : "Document"}
                      </span>
                    </td>
                    <td className="muted-cell">{targetName}</td>
                    <td>
                      <strong className="report-count">
                        {completed} / {courseAssignments.length}
                      </strong>
                    </td>
                    <td className="muted-cell">
                      {formatDate(course.createdAt)}
                    </td>
                    <td>
                      <div className="table-actions compact-actions">
                        {course.type !== "youtube" && (
                          <button
                            className="icon-button credentials-action"
                            type="button"
                            onClick={() => onCredentials(course)}
                            title="Configurer les identifiants externes"
                            aria-label={`Gérer les identifiants externes de ${course.title}`}
                          >
                            <Icon name="lock" size={17} />
                          </button>
                        )}
                        <a
                          href={course.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="icon-button link-action"
                          title="Ouvrir la ressource"
                          aria-label={`Ouvrir ${course.title}`}
                        >
                          <Icon name="external" size={17} />
                        </a>
                        <button
                          className="icon-button delete-action"
                          type="button"
                          onClick={() => onDelete(course)}
                          title="Supprimer le cours"
                          aria-label={`Supprimer ${course.title}`}
                        >
                          <Icon name="trash" size={17} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {courses.length === 0 && (
            <EmptyState
              icon="courses"
              title="Votre bibliothèque est vide"
              text="Publiez votre premier cours pour le partager avec vos étudiants."
              action={
                <button
                  className="button button-primary"
                  type="button"
                  onClick={onAdd}
                >
                  <Icon name="plus" size={18} />
                  Publier un cours
                </button>
              }
            />
          )}
        </div>
      </section>
    </>
  );
}

function AdminTracking({
  assignments,
  query,
  setQuery,
  filter,
  setFilter,
  onInspect,
  onShare,
}: {
  assignments: Assignment[];
  query: string;
  setQuery: (value: string) => void;
  filter: "all" | ProgressStatus;
  setFilter: (value: "all" | ProgressStatus) => void;
  onInspect: (studentId: string, courseId: string) => void;
  onShare: (student: Student, course: Course) => void;
}) {
  const filtered = assignments.filter(
    ({ student, course, progress }) =>
      `${student.name} ${course.title}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (filter === "all" || progress.status === filter),
  );
  return (
    <>
      <PageHeading
        eyebrow="SUPERVISION PÉDAGOGIQUE"
        title="Suivi & rapports"
        subtitle="Une vue précise du temps investi et des preuves de progression."
      />
      <section className="surface management-panel">
        <div className="panel-heading management-heading">
          <div>
            <span className="panel-kicker">TOUTES LES AFFECTATIONS</span>
            <h2>
              Tableau de suivi{" "}
              <span className="heading-count">{assignments.length}</span>
            </h2>
          </div>
          <div className="toolbar">
            <div className="search-field">
              <Icon name="search" size={18} />
              <input
                aria-label="Rechercher dans le suivi"
                placeholder="Rechercher un nom ou un cours..."
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <select
              aria-label="Filtrer les rapports"
              value={filter}
              onChange={(event) =>
                setFilter(event.target.value as "all" | ProgressStatus)
              }
            >
              <option value="all">Tous les statuts</option>
              <option value="not_started">Non commencés</option>
              <option value="in_progress">En cours</option>
              <option value="submitted">Rapports transmis</option>
            </select>
          </div>
        </div>
        <div className="table-scroll">
          <table className="data-table management-table tracking-table">
            <thead>
              <tr>
                <th>ÉTUDIANT</th>
                <th>COURS ATTRIBUÉ</th>
                <th>TEMPS D'ÉTUDE</th>
                <th>STATUT</th>
                <th>RAPPORT</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(({ student, course, progress }) => (
                <tr key={`${student.id}-${course.id}`}>
                  <td>
                    <div className="person-cell">
                      <Avatar name={student.name} small />
                      <strong>{student.name}</strong>
                    </div>
                  </td>
                  <td>
                    <div className="tracking-course">
                      <strong>{course.title}</strong>
                      <span>
                        {course.type === "youtube"
                          ? "Vidéo YouTube"
                          : course.type === "link"
                            ? "Ressource web"
                            : "Document"}
                      </span>
                    </div>
                  </td>
                  <td className="table-time">
                    {formatDuration(progress.hours, progress.minutes)}
                  </td>
                  <td>
                    <StatusBadge status={progress.status} />
                  </td>
                  <td>
                    {progress.status === "submitted" ? (
                      <div className="pending-actions">
                        <button
                          className={`button button-table button-view ${progress.reviewedAt ? "" : "button-view-new"}`}
                          type="button"
                          onClick={() => onInspect(student.id, course.id)}
                        >
                          <Icon name="eye" size={16} />
                          {progress.reviewedAt ? "Revoir" : "Inspecter"}
                        </button>
                        {progress.reviewedAt ? (
                          <span className="reviewed-text">
                            <Icon name="check" size={12} />
                            Inspecté
                          </span>
                        ) : (
                          <span className="new-report-text">Nouveau</span>
                        )}
                      </div>
                    ) : (
                      <div className="pending-actions">
                        <span className="awaiting-text">En attente</span>
                        <button
                          className="icon-button share-action"
                          type="button"
                          onClick={() => onShare(student, course)}
                          title="Notifier ce cours par WhatsApp (lien de l'espace étudiant uniquement)"
                          aria-label={`Notifier le cours ${course.title} à ${student.name}`}
                        >
                          <Icon name="send" size={15} />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <EmptyState
              icon="tracking"
              title="Aucun résultat"
              text={
                assignments.length
                  ? "Ajustez votre recherche ou votre filtre."
                  : "Les affectations apparaîtront ici dès qu'un cours sera publié."
              }
            />
          )}
        </div>
      </section>
    </>
  );
}

function StudentHome({
  student,
  assignments,
  onOpen,
  weeklyBanner,
}: {
  student: Student;
  assignments: Assignment[];
  onOpen: (courseId: string) => void;
  weeklyBanner?: ReactNode;
}) {
  const done = assignments.filter(
    (item) => item.progress.status === "submitted",
  ).length;
  const rate = assignments.length
    ? Math.round((done / assignments.length) * 100)
    : 0;
  const firstName = student.name.split(" ")[0];
  return (
    <>
      <PageHeading
        eyebrow="VOTRE ESPACE D'APPRENTISSAGE"
        title={`Bonjour, ${firstName}`}
        subtitle="Chaque cours est une étape de plus vers votre avenir professionnel."
        action={
          <div className="identity-chips" data-tour="student-identity">
            <span className="identity-chip">
              <Icon name="calendar" size={14} />
              {cohortLabel(student.cohort)}
            </span>
            <span className="identity-chip identity-registration">
              <Icon name="target" size={14} />
              {student.registration}
            </span>
          </div>
        }
      />
      <section className="student-progress-hero">
        <div className="student-hero-pattern" aria-hidden="true" />
        <div className="student-hero-copy">
          <span>VOTRE PARCOURS</span>
          <h2>Continuez sur votre lancée.</h2>
          <p>Votre progression se construit une séance après l'autre.</p>
        </div>
        <div className="student-hero-meter">
          <strong>{rate}%</strong>
          <span>de votre parcours terminé</span>
          <div className="hero-progress-track">
            <i style={{ width: `${rate}%` }} />
          </div>
          <small>
            {done} cours terminés sur {assignments.length}
          </small>
        </div>
      </section>
      {weeklyBanner}
      <NextActionCard assignments={assignments} onOpen={onOpen} />
      <section
        className="surface student-list-panel"
        data-tour="student-courses"
      >
        <div className="panel-heading">
          <div>
            <span className="panel-kicker">RESSOURCES ASSIGNÉES</span>
            <h2>
              Mes cours{" "}
              <span className="heading-count">{assignments.length}</span>
            </h2>
            <p>
              Sélectionnez un cours pour apprendre et transmettre votre rapport.
            </p>
          </div>
        </div>
        <div className="student-course-list">
          {assignments.map(({ course, progress }, index) => (
            <button
              className="student-course-row"
              key={course.id}
              type="button"
              onClick={() => onOpen(course.id)}
            >
              <span className="course-index">
                {String(index + 1).padStart(2, "0")}
              </span>
              <ResourceIcon type={course.type} size={22} />
              <span className="student-course-info">
                <strong>{course.title}</strong>
                <span>
                  {course.type === "youtube"
                    ? "Vidéo YouTube"
                    : course.type === "link"
                      ? "Ressource en ligne"
                      : "Document téléchargeable"}{" "}
                  <i /> {formatDuration(progress.hours, progress.minutes)}{" "}
                  d'étude
                </span>
              </span>
              <StatusBadge status={progress.status} studentLabel />
              <span className="course-row-arrow">
                <Icon name="arrowRight" size={18} />
              </span>
            </button>
          ))}
          {assignments.length === 0 && (
            <EmptyState
              icon="courses"
              title="Aucun cours assigné"
              text="Votre formateur publiera bientôt vos premières ressources."
            />
          )}
        </div>
      </section>
    </>
  );
}

function StudentProgress({
  assignments,
  onOpen,
}: {
  assignments: Assignment[];
  onOpen: (courseId: string) => void;
}) {
  const done = assignments.filter(
    (item) => item.progress.status === "submitted",
  ).length;
  const minutes = assignments.reduce(
    (sum, item) => sum + item.progress.hours * 60 + item.progress.minutes,
    0,
  );
  return (
    <>
      <PageHeading
        eyebrow="MON ÉVOLUTION"
        title="Mon parcours"
        subtitle="Retrouvez vos efforts, vos comptes-rendus et votre progression."
      />
      <div className="student-summary">
        <div>
          <span>COURS TERMINÉS</span>
          <strong>
            {String(done).padStart(2, "0")}{" "}
            <small>/ {String(assignments.length).padStart(2, "0")}</small>
          </strong>
        </div>
        <div>
          <span>TEMPS D'ÉTUDE DÉCLARÉ</span>
          <strong>
            {formatDuration(Math.floor(minutes / 60), minutes % 60)}
          </strong>
        </div>
        <div>
          <span>PROCHAINE ÉTAPE</span>
          <strong className="summary-text">
            {done === assignments.length && assignments.length
              ? "Parcours à jour"
              : "Poursuivre l'apprentissage"}
          </strong>
        </div>
      </div>
      <section className="surface management-panel">
        <div className="panel-heading">
          <div>
            <span className="panel-kicker">HISTORIQUE DES COURS</span>
            <h2>Votre progression, cours par cours</h2>
          </div>
        </div>
        <div className="table-scroll">
          <table className="data-table management-table">
            <thead>
              <tr>
                <th>COURS</th>
                <th>TEMPS CONSACRÉ</th>
                <th>STATUT</th>
                <th>DERNIÈRE TRANSMISSION</th>
                <th aria-label="Action" />
              </tr>
            </thead>
            <tbody>
              {assignments.map(({ course, progress }) => (
                <tr key={course.id}>
                  <td>
                    <div className="course-cell">
                      <ResourceIcon type={course.type} />
                      <strong>{course.title}</strong>
                    </div>
                  </td>
                  <td className="table-time">
                    {formatDuration(progress.hours, progress.minutes)}
                  </td>
                  <td>
                    <StatusBadge status={progress.status} studentLabel />
                  </td>
                  <td className="muted-cell">
                    {progress.submittedAt
                      ? formatDate(progress.submittedAt)
                      : "—"}
                  </td>
                  <td>
                    <button
                      className="row-arrow"
                      type="button"
                      onClick={() => onOpen(course.id)}
                      aria-label={`Ouvrir ${course.title}`}
                    >
                      <Icon name="arrowRight" size={17} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {assignments.length === 0 && (
            <EmptyState
              icon="tracking"
              title="Votre parcours commencera bientôt"
              text="Les cours qui vous sont assignés apparaîtront ici."
            />
          )}
        </div>
      </section>
    </>
  );
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("Lecture du fichier impossible."));
    reader.onerror = () => reject(new Error("Lecture du fichier impossible."));
    reader.readAsDataURL(file);
  });
}

function StudentExternalAccess({
  credentials,
  onNotify,
}: {
  credentials: ExternalCredentials;
  onNotify: (message: string, kind?: Toast["kind"]) => void;
}) {
  const [showPassword, setShowPassword] = useState(false);

  async function copy(value: string, label: string) {
    if (await copyToClipboard(value)) {
      onNotify(`${label} copié dans le presse-papiers.`);
    } else {
      onNotify(
        "Copie impossible. Vérifiez les permissions du navigateur.",
        "error",
      );
    }
  }

  return (
    <div className="external-access">
      <div className="external-access-heading">
        <div>
          <span className="panel-kicker">
            ACCÈS FOURNIS PAR VOTRE FORMATEUR
          </span>
          <h3>Connexion à la plateforme externe</h3>
        </div>
        <Icon name="lock" size={18} />
      </div>
      <p>
        Ces accès servent uniquement au site du cours, pas à votre compte JZ
        KALYPHOR. Copiez-les pour vous y connecter.
      </p>
      <div className="credential-row">
        <span className="credential-label">E-mail / nom</span>
        <span className="credential-value">{credentials.username}</span>
        <button
          className="credential-copy"
          type="button"
          aria-label="Copier l'e-mail ou le nom d'utilisateur de la plateforme externe"
          onClick={() =>
            void copy(credentials.username, "E-mail ou nom d'utilisateur")
          }
        >
          <Icon name="copy" size={15} />
          Copier
        </button>
      </div>
      <div className="credential-row">
        <span className="credential-label">Mot de passe</span>
        <span className="credential-value credential-secret">
          {showPassword ? credentials.password : "••••••••••••"}
        </span>
        <button
          className="icon-button credential-visibility"
          type="button"
          aria-label={
            showPassword
              ? "Masquer le mot de passe externe"
              : "Afficher le mot de passe externe"
          }
          onClick={() => setShowPassword((current) => !current)}
        >
          <Icon name={showPassword ? "eyeOff" : "eye"} size={17} />
        </button>
        <button
          className="credential-copy"
          type="button"
          aria-label="Copier le mot de passe de la plateforme externe"
          onClick={() => void copy(credentials.password, "Mot de passe")}
        >
          <Icon name="copy" size={15} />
          Copier
        </button>
      </div>
      <p className="credentials-privacy-note">
        <Icon name="shield" size={13} />
        Ces accès vous sont strictement personnels. Ne les partagez pas.
      </p>
    </div>
  );
}

function StudentCourse({
  course,
  progress,
  studentId,
  onBack,
  onUpdate,
  onSubmit,
  onNotify,
  dataSize,
}: {
  course: Course;
  progress: Progress;
  studentId: string;
  onBack: () => void;
  onUpdate: (
    studentId: string,
    courseId: string,
    updater: (progress: Progress) => Progress,
  ) => void;
  onSubmit: () => void;
  onNotify: (message: string, kind?: Toast["kind"]) => void;
  dataSize: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [now, setNow] = useState(Date.now());
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<Proof | null>(null);
  const youtubeId = course.type === "youtube" ? getYouTubeId(course.url) : null;
  const elapsed =
    progress.timerSeconds +
    (progress.timerStartedAt
      ? Math.max(0, Math.floor((now - progress.timerStartedAt) / 1000))
      : 0);

  useEffect(() => {
    if (!progress.timerStartedAt) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [progress.timerStartedAt]);

  function update(changes: Partial<Progress>) {
    onUpdate(studentId, course.id, (current) => ({
      ...current,
      ...changes,
      status: current.status === "submitted" ? "submitted" : "in_progress",
    }));
  }

  function toggleTimer() {
    if (progress.timerStartedAt) {
      const seconds = Math.max(
        0,
        Math.floor((Date.now() - progress.timerStartedAt) / 1000),
      );
      onUpdate(studentId, course.id, (current) => ({
        ...current,
        timerSeconds: current.timerSeconds + seconds,
        timerStartedAt: undefined,
      }));
      onNotify("Chronomètre mis en pause.", "info");
    } else {
      setNow(Date.now());
      update({ timerStartedAt: Date.now() });
      onNotify("Chronomètre lancé. Bonne séance !", "info");
    }
  }

  function addTimer() {
    if (elapsed < 1) return;
    const addedMinutes = Math.ceil(elapsed / 60);
    onUpdate(studentId, course.id, (current) => {
      const total = current.hours * 60 + current.minutes + addedMinutes;
      return {
        ...current,
        hours: Math.floor(total / 60),
        minutes: total % 60,
        timerSeconds: 0,
        timerStartedAt: undefined,
        status: current.status === "submitted" ? "submitted" : "in_progress",
      };
    });
    onNotify(
      `${addedMinutes} min ajoutée${addedMinutes > 1 ? "s" : ""} au temps déclaré.`,
      "success",
    );
  }

  async function addFiles(files: File[]) {
    if (!files.length) return;
    const allowed = [
      "image/png",
      "image/jpeg",
      "image/webp",
      "application/pdf",
    ];
    if (files.some((file) => !allowed.includes(file.type))) {
      onNotify("Formats acceptés : PNG, JPG, WEBP ou PDF.", "error");
      return;
    }
    if (files.some((file) => file.size > 2 * 1024 * 1024)) {
      onNotify("Chaque fichier doit peser moins de 2 Mo.", "error");
      return;
    }
    if (
      progress.proofs.length + files.length > 5 ||
      progress.proofs.reduce((sum, file) => sum + file.size, 0) +
        files.reduce((sum, file) => sum + file.size, 0) >
        3 * 1024 * 1024
    ) {
      onNotify("Limite de 5 fichiers et 3 Mo par rapport.", "error");
      return;
    }
    setUploading(true);
    try {
      const proofs = await Promise.all(
        files.map(async (file) => ({
          id: makeId(),
          name: file.name,
          type: file.type,
          size: file.size,
          dataUrl: await readFileAsDataUrl(file),
        })),
      );
      if (
        dataSize + proofs.reduce((sum, file) => sum + file.dataUrl.length, 0) >
        4_500_000
      ) {
        onNotify(
          "Stockage local presque plein. Utilisez des fichiers plus légers.",
          "error",
        );
        return;
      }
      onUpdate(studentId, course.id, (current) => ({
        ...current,
        proofs: [...current.proofs, ...proofs],
        status: current.status === "submitted" ? "submitted" : "in_progress",
      }));
      onNotify(
        `${proofs.length} preuve${proofs.length > 1 ? "s" : ""} ajoutée${proofs.length > 1 ? "s" : ""} et enregistrée${proofs.length > 1 ? "s" : ""}.`,
        "success",
      );
    } catch {
      onNotify("Impossible de lire le fichier. Réessayez.", "error");
    } finally {
      setUploading(false);
    }
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    void addFiles(files);
  }

  function removeProof(proofId: string) {
    onUpdate(studentId, course.id, (current) => ({
      ...current,
      proofs: current.proofs.filter((file) => file.id !== proofId),
      status:
        current.status === "submitted" && current.proofs.length === 1
          ? "in_progress"
          : current.status,
      submittedAt:
        current.status === "submitted" && current.proofs.length === 1
          ? undefined
          : current.submittedAt,
    }));
    onNotify("Preuve supprimée.", "info");
  }

  function markResourceOpened() {
    if (progress.resourceOpenedAt) return;
    update({ resourceOpenedAt: new Date().toISOString() });
  }

  // Parcours guidé : chaque étape se valide automatiquement.
  const declaredMinutes =
    progress.hours * 60 +
    progress.minutes +
    (elapsed ? Math.ceil(elapsed / 60) : 0);
  const steps = [
    {
      id: "resource",
      label: "Consulter la ressource",
      done:
        !!progress.resourceOpenedAt ||
        declaredMinutes > 0 ||
        progress.status === "submitted",
    },
    { id: "time", label: "Déclarer le temps", done: declaredMinutes >= 1 },
    {
      id: "report",
      label: "Rédiger le compte-rendu",
      done: progress.report.trim().length >= 20,
    },
    {
      id: "proofs",
      label: "Joindre une preuve",
      done: progress.proofs.length > 0,
    },
  ];
  const stepsDone = steps.filter((step) => step.done).length;
  const missing = steps.filter((step) => !step.done);
  const readyToSubmit = missing.every((step) => step.id === "resource");

  return (
    <>
      <button className="back-link" type="button" onClick={onBack}>
        <Icon name="arrowLeft" size={17} />
        Retour à mes cours
      </button>
      <div className="course-detail-heading">
        <div>
          <span className="section-eyebrow">VOTRE ESPACE DE COURS</span>
          <h1>{course.title}</h1>
          <p>{course.description}</p>
        </div>
        <StatusBadge status={progress.status} studentLabel />
      </div>
      <div className="course-detail-grid">
        <div className="course-main-column">
          <section
            className="surface resource-panel"
            data-tour="course-resource"
          >
            <div className="resource-panel-heading">
              <div>
                <span className="panel-kicker">RESSOURCE PÉDAGOGIQUE</span>
                <h2>
                  {course.type === "youtube"
                    ? "Regarder la vidéo"
                    : course.type === "link"
                      ? "Consulter la ressource"
                      : "Consulter le document"}
                </h2>
              </div>
              <span className="resource-type-tag">
                <Icon
                  name={
                    course.type === "youtube"
                      ? "video"
                      : course.type === "link"
                        ? "link"
                        : "file"
                  }
                  size={15}
                />
                {course.type === "youtube"
                  ? "VIDÉO"
                  : course.type === "link"
                    ? "LIEN WEB"
                    : "DOCUMENT"}
              </span>
            </div>
            {youtubeId ? (
              <div className="video-frame">
                <iframe
                  title={`Vidéo : ${course.title}`}
                  src={`https://www.youtube-nocookie.com/embed/${youtubeId}`}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  referrerPolicy="strict-origin-when-cross-origin"
                  allowFullScreen
                />
              </div>
            ) : (
              <div className="external-resource">
                <span className="external-orbit orbit-one" />
                <span className="external-orbit orbit-two" />
                <span className="external-resource-icon">
                  <Icon
                    name={course.type === "document" ? "file" : "link"}
                    size={39}
                    strokeWidth={1.4}
                  />
                </span>
                <h3>
                  {course.type === "document"
                    ? "Votre document est prêt"
                    : "Votre ressource est prête"}
                </h3>
                <p>
                  {course.type === "document"
                    ? "Ouvrez ou téléchargez le support dans un nouvel onglet pour commencer votre étude."
                    : "Accédez au contenu dans un nouvel onglet, puis revenez ici pour transmettre votre travail."}
                </p>
                <a
                  className="button button-gold"
                  href={course.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={markResourceOpened}
                >
                  {course.type === "document"
                    ? "Ouvrir le document"
                    : "Accéder à la ressource"}
                  <Icon name="external" size={17} />
                </a>
              </div>
            )}
            {course.externalCredentials?.[studentId] && (
              <StudentExternalAccess
                credentials={course.externalCredentials[studentId]}
                onNotify={onNotify}
              />
            )}
            <div className="resource-footer">
              <Icon name="shield" size={17} />
              <span>
                Votre progression et vos documents sont enregistrés
                automatiquement sur cet appareil.
              </span>
            </div>
          </section>
        </div>
        <div className="course-work-column">
          <section className="surface work-panel">
            <div className="work-panel-title">
              <span className="panel-kicker">VOTRE TRAVAIL</span>
              <h2>Suivi de séance</h2>
              <p>
                {progress.status === "submitted"
                  ? "Rapport transmis. Vous pouvez encore le compléter et le mettre à jour."
                  : missing.length
                    ? `Prochaine étape : ${missing[0].label.toLowerCase()}.`
                    : "Tout est prêt : envoyez votre rapport à votre formateur."}
              </p>
            </div>
            <ol
              className="course-steps"
              data-tour="course-steps"
              aria-label="Progression du cours"
            >
              {steps.map((step, position) => (
                <li
                  key={step.id}
                  className={`course-step ${step.done ? "step-done" : ""} ${!step.done && missing[0]?.id === step.id ? "step-current" : ""}`}
                >
                  <span className="course-step-mark">
                    {step.done ? <Icon name="check" size={12} /> : position + 1}
                  </span>
                  <span className="course-step-label">{step.label}</span>
                </li>
              ))}
            </ol>
            <div className="course-steps-meter" aria-hidden="true">
              <i style={{ width: `${(stepsDone / steps.length) * 100}%` }} />
            </div>
            <div className="work-divider" />
            <div className="form-section-heading">
              <span
                className={`form-step ${steps[1].done ? "form-step-done" : ""}`}
              >
                {steps[1].done ? <Icon name="check" size={12} /> : "01"}
              </span>
              <h3>Temps d'étude</h3>
            </div>
            <div className="timer-box" data-tour="course-timer">
              <span>CHRONOMÈTRE DE SÉANCE</span>
              <strong className="timer-display">{formatClock(elapsed)}</strong>
              <div className="timer-actions">
                <button
                  type="button"
                  className="timer-toggle"
                  onClick={toggleTimer}
                >
                  <Icon
                    name={progress.timerStartedAt ? "pause" : "play"}
                    size={16}
                  />
                  {progress.timerStartedAt
                    ? "Mettre en pause"
                    : "Démarrer le chrono"}
                </button>
                <button
                  type="button"
                  className="timer-add"
                  disabled={elapsed < 1}
                  onClick={addTimer}
                >
                  Ajouter au temps
                </button>
              </div>
            </div>
            <div className="time-fields">
              <label>
                Heures
                <input
                  type="number"
                  min="0"
                  max="999"
                  inputMode="numeric"
                  value={progress.hours}
                  onChange={(event) =>
                    update({
                      hours: Math.max(
                        0,
                        Math.min(999, Number(event.target.value) || 0),
                      ),
                    })
                  }
                />
              </label>
              <label>
                Minutes
                <input
                  type="number"
                  min="0"
                  max="59"
                  inputMode="numeric"
                  value={progress.minutes}
                  onChange={(event) =>
                    update({
                      minutes: Math.max(
                        0,
                        Math.min(59, Number(event.target.value) || 0),
                      ),
                    })
                  }
                />
              </label>
            </div>
            <p className="field-hint">
              Vous pouvez aussi saisir manuellement votre temps réel d'étude.
            </p>
            <div className="work-divider" />
            <div className="form-section-heading">
              <span
                className={`form-step ${steps[2].done ? "form-step-done" : ""}`}
              >
                {steps[2].done ? <Icon name="check" size={12} /> : "02"}
              </span>
              <h3>Compte-rendu</h3>
            </div>
            <label className="sr-only" htmlFor="report-text">
              Votre compte-rendu de séance
            </label>
            <textarea
              id="report-text"
              data-tour="course-report"
              className="report-textarea"
              value={progress.report}
              onChange={(event) => update({ report: event.target.value })}
              placeholder="Qu'avez-vous appris ? Quelles idées allez-vous mettre en pratique ?"
              rows={5}
            />
            <span
              className={`char-count ${steps[2].done ? "char-count-ok" : ""}`}
            >
              {progress.report.trim().length < 20
                ? `${progress.report.trim().length} / 20 caractères minimum`
                : `${progress.report.length} caractères`}
            </span>
            <div className="work-divider" />
            <div className="form-section-heading">
              <span
                className={`form-step ${steps[3].done ? "form-step-done" : ""}`}
              >
                {steps[3].done ? <Icon name="check" size={12} /> : "03"}
              </span>
              <h3>Preuves de visionnage</h3>
            </div>
            <input
              ref={inputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,application/pdf"
              multiple
              className="sr-only"
              onChange={handleFileChange}
              aria-label="Ajouter des preuves"
            />
            <button
              type="button"
              className="upload-zone"
              data-tour="course-proofs"
              disabled={uploading}
              onClick={() => inputRef.current?.click()}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                void addFiles(Array.from(event.dataTransfer.files));
              }}
            >
              <span className="upload-icon">
                <Icon name="upload" size={21} />
              </span>
              <strong>
                {uploading
                  ? "Importation en cours..."
                  : "Ajouter vos captures ou PDF"}
              </strong>
              <span>Cliquer ou glisser-déposer · PNG, JPG, WEBP, PDF</span>
              <small>5 fichiers maximum · 2 Mo par fichier</small>
            </button>
            {progress.proofs.length > 0 && (
              <div className="proof-list">
                {progress.proofs.map((proof) => (
                  <div className="proof-item" key={proof.id}>
                    <button
                      type="button"
                      className="proof-preview"
                      onClick={() => setPreview(proof)}
                      aria-label={`Prévisualiser ${proof.name}`}
                    >
                      {proof.type.startsWith("image/") ? (
                        <img src={proof.dataUrl} alt="Aperçu de la preuve" />
                      ) : (
                        <Icon name="file" size={20} />
                      )}
                    </button>
                    <div>
                      <strong title={proof.name}>{proof.name}</strong>
                      <span>
                        {Math.max(1, Math.round(proof.size / 1024))} Ko ·
                        enregistré
                      </span>
                    </div>
                    <button
                      type="button"
                      className="icon-button proof-remove"
                      onClick={() => removeProof(proof.id)}
                      aria-label={`Supprimer ${proof.name}`}
                    >
                      <Icon name="close" size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div data-tour="course-submit">
              <button
                type="button"
                className={`button button-primary submit-report ${readyToSubmit ? "" : "submit-incomplete"}`}
                onClick={onSubmit}
                aria-describedby="submit-hint"
              >
                <Icon name="send" size={18} />
                {progress.status === "submitted"
                  ? "Mettre à jour mon rapport"
                  : "Envoyer mon rapport"}
              </button>
              <p className="submit-note" id="submit-hint">
                <Icon name={readyToSubmit ? "lock" : "alert"} size={13} />
                {readyToSubmit
                  ? "Transmission officielle à votre formateur"
                  : `Il reste à : ${missing
                      .filter((step) => step.id !== "resource")
                      .map((step) => step.label.toLowerCase())
                      .join(", ")}.`}
              </p>
            </div>
          </section>
        </div>
      </div>
      {preview && (
        <ModalShell
          title="Aperçu de la preuve"
          onClose={() => setPreview(null)}
          wide
        >
          <div className="proof-modal-body">
            <div className="proof-modal-preview">
              <ProofPreviewMedia proof={preview} />
            </div>
            <div className="proof-modal-bottom">
              <span>{preview.name}</span>
              <a
                className="button button-secondary"
                href={preview.dataUrl}
                download={preview.name}
              >
                <Icon name="download" size={17} />
                Télécharger
              </a>
            </div>
          </div>
        </ModalShell>
      )}
    </>
  );
}

/* ---------- Bilans hebdomadaires ---------- */

const WEEKLY_LABELS: Record<WeeklyStatus, string> = {
  pending: "À rendre",
  on_time: "Rendu à temps",
  late: "Rendu en retard",
  missing: "Non rendu",
};

function WeeklyStatusBadge({ status }: { status: WeeklyStatus }) {
  return (
    <span className={`weekly-badge weekly-${status}`}>
      <span className="status-dot" />
      {WEEKLY_LABELS[status]}
    </span>
  );
}

/** Lecture et contrôle des pièces jointes (images ou PDF, 2 Mo max). */
async function readProofFiles(
  files: File[],
  existing: Proof[],
  maxFiles: number,
): Promise<{ proofs?: Proof[]; error?: string }> {
  const allowed = ["image/png", "image/jpeg", "image/webp", "application/pdf"];
  if (files.some((file) => !allowed.includes(file.type)))
    return { error: "Formats acceptés : PNG, JPG, WEBP ou PDF." };
  if (files.some((file) => file.size > 2 * 1024 * 1024))
    return { error: "Chaque fichier doit peser moins de 2 Mo." };
  if (existing.length + files.length > maxFiles)
    return { error: `${maxFiles} fichiers maximum.` };
  try {
    const proofs = await Promise.all(
      files.map(async (file) => ({
        id: makeId(),
        name: file.name,
        type: file.type,
        size: file.size,
        dataUrl: await readFileAsDataUrl(file),
      })),
    );
    return { proofs };
  } catch {
    return { error: "Impossible de lire le fichier. Réessayez." };
  }
}

/** Bannière d'échéance de l'accueil étudiant. */
function WeeklyDeadlineBanner({
  report,
  missedCount,
  now,
  onOpen,
}: {
  report: WeeklyReport | undefined;
  missedCount: number;
  now: number;
  onOpen: () => void;
}) {
  const week = weekKeyOf(new Date(now));
  const status = weeklyStatus(report, week, now);
  const remaining = weekDeadline(week).getTime() - now;
  const urgent = status === "pending" && remaining < 24 * 3600000;
  return (
    <section
      className={`weekly-banner ${urgent ? "weekly-banner-urgent" : ""} ${status !== "pending" ? "weekly-banner-done" : ""}`}
      data-tour="student-weekly"
    >
      <span className="weekly-banner-icon">
        <Icon name={status === "pending" ? "clock" : "checkCircle"} size={21} />
      </span>
      <div className="weekly-banner-copy">
        <span className="panel-kicker">
          BILAN HEBDOMADAIRE · {weekLabel(week, false).toUpperCase()}
        </span>
        {status === "pending" ? (
          <>
            <strong>
              À rendre avant le {formatDeadline(week)}
              <span className="weekly-countdown">
                Il reste {formatRemaining(remaining)}
              </span>
            </strong>
            <span>
              {report && (report.summary || report.hours || report.minutes)
                ? "Votre brouillon est enregistré : finalisez-le et transmettez-le à votre formateur."
                : "Résumez votre semaine : temps d'étude, cours travaillés, acquis et objectifs."}
            </span>
          </>
        ) : (
          <>
            <strong>Bilan de la semaine transmis.</strong>
            <span>
              Envoyé le {formatDate(report!.submittedAt!, true)}. Vous pouvez le
              compléter jusqu'au {formatDeadline(week)}.
            </span>
          </>
        )}
        {missedCount > 0 && (
          <span className="weekly-missed">
            <Icon name="alert" size={13} />
            {missedCount} bilan{missedCount > 1 ? "s" : ""} non rendu
            {missedCount > 1 ? "s" : ""} sur les semaines précédentes
          </span>
        )}
      </div>
      <button type="button" className="button button-gold" onClick={onOpen}>
        {status === "pending" ? "Rédiger mon bilan" : "Voir mon bilan"}
        <Icon name="arrowRight" size={17} />
      </button>
    </section>
  );
}

/** Espace étudiant : bilan de la semaine (éditeur guidé) et historique. */
function StudentWeekly({
  student,
  courses,
  reports,
  now,
  onUpdate,
  onSubmit,
  onNotify,
}: {
  student: Student;
  courses: Course[];
  reports: WeeklyReport[];
  now: number;
  onUpdate: (
    weekStart: string,
    updater: (report: WeeklyReport) => WeeklyReport,
  ) => void;
  onSubmit: (weekStart: string) => boolean;
  onNotify: (message: string, kind?: Toast["kind"]) => void;
}) {
  const currentWeek = weekKeyOf(new Date(now));
  const [selectedWeek, setSelectedWeek] = useState(currentWeek);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const weeks = studentWeeks(student, now);
  const report =
    reports.find((item) => item.weekStart === selectedWeek) ||
    emptyWeeklyReport(student.id, selectedWeek);
  const status = weeklyStatus(
    reports.find((item) => item.weekStart === selectedWeek),
    selectedWeek,
    now,
  );
  const deadline = weekDeadline(selectedWeek).getTime();
  const editable = !report.submittedAt || now <= deadline;
  const isCurrent = selectedWeek === currentWeek;

  const steps = [
    {
      id: "time",
      label: "Temps de la semaine",
      done: report.hours * 60 + report.minutes >= 1,
    },
    {
      id: "courses",
      label: "Cours travaillés",
      done: report.courseIds.length > 0,
    },
    {
      id: "summary",
      label: "Compte-rendu",
      done: report.summary.trim().length >= 40,
    },
    {
      id: "goals",
      label: "Objectifs",
      done: report.nextGoals.trim().length >= 15,
    },
  ];
  const missing = steps.filter((step) => !step.done);
  const stepsDone = steps.length - missing.length;

  function update(changes: Partial<WeeklyReport>) {
    onUpdate(selectedWeek, (current) => ({ ...current, ...changes }));
  }

  function toggleCourse(courseId: string) {
    update({
      courseIds: report.courseIds.includes(courseId)
        ? report.courseIds.filter((id) => id !== courseId)
        : [...report.courseIds, courseId],
    });
  }

  async function addFiles(files: File[]) {
    if (!files.length) return;
    setUploading(true);
    const result = await readProofFiles(files, report.proofs, 3);
    setUploading(false);
    if (result.error) {
      onNotify(result.error, "error");
      return;
    }
    onUpdate(selectedWeek, (current) => ({
      ...current,
      proofs: [...current.proofs, ...(result.proofs || [])],
    }));
    onNotify("Pièce jointe ajoutée au bilan.", "success");
  }

  function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    void addFiles(files);
  }

  function selectWeek(week: string) {
    setSelectedWeek(week);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <>
      <PageHeading
        eyebrow="BILAN HEBDOMADAIRE"
        title="Mon bilan de la semaine"
        subtitle="Chaque semaine, rendez compte de votre travail avant le dimanche 23:59."
      />
      <section className={`weekly-hero weekly-hero-${status}`}>
        <div className="weekly-hero-copy">
          <span>
            S{isoWeekNumber(selectedWeek)} ·{" "}
            {isCurrent ? "SEMAINE EN COURS" : "SEMAINE PASSÉE"}
          </span>
          <h2>{weekLabel(selectedWeek)}</h2>
          <p>
            Échéance : {formatDeadline(selectedWeek)}
            {status === "pending" && (
              <>
                {" "}
                · il reste <strong>{formatRemaining(deadline - now)}</strong>
              </>
            )}
          </p>
        </div>
        <div className="weekly-hero-side">
          <WeeklyStatusBadge status={status} />
          {!isCurrent && (
            <button
              type="button"
              className="weekly-back"
              onClick={() => selectWeek(currentWeek)}
            >
              <Icon name="arrowLeft" size={14} />
              Semaine en cours
            </button>
          )}
        </div>
      </section>

      <div className="weekly-layout">
        <section className="surface weekly-editor">
          <div className="work-panel-title">
            <span className="panel-kicker">
              {editable ? "VOTRE BILAN" : "BILAN TRANSMIS"}
            </span>
            <h2>
              {editable
                ? status === "missing"
                  ? "Rendre ce bilan en retard"
                  : "Rédiger mon bilan"
                : "Consultation du bilan"}
            </h2>
            <p>
              {!editable
                ? `Transmis le ${formatDate(report.submittedAt!, true)}. L'échéance étant passée, ce bilan n'est plus modifiable.`
                : status === "missing"
                  ? "L'échéance est dépassée : votre bilan sera signalé comme rendu en retard."
                  : missing.length
                    ? `Prochaine étape : ${missing[0].label.toLowerCase()}. Votre brouillon est enregistré automatiquement.`
                    : "Tout est prêt : transmettez votre bilan à votre formateur."}
            </p>
          </div>
          {editable && (
            <>
              <ol className="course-steps" aria-label="Progression du bilan">
                {steps.map((step, position) => (
                  <li
                    key={step.id}
                    className={`course-step ${step.done ? "step-done" : ""} ${!step.done && missing[0]?.id === step.id ? "step-current" : ""}`}
                  >
                    <span className="course-step-mark">
                      {step.done ? (
                        <Icon name="check" size={12} />
                      ) : (
                        position + 1
                      )}
                    </span>
                    <span className="course-step-label">{step.label}</span>
                  </li>
                ))}
              </ol>
              <div className="course-steps-meter" aria-hidden="true">
                <i style={{ width: `${(stepsDone / steps.length) * 100}%` }} />
              </div>
            </>
          )}

          <div className="work-divider" />
          <div className="form-section-heading">
            <span
              className={`form-step ${steps[0].done ? "form-step-done" : ""}`}
            >
              {steps[0].done ? <Icon name="check" size={12} /> : "01"}
            </span>
            <h3>Temps d'étude de la semaine</h3>
          </div>
          <div className="time-fields weekly-time">
            <label>
              Heures
              <input
                type="number"
                min="0"
                max="168"
                inputMode="numeric"
                disabled={!editable}
                value={report.hours}
                onChange={(event) =>
                  update({
                    hours: Math.max(
                      0,
                      Math.min(168, Number(event.target.value) || 0),
                    ),
                  })
                }
              />
            </label>
            <label>
              Minutes
              <input
                type="number"
                min="0"
                max="59"
                inputMode="numeric"
                disabled={!editable}
                value={report.minutes}
                onChange={(event) =>
                  update({
                    minutes: Math.max(
                      0,
                      Math.min(59, Number(event.target.value) || 0),
                    ),
                  })
                }
              />
            </label>
          </div>

          <div className="work-divider" />
          <div className="form-section-heading">
            <span
              className={`form-step ${steps[1].done ? "form-step-done" : ""}`}
            >
              {steps[1].done ? <Icon name="check" size={12} /> : "02"}
            </span>
            <h3>Cours travaillés cette semaine</h3>
          </div>
          {courses.length ? (
            <div
              className="weekly-courses"
              role="group"
              aria-label="Cours travaillés"
            >
              {courses.map((course) => {
                const selected = report.courseIds.includes(course.id);
                return (
                  <button
                    key={course.id}
                    type="button"
                    disabled={!editable}
                    aria-pressed={selected}
                    className={`weekly-course ${selected ? "weekly-course-on" : ""}`}
                    onClick={() => toggleCourse(course.id)}
                  >
                    <span className="weekly-course-check">
                      {selected && <Icon name="check" size={12} />}
                    </span>
                    {course.title}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="field-hint">
              Aucun cours ne vous est encore attribué.
            </p>
          )}

          <div className="work-divider" />
          <div className="form-section-heading">
            <span
              className={`form-step ${steps[2].done ? "form-step-done" : ""}`}
            >
              {steps[2].done ? <Icon name="check" size={12} /> : "03"}
            </span>
            <h3>Compte-rendu de la semaine</h3>
          </div>
          <label className="weekly-field">
            Ce que j'ai appris et réalisé
            <textarea
              className="report-textarea"
              rows={5}
              disabled={!editable}
              value={report.summary}
              onChange={(event) => update({ summary: event.target.value })}
              placeholder="Notions étudiées, travaux réalisés, compétences acquises cette semaine..."
            />
            <span
              className={`char-count ${steps[2].done ? "char-count-ok" : ""}`}
            >
              {report.summary.trim().length < 40
                ? `${report.summary.trim().length} / 40 caractères minimum`
                : `${report.summary.length} caractères`}
            </span>
          </label>
          <label className="weekly-field">
            Difficultés rencontrées <small>(facultatif)</small>
            <textarea
              className="report-textarea weekly-textarea-small"
              rows={3}
              disabled={!editable}
              value={report.difficulties}
              onChange={(event) => update({ difficulties: event.target.value })}
              placeholder="Points bloquants, notions à revoir, besoin d'accompagnement..."
            />
          </label>

          <div className="work-divider" />
          <div className="form-section-heading">
            <span
              className={`form-step ${steps[3].done ? "form-step-done" : ""}`}
            >
              {steps[3].done ? <Icon name="check" size={12} /> : "04"}
            </span>
            <h3>Objectifs de la semaine prochaine</h3>
          </div>
          <label className="weekly-field">
            <span className="sr-only">Objectifs de la semaine prochaine</span>
            <textarea
              className="report-textarea weekly-textarea-small"
              rows={3}
              disabled={!editable}
              value={report.nextGoals}
              onChange={(event) => update({ nextGoals: event.target.value })}
              placeholder="Ce que je m'engage à réaliser la semaine prochaine..."
            />
          </label>

          <div className="weekly-attachments">
            <span className="weekly-attachments-title">
              Pièces jointes <small>(facultatif · 3 max)</small>
            </span>
            <input
              ref={fileRef}
              type="file"
              className="sr-only"
              multiple
              accept="image/png,image/jpeg,image/webp,application/pdf"
              onChange={handleFiles}
              aria-label="Ajouter des pièces jointes au bilan"
            />
            {report.proofs.map((proof) => (
              <div className="proof-item" key={proof.id}>
                <span className="proof-preview">
                  {proof.type.startsWith("image/") ? (
                    <img src={proof.dataUrl} alt="Aperçu" />
                  ) : (
                    <Icon name="file" size={18} />
                  )}
                </span>
                <div>
                  <strong title={proof.name}>{proof.name}</strong>
                  <span>{Math.max(1, Math.round(proof.size / 1024))} Ko</span>
                </div>
                {editable && (
                  <button
                    type="button"
                    className="icon-button proof-remove"
                    aria-label={`Retirer ${proof.name}`}
                    onClick={() =>
                      onUpdate(selectedWeek, (current) => ({
                        ...current,
                        proofs: current.proofs.filter(
                          (item) => item.id !== proof.id,
                        ),
                      }))
                    }
                  >
                    <Icon name="close" size={15} />
                  </button>
                )}
              </div>
            ))}
            {editable && report.proofs.length < 3 && (
              <button
                type="button"
                className="weekly-attach-button"
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
              >
                <Icon name="upload" size={15} />
                {uploading ? "Importation..." : "Ajouter une capture ou un PDF"}
              </button>
            )}
          </div>

          {editable && (
            <div className="weekly-submit">
              <button
                type="button"
                className={`button button-primary submit-report ${missing.length ? "submit-incomplete" : ""}`}
                onClick={() => onSubmit(selectedWeek)}
              >
                <Icon name="send" size={18} />
                {report.submittedAt
                  ? "Mettre à jour mon bilan"
                  : status === "missing"
                    ? "Transmettre en retard"
                    : "Transmettre mon bilan"}
              </button>
              <p className="submit-note">
                <Icon name={missing.length ? "alert" : "lock"} size={13} />
                {missing.length
                  ? `Il reste à compléter : ${missing.map((step) => step.label.toLowerCase()).join(", ")}.`
                  : `Transmission officielle à votre formateur · échéance ${formatDeadline(selectedWeek)}`}
              </p>
            </div>
          )}
        </section>

        <aside className="surface weekly-history">
          <div className="panel-heading">
            <div>
              <span className="panel-kicker">HISTORIQUE</span>
              <h2>Mes semaines</h2>
              <p>
                Depuis votre inscription · {weeks.length} semaine
                {weeks.length > 1 ? "s" : ""}
              </p>
            </div>
          </div>
          <ol className="weekly-history-list">
            {weeks.map((week) => {
              const item = reports.find((entry) => entry.weekStart === week);
              const itemStatus = weeklyStatus(item, week, now);
              return (
                <li key={week}>
                  <button
                    type="button"
                    className={`weekly-history-item ${week === selectedWeek ? "weekly-history-active" : ""}`}
                    onClick={() => selectWeek(week)}
                  >
                    <span className="weekly-history-week">
                      S{isoWeekNumber(week)}
                    </span>
                    <span className="weekly-history-copy">
                      <strong>{weekLabel(week, false)}</strong>
                      <span>
                        {item?.submittedAt
                          ? `${formatDuration(item.hours, item.minutes)} · envoyé le ${formatDate(item.submittedAt)}`
                          : itemStatus === "missing"
                            ? "Cliquez pour le rendre en retard"
                            : `Échéance ${formatDeadline(week)}`}
                      </span>
                    </span>
                    <WeeklyStatusBadge status={itemStatus} />
                  </button>
                </li>
              );
            })}
          </ol>
        </aside>
      </div>
    </>
  );
}

/** Espace formateur : suivi des bilans semaine par semaine. */
function AdminWeekly({
  students,
  reports,
  now,
  onInspect,
  onRemind,
}: {
  students: Student[];
  reports: WeeklyReport[];
  now: number;
  onInspect: (reportId: string) => void;
  onRemind: (student: Student, weekStart: string) => void;
}) {
  const currentWeek = weekKeyOf(new Date(now));
  const [week, setWeek] = useState(currentWeek);
  const [cohort, setCohort] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"all" | WeeklyStatus>("all");
  const earliest = students.reduce((min, student) => {
    const key = weekKeyOf(new Date(student.createdAt));
    return key < min ? key : min;
  }, currentWeek);
  const weeks: string[] = [];
  for (
    let key = currentWeek;
    key >= earliest && weeks.length < 104;
    key = addWeeks(key, -1)
  )
    weeks.push(key);
  const deadline = weekDeadline(week).getTime();
  const rows = students
    .filter((student) => new Date(student.createdAt).getTime() <= deadline)
    .filter((student) => cohort === "all" || student.cohort === cohort)
    .map((student) => {
      const report = reports.find(
        (item) => item.studentId === student.id && item.weekStart === week,
      );
      return { student, report, status: weeklyStatus(report, week, now) };
    })
    .sort((a, b) => a.student.name.localeCompare(b.student.name, "fr"));
  const counts = {
    on_time: rows.filter((row) => row.status === "on_time").length,
    late: rows.filter((row) => row.status === "late").length,
    pending: rows.filter((row) => row.status === "pending").length,
    missing: rows.filter((row) => row.status === "missing").length,
  };
  const visible = rows.filter(
    (row) => statusFilter === "all" || row.status === statusFilter,
  );
  const isCurrent = week === currentWeek;

  return (
    <>
      <PageHeading
        eyebrow="SUIVI HEBDOMADAIRE"
        title="Bilans hebdomadaires"
        subtitle="Chaque étudiant rend son bilan avant le dimanche 23:59. Suivez la régularité semaine par semaine."
      />
      <section className="surface weekly-admin-head">
        <div className="weekly-admin-week">
          <button
            type="button"
            className="icon-button weekly-nav"
            aria-label="Semaine précédente"
            disabled={week <= earliest}
            onClick={() => setWeek(addWeeks(week, -1))}
          >
            <Icon name="arrowLeft" size={17} />
          </button>
          <div>
            <span className="panel-kicker">
              S{isoWeekNumber(week)} ·{" "}
              {isCurrent ? "SEMAINE EN COURS" : "SEMAINE PASSÉE"}
            </span>
            <select
              aria-label="Choisir la semaine"
              value={week}
              onChange={(event) => setWeek(event.target.value)}
            >
              {weeks.map((key) => (
                <option key={key} value={key}>
                  {weekLabel(key)}
                </option>
              ))}
            </select>
            <p>
              Échéance : {formatDeadline(week)}
              {isCurrent && (
                <>
                  {" "}
                  · reste <strong>{formatRemaining(deadline - now)}</strong>
                </>
              )}
            </p>
          </div>
          <button
            type="button"
            className="icon-button weekly-nav"
            aria-label="Semaine suivante"
            disabled={week >= currentWeek}
            onClick={() => setWeek(addWeeks(week, 1))}
          >
            <Icon name="arrowRight" size={17} />
          </button>
        </div>
        <div className="weekly-stats">
          {(
            [
              "on_time",
              "late",
              isCurrent ? "pending" : "missing",
            ] as WeeklyStatus[]
          ).map((key) => (
            <button
              key={key}
              type="button"
              className={`weekly-stat weekly-stat-${key} ${statusFilter === key ? "weekly-stat-active" : ""}`}
              onClick={() =>
                setStatusFilter(statusFilter === key ? "all" : key)
              }
              aria-pressed={statusFilter === key}
            >
              <strong>{counts[key]}</strong>
              <span>{WEEKLY_LABELS[key]}</span>
            </button>
          ))}
          <div className="weekly-stat weekly-stat-rate">
            <strong>
              {rows.length
                ? Math.round(
                    ((counts.on_time + counts.late) / rows.length) * 100,
                  )
                : 0}
              %
            </strong>
            <span>Taux de remise</span>
          </div>
        </div>
      </section>

      <section className="surface management-panel">
        <div className="panel-heading management-heading">
          <div>
            <span className="panel-kicker">ÉTUDIANTS CONCERNÉS</span>
            <h2>
              {weekLabel(week, false)}{" "}
              <span className="heading-count">{rows.length}</span>
            </h2>
          </div>
          <div className="toolbar">
            <select
              aria-label="Filtrer les bilans par cohorte"
              value={cohort}
              onChange={(event) => setCohort(event.target.value)}
            >
              <option value="all">Toutes les cohortes</option>
              {listCohorts(students).map((item) => (
                <option key={item} value={item}>
                  {cohortLabel(item)}
                </option>
              ))}
            </select>
            <select
              aria-label="Filtrer les bilans par statut"
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(event.target.value as "all" | WeeklyStatus)
              }
            >
              <option value="all">Tous les statuts</option>
              <option value="on_time">Rendus à temps</option>
              <option value="late">Rendus en retard</option>
              <option value="pending">À rendre</option>
              <option value="missing">Non rendus</option>
            </select>
          </div>
        </div>
        <div className="table-scroll">
          <table className="data-table management-table weekly-table">
            <thead>
              <tr>
                <th>ÉTUDIANT</th>
                <th>COHORTE</th>
                <th>TEMPS DÉCLARÉ</th>
                <th>STATUT</th>
                <th>TRANSMIS LE</th>
                <th className="actions-heading">ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(({ student, report, status }) => (
                <tr key={student.id}>
                  <td>
                    <div className="person-cell">
                      <Avatar name={student.name} small />
                      <div>
                        <strong>{student.name}</strong>
                        <span className="cell-subtext">
                          {student.registration}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td className="muted-cell">{cohortLabel(student.cohort)}</td>
                  <td className="table-time">
                    {report?.submittedAt
                      ? formatDuration(report.hours, report.minutes)
                      : "—"}
                  </td>
                  <td>
                    <WeeklyStatusBadge status={status} />
                  </td>
                  <td className="muted-cell">
                    {report?.submittedAt
                      ? new Intl.DateTimeFormat("fr-FR", {
                          weekday: "short",
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        }).format(new Date(report.submittedAt))
                      : "—"}
                  </td>
                  <td>
                    <div className="table-actions">
                      {report?.submittedAt ? (
                        <>
                          {!report.reviewedAt && (
                            <span className="new-report-text">Nouveau</span>
                          )}
                          <button
                            type="button"
                            className={`button button-table button-view ${report.reviewedAt ? "" : "button-view-new"}`}
                            onClick={() => onInspect(report.id)}
                          >
                            <Icon name="eye" size={15} />
                            {report.reviewedAt ? "Revoir" : "Inspecter"}
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="button button-table button-whatsapp"
                          onClick={() => onRemind(student, week)}
                        >
                          <Icon name="send" size={15} />
                          {status === "missing"
                            ? "Relancer (retard)"
                            : "Rappel échéance"}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {visible.length === 0 && (
            <EmptyState
              icon="calendar"
              title="Aucun bilan à afficher"
              text={
                rows.length
                  ? "Aucun étudiant ne correspond à ce filtre pour cette semaine."
                  : "Aucun étudiant n'était inscrit sur cette semaine."
              }
            />
          )}
        </div>
      </section>
    </>
  );
}

/** Bannière hebdomadaire de la vue d'ensemble formateur. */
function AdminWeeklyBanner({
  students,
  reports,
  now,
  onOpen,
}: {
  students: Student[];
  reports: WeeklyReport[];
  now: number;
  onOpen: () => void;
}) {
  const week = weekKeyOf(new Date(now));
  const lastWeek = addWeeks(week, -1);
  const concerned = (key: string) =>
    students.filter(
      (student) =>
        new Date(student.createdAt).getTime() <= weekDeadline(key).getTime(),
    );
  const statusesFor = (key: string) =>
    concerned(key).map((student) =>
      weeklyStatus(
        reports.find(
          (item) => item.studentId === student.id && item.weekStart === key,
        ),
        key,
        now,
      ),
    );
  const current = statusesFor(week);
  const previous = statusesFor(lastWeek);
  const submitted = current.filter(
    (status) => status === "on_time" || status === "late",
  ).length;
  return (
    <section className="weekly-overview" data-tour="weekly-overview">
      <div className="weekly-overview-main">
        <span className="weekly-overview-icon">
          <Icon name="calendar" size={20} />
        </span>
        <div>
          <span className="panel-kicker">
            BILANS HEBDOMADAIRES · S{isoWeekNumber(week)}
          </span>
          <strong>
            {submitted} / {current.length} bilans reçus cette semaine
          </strong>
          <span>
            Échéance {formatDeadline(week)} · reste{" "}
            {formatRemaining(weekDeadline(week).getTime() - now)}
          </span>
        </div>
      </div>
      <div className="weekly-overview-previous">
        <span>Semaine précédente</span>
        <div>
          <em className="weekly-dot-on_time">
            {previous.filter((s) => s === "on_time").length} à temps
          </em>
          <em className="weekly-dot-late">
            {previous.filter((s) => s === "late").length} en retard
          </em>
          <em className="weekly-dot-missing">
            {previous.filter((s) => s === "missing").length} non rendus
          </em>
        </div>
      </div>
      <button
        type="button"
        className="button button-secondary"
        onClick={onOpen}
      >
        Voir les bilans
        <Icon name="arrowRight" size={16} />
      </button>
    </section>
  );
}

function WeeklyInspectModal({
  report,
  student,
  courses,
  onClose,
}: {
  report: WeeklyReport;
  student: Student;
  courses: Course[];
  onClose: () => void;
}) {
  const status = weeklyStatus(report, report.weekStart, Date.now());
  const worked = courses.filter((course) =>
    report.courseIds.includes(course.id),
  );
  return (
    <ModalShell
      title={`Bilan hebdomadaire de ${student.name}`}
      onClose={onClose}
      wide
    >
      <ModalHeader
        eyebrow={`BILAN HEBDOMADAIRE · S${isoWeekNumber(report.weekStart)}`}
        title={weekLabel(report.weekStart)}
        subtitle={`Échéance : ${formatDeadline(report.weekStart)}.`}
      />
      <div className="inspection-meta">
        <div className="person-cell">
          <Avatar name={student.name} />
          <div>
            <strong>{student.name}</strong>
            <span className="cell-subtext">
              {student.registration} · {cohortLabel(student.cohort)}
            </span>
          </div>
        </div>
        <WeeklyStatusBadge status={status} />
      </div>
      <div className="inspection-facts">
        <div>
          <span>TEMPS DÉCLARÉ</span>
          <strong>
            <Icon name="clock" size={18} />
            {formatDuration(report.hours, report.minutes)}
          </strong>
        </div>
        <div>
          <span>TRANSMIS LE</span>
          <strong>
            <Icon name="calendar" size={18} />
            {report.submittedAt
              ? new Intl.DateTimeFormat("fr-FR", {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                  hour: "2-digit",
                  minute: "2-digit",
                }).format(new Date(report.submittedAt))
              : "Non transmis"}
          </strong>
        </div>
      </div>
      <div className="inspection-section">
        <h3>Cours travaillés</h3>
        {worked.length ? (
          <div className="weekly-chips">
            {worked.map((course) => (
              <span key={course.id} className="weekly-chip">
                {course.title}
              </span>
            ))}
          </div>
        ) : (
          <p className="no-proof">Aucun cours indiqué.</p>
        )}
      </div>
      <div className="inspection-section">
        <h3>Compte-rendu de la semaine</h3>
        <div className="report-content">{report.summary || "—"}</div>
      </div>
      <div className="inspection-section">
        <h3>Difficultés rencontrées</h3>
        <div className="report-content">
          {report.difficulties || "Aucune difficulté signalée."}
        </div>
      </div>
      <div className="inspection-section">
        <h3>Objectifs de la semaine prochaine</h3>
        <div className="report-content">{report.nextGoals || "—"}</div>
      </div>
      {report.proofs.length > 0 && (
        <div className="inspection-section">
          <h3>
            Pièces jointes <span>({report.proofs.length})</span>
          </h3>
          <div className="inspection-proofs">
            {report.proofs.map((proof) => (
              <div className="inspection-proof" key={proof.id}>
                <span className="inspection-thumb">
                  {proof.type.startsWith("image/") ? (
                    <img src={proof.dataUrl} alt={proof.name} />
                  ) : (
                    <Icon name="file" size={24} />
                  )}
                </span>
                <div>
                  <strong title={proof.name}>{proof.name}</strong>
                  <span>{Math.max(1, Math.round(proof.size / 1024))} Ko</span>
                </div>
                <div className="inspection-proof-actions">
                  <a
                    className="icon-button"
                    href={proof.dataUrl}
                    download={proof.name}
                    aria-label={`Télécharger ${proof.name}`}
                  >
                    <Icon name="download" size={18} />
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="modal-actions">
        <button
          type="button"
          className="button button-primary"
          onClick={onClose}
        >
          Fermer le bilan
        </button>
      </div>
    </ModalShell>
  );
}

function ModalShell({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className="modal-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={`modal-dialog ${wide ? "modal-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <button
          type="button"
          className="icon-button modal-close"
          onClick={onClose}
          aria-label="Fermer"
        >
          <Icon name="close" size={20} />
        </button>
        {children}
      </div>
    </div>
  );
}

function ModalHeader({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="modal-header">
      <span className="section-eyebrow">{eyebrow}</span>
      <h2>{title}</h2>
      <p>{subtitle}</p>
    </div>
  );
}

function StudentFormModal({
  students,
  onClose,
  onSave,
}: {
  students: Student[];
  onClose: () => void;
  onSave: (student: {
    name: string;
    whatsapp: string;
    cohort: string;
  }) => Promise<string | null>;
}) {
  const [name, setName] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [cohort, setCohort] = useState(currentCohort());
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const cleanName = name.trim().replace(/\s+/g, " ");
  const previewRegistration =
    cleanName.length >= 3 && isValidCohort(cohort)
      ? buildRegistration(cleanName, cohort, students)
      : "";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const result = await onSave({ name, whatsapp, cohort });
      setError(result || "");
    } catch {
      setError("Création impossible. Réessayez.");
    } finally {
      setPending(false);
    }
  }

  return (
    <ModalShell title="Ajouter un étudiant" onClose={onClose}>
      <ModalHeader
        eyebrow="NOUVELLE INSCRIPTION"
        title="Ajouter un étudiant"
        subtitle="L'immatriculation est générée automatiquement à partir du nom et du mois d'adhésion."
      />
      <form className="modal-form" onSubmit={submit}>
        <label>
          Nom complet
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Ex. Amina Diallo"
            required
          />
        </label>
        <label>
          Numéro WhatsApp
          <input
            type="tel"
            value={whatsapp}
            onChange={(event) => setWhatsapp(event.target.value)}
            placeholder="Ex. +225 07 00 00 00 00"
            required
          />
        </label>
        <label>
          Mois d'adhésion (cohorte)
          <input
            type="month"
            value={cohort}
            onChange={(event) => setCohort(event.target.value)}
            required
          />
          <small>
            L'étudiant rejoindra la {cohortLabel(cohort || "AAAA-MM")}.
          </small>
        </label>
        <div
          className={`registration-preview ${previewRegistration ? "" : "registration-pending"}`}
          aria-live="polite"
        >
          <span className="panel-kicker">IMMATRICULATION GÉNÉRÉE</span>
          <strong>{previewRegistration || "— — — —"}</strong>
          <small>
            {previewRegistration
              ? "Initiales + année + mois d'adhésion. Elle servira de clé de connexion à l'étudiant."
              : "Saisissez le nom complet pour générer l'immatriculation."}
          </small>
        </div>
        {error && (
          <div className="form-error" role="alert">
            <Icon name="alert" size={17} />
            {error}
          </div>
        )}
        <div className="modal-actions">
          <button
            type="button"
            className="button button-secondary"
            onClick={onClose}
          >
            Annuler
          </button>
          <button
            type="submit"
            className="button button-primary"
            disabled={pending}
          >
            <Icon name="plus" size={18} />
            {pending ? "Création…" : "Créer l'inscription"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function ExternalCredentialsFields({
  students,
  values,
  onChange,
}: {
  students: Student[];
  values: Record<string, ExternalCredentials>;
  onChange: (values: Record<string, ExternalCredentials>) => void;
}) {
  function change(
    studentId: string,
    field: "username" | "password",
    value: string,
  ) {
    onChange({
      ...values,
      [studentId]: {
        username: values[studentId]?.username || "",
        password: values[studentId]?.password || "",
        [field]: value,
      },
    });
  }

  return (
    <fieldset className="external-credentials-fields">
      <legend>Accès à la plateforme externe</legend>
      <p>
        Renseignez ici l'e-mail (ou le nom d'utilisateur) et le mot de passe
        fournis par la plateforme externe pour chaque étudiant destinataire. Ces
        accès sont différents de ceux de JZ KALYPHOR. Laissez les champs vides
        si la ressource est publique.
      </p>
      {students.length ? (
        students.map((student) => (
          <div className="external-credentials-person" key={student.id}>
            <div className="person-cell">
              <Avatar name={student.name} small />
              <strong>{student.name}</strong>
            </div>
            <div className="external-credentials-inputs">
              <label htmlFor={`external-user-${student.id}`}>
                E-mail ou nom d'utilisateur
                <input
                  id={`external-user-${student.id}`}
                  aria-label={`E-mail ou nom d'utilisateur externe pour ${student.name}`}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={values[student.id]?.username || ""}
                  onChange={(event) =>
                    change(student.id, "username", event.target.value)
                  }
                  placeholder="Ex. etudiant@plateforme.com"
                />
              </label>
              <label htmlFor={`external-password-${student.id}`}>
                Mot de passe de la plateforme
                <input
                  id={`external-password-${student.id}`}
                  aria-label={`Mot de passe de la plateforme externe pour ${student.name}`}
                  type="password"
                  autoComplete="new-password"
                  value={values[student.id]?.password || ""}
                  onChange={(event) =>
                    change(student.id, "password", event.target.value)
                  }
                  placeholder="Mot de passe de la plateforme"
                />
              </label>
            </div>
          </div>
        ))
      ) : (
        <p>Ajoutez un étudiant pour lui attribuer des accès externes.</p>
      )}
      <small>
        Chaque étudiant ne voit que ses propres accès, dans l'espace du cours
        concerné. Transmettez-les uniquement si la plateforme les exige.
      </small>
    </fieldset>
  );
}

function CourseFormModal({
  students,
  onClose,
  onSave,
}: {
  students: Student[];
  onClose: () => void;
  onSave: (course: {
    title: string;
    description: string;
    type: ResourceType;
    url: string;
    target: string;
    externalCredentials: Record<string, ExternalCredentials>;
  }) => string | null;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<ResourceType>("youtube");
  const [url, setUrl] = useState("");
  const [target, setTarget] = useState("all");
  const [externalCredentials, setExternalCredentials] = useState<
    Record<string, ExternalCredentials>
  >({});
  const [error, setError] = useState("");
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(
      onSave({ title, description, type, url, target, externalCredentials }) ||
        "",
    );
  }
  return (
    <ModalShell title="Publier un cours" onClose={onClose} wide>
      <ModalHeader
        eyebrow="NOUVELLE RESSOURCE"
        title="Publier un cours"
        subtitle="Publiez une ressource et transmettez, si nécessaire, les accès à la plateforme externe de chaque étudiant."
      />
      <form className="modal-form" onSubmit={submit}>
        <label>
          Titre du cours
          <input
            autoFocus
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Ex. Maîtriser sa communication digitale"
            required
          />
        </label>
        <label>
          Description & consignes
          <textarea
            rows={3}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Décrivez les objectifs et le travail attendu..."
            required
          />
        </label>
        <fieldset className="resource-choice">
          <legend>Type de ressource</legend>
          <div>
            {(
              [
                { id: "youtube", icon: "video", label: "Vidéo YouTube" },
                { id: "link", icon: "link", label: "Plateforme / lien web" },
                { id: "document", icon: "file", label: "Document" },
              ] as { id: ResourceType; icon: IconName; label: string }[]
            ).map((option) => (
              <button
                key={option.id}
                type="button"
                className={type === option.id ? "choice-active" : ""}
                onClick={() => setType(option.id)}
                aria-pressed={type === option.id}
              >
                <Icon name={option.icon} size={19} />
                {option.label}
              </button>
            ))}
          </div>
        </fieldset>
        <label>
          URL de la ressource
          <input
            type="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder={
              type === "youtube"
                ? "https://www.youtube.com/watch?v=..."
                : type === "document"
                  ? "https://drive.google.com/... ou https://.../fichier.pdf"
                  : "https://exemple.com/ressource"
            }
            required
          />
          <small>
            {type === "youtube"
              ? "Lien YouTube public, intégré directement dans l'espace étudiant."
              : "Le lien sera ouvert dans un nouvel onglet pour l'étudiant."}
          </small>
        </label>
        <label>
          Diffuser à
          <select
            value={target}
            onChange={(event) => setTarget(event.target.value)}
          >
            <option value="all">Tous les étudiants</option>
            {listCohorts(students).length > 0 && (
              <optgroup label="Par cohorte">
                {listCohorts(students).map((cohort) => (
                  <option key={cohort} value={`cohort:${cohort}`}>
                    {cohortLabel(cohort)}
                  </option>
                ))}
              </optgroup>
            )}
            {students.length > 0 && (
              <optgroup label="Étudiant spécifique">
                {students.map((student) => (
                  <option key={student.id} value={student.id}>
                    {student.name} · {student.registration}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          <small>
            Un cours diffusé à une cohorte sera aussi visible par les étudiants
            ajoutés plus tard dans cette cohorte.
          </small>
        </label>
        {type !== "youtube" && (
          <ExternalCredentialsFields
            students={students.filter((student) =>
              studentMatchesTarget(student, target),
            )}
            values={externalCredentials}
            onChange={setExternalCredentials}
          />
        )}
        {error && (
          <div className="form-error" role="alert">
            <Icon name="alert" size={17} />
            {error}
          </div>
        )}
        <div className="modal-actions">
          <button
            type="button"
            className="button button-secondary"
            onClick={onClose}
          >
            Annuler
          </button>
          <button type="submit" className="button button-primary">
            <Icon name="plus" size={18} />
            Publier le cours
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function ExternalCredentialsModal({
  course,
  students,
  onClose,
  onSave,
}: {
  course: Course;
  students: Student[];
  onClose: () => void;
  onSave: (
    courseId: string,
    values: Record<string, ExternalCredentials>,
  ) => string | null;
}) {
  const [credentials, setCredentials] = useState<
    Record<string, ExternalCredentials>
  >(course.externalCredentials || {});
  const [error, setError] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(onSave(course.id, credentials) || "");
  }

  return (
    <ModalShell title="Gérer les identifiants externes" onClose={onClose} wide>
      <ModalHeader
        eyebrow="ACCÈS AUX RESSOURCES"
        title="Accès à la plateforme externe"
        subtitle={`Modifiez l'e-mail ou le nom d'utilisateur et le mot de passe fournis pour « ${course.title} ». Laissez les deux champs vides pour retirer les accès.`}
      />
      <form className="modal-form" onSubmit={submit}>
        <ExternalCredentialsFields
          students={students.filter((student) =>
            studentMatchesTarget(student, course.target),
          )}
          values={credentials}
          onChange={setCredentials}
        />
        {error && (
          <div className="form-error" role="alert">
            <Icon name="alert" size={17} />
            {error}
          </div>
        )}
        <div className="modal-actions">
          <button
            type="button"
            className="button button-secondary"
            onClick={onClose}
          >
            Annuler
          </button>
          <button type="submit" className="button button-primary">
            Enregistrer les accès
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function InspectModal({
  assignment,
  onClose,
}: {
  assignment: Assignment;
  onClose: () => void;
}) {
  const { student, course, progress } = assignment;
  const [preview, setPreview] = useState<Proof | null>(null);
  return (
    <ModalShell title={`Rapport de ${student.name}`} onClose={onClose} wide>
      <ModalHeader
        eyebrow="INSPECTION DES PREUVES"
        title="Rapport de séance"
        subtitle="Consultez le travail transmis par votre étudiant."
      />
      <div className="inspection-meta">
        <div className="person-cell">
          <Avatar name={student.name} />
          <div>
            <strong>{student.name}</strong>
            <span className="cell-subtext">{course.title}</span>
          </div>
        </div>
        <StatusBadge status={progress.status} />
      </div>
      <div className="inspection-facts">
        <div>
          <span>TEMPS D'ÉTUDE</span>
          <strong>
            <Icon name="clock" size={18} />
            {formatDuration(progress.hours, progress.minutes)}
          </strong>
        </div>
        <div>
          <span>TRANSMIS LE</span>
          <strong>
            <Icon name="calendar" size={18} />
            {progress.submittedAt
              ? formatDate(progress.submittedAt, true)
              : "Non transmis"}
          </strong>
        </div>
      </div>
      <div className="inspection-section">
        <h3>Compte-rendu rédigé</h3>
        <div className="report-content">
          {progress.report || "Aucun compte-rendu renseigné."}
        </div>
      </div>
      <div className="inspection-section">
        <h3>
          Preuves jointes <span>({progress.proofs.length})</span>
        </h3>
        {progress.proofs.length ? (
          <div className="inspection-proofs">
            {progress.proofs.map((proof) => (
              <div className="inspection-proof" key={proof.id}>
                <button
                  type="button"
                  onClick={() => setPreview(proof)}
                  className="inspection-thumb"
                  aria-label={`Prévisualiser ${proof.name}`}
                >
                  {proof.type.startsWith("image/") ? (
                    <img src={proof.dataUrl} alt={proof.name} />
                  ) : (
                    <Icon name="file" size={27} />
                  )}
                </button>
                <div>
                  <strong title={proof.name}>{proof.name}</strong>
                  <span>{Math.max(1, Math.round(proof.size / 1024))} Ko</span>
                </div>
                <div className="inspection-proof-actions">
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => setPreview(proof)}
                    title="Prévisualiser"
                    aria-label={`Prévisualiser ${proof.name}`}
                  >
                    <Icon name="eye" size={18} />
                  </button>
                  <a
                    className="icon-button"
                    href={proof.dataUrl}
                    download={proof.name}
                    title="Télécharger"
                    aria-label={`Télécharger ${proof.name}`}
                  >
                    <Icon name="download" size={18} />
                  </a>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="no-proof">Aucun fichier joint à ce rapport.</p>
        )}
      </div>
      <div className="modal-actions">
        <button
          type="button"
          className="button button-primary"
          onClick={onClose}
        >
          Fermer l'inspection
        </button>
      </div>
      {preview && (
        <div
          className="nested-preview"
          role="dialog"
          aria-modal="true"
          aria-label={`Aperçu de ${preview.name}`}
        >
          <div className="nested-preview-inner">
            <div className="nested-preview-top">
              <strong>{preview.name}</strong>
              <button
                type="button"
                className="icon-button"
                onClick={() => setPreview(null)}
                aria-label="Fermer l'aperçu"
              >
                <Icon name="close" size={20} />
              </button>
            </div>
            <div className="nested-preview-media">
              {preview.type.startsWith("image/") ? (
                <img src={preview.dataUrl} alt={preview.name} />
              ) : (
                <iframe title={preview.name} src={preview.dataUrl} />
              )}
            </div>
            <a
              className="button button-secondary"
              href={preview.dataUrl}
              download={preview.name}
            >
              <Icon name="download" size={17} />
              Télécharger le fichier
            </a>
          </div>
        </div>
      )}
    </ModalShell>
  );
}

function ConfirmModal({
  eyebrow,
  title,
  text,
  confirmLabel,
  dangerous,
  onClose,
  onConfirm,
}: {
  eyebrow: string;
  title: string;
  text: string;
  confirmLabel: string;
  dangerous?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <ModalShell title={title} onClose={onClose}>
      <div className={`confirm-symbol ${dangerous ? "confirm-danger" : ""}`}>
        <Icon name={dangerous ? "trash" : "reset"} size={25} />
      </div>
      <ModalHeader eyebrow={eyebrow} title={title} subtitle={text} />
      <div className="modal-actions confirm-actions">
        <button
          type="button"
          className="button button-secondary"
          onClick={onClose}
        >
          Annuler
        </button>
        <button
          type="button"
          className={`button ${dangerous ? "button-danger" : "button-primary"}`}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </ModalShell>
  );
}

export default function App() {
  const [data, setData] = useState<AppData>(loadData);
  const [session, setSession] = useState<Session | null>(loadSession);
  const [adminView, setAdminView] = useState<AdminView>("overview");
  const [studentView, setStudentView] = useState<StudentView>("courses");
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [studentQuery, setStudentQuery] = useState("");
  const [studentFilter, setStudentFilter] = useState<
    "all" | "active" | "suspended"
  >("all");
  const [cohortFilter, setCohortFilter] = useState("all");
  const [guide, setGuide] = useState<GuideState>(loadGuide);
  const [tour, setTour] = useState<"admin" | "student" | "course" | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [booting, setBooting] = useState(REMOTE);
  const now = useNow();

  // Suivi des lignes en cours d'édition (synchronisées en différé) et des synchros temps réel
  const dirtyProgressRef = useRef(new Set<string>());
  const dirtyWeeklyRef = useRef(new Set<string>());
  const pendingProgressRef = useRef(new Map<string, Progress>());
  const pendingWeeklyRef = useRef(new Map<string, WeeklyReport>());
  const progressFlushTimer = useRef<number | undefined>(undefined);
  const weeklyFlushTimer = useRef<number | undefined>(undefined);
  const refreshTimer = useRef<number | undefined>(undefined);
  const realtimeCleanupRef = useRef<(() => void) | null>(null);
  const sessionRef = useRef<Session | null>(null);
  sessionRef.current = session;

  useEffect(() => {
    try {
      localStorage.setItem(GUIDE_KEY, JSON.stringify(guide));
    } catch {
      /* The guide is a convenience; the app works without persistence. */
    }
  }, [guide]);

  /** Fusionne un rechargement distant en préservant les lignes en cours d'édition. */
  const refreshRemote = useCallback(async () => {
    try {
      const fresh = await fetchAllRemote();
      setData((current) =>
        mergeRemoteData(current, fresh, {
          progress: dirtyProgressRef.current,
          weekly: dirtyWeeklyRef.current,
        }),
      );
      const current = sessionRef.current;
      if (current?.role === "student") {
        const student = fresh.students.find((item) => item.id === current.studentId);
        if (!student || !student.active) {
          await logoutRemote();
          setSession(null);
          notify("Votre accès étudiant n'est plus actif.", "error");
        }
      }
    } catch {
      /* Une erreur réseau ne doit pas casser l'interface. */
    }
  }, []);

  const scheduleRemoteRefresh = useCallback(() => {
    window.clearTimeout(refreshTimer.current);
    refreshTimer.current = window.setTimeout(() => {
      void refreshRemote();
    }, 400);
  }, [refreshRemote]);

  /** Synchronise les lignes de progression modifiées (debounced 1,5 s). */
  const flushProgress = useCallback(async () => {
    const rows = [...pendingProgressRef.current.values()];
    pendingProgressRef.current.clear();
    await Promise.all(
      rows.map(async (row) => {
        const key = `${row.studentId}/${row.courseId}`;
        try {
          const saved = await upsertProgressRemote(row);
          dirtyProgressRef.current.delete(key);
          if (!pendingProgressRef.current.has(key)) {
            setData((current) => ({
              ...current,
              progress: current.progress.map((item) =>
                item.studentId === saved.studentId &&
                item.courseId === saved.courseId
                  ? saved
                  : item,
              ),
            }));
          }
        } catch {
          dirtyProgressRef.current.add(key);
        }
      }),
    );
  }, []);

  const flushWeekly = useCallback(async () => {
    const rows = [...pendingWeeklyRef.current.values()];
    pendingWeeklyRef.current.clear();
    await Promise.all(
      rows.map(async (row) => {
        const key = `${row.studentId}/${row.weekStart}`;
        try {
          const saved = await upsertWeeklyRemote(row);
          dirtyWeeklyRef.current.delete(key);
          if (!pendingWeeklyRef.current.has(key)) {
            setData((current) => ({
              ...current,
              weeklyReports: current.weeklyReports.map((item) =>
                item.id === saved.id ? saved : item,
              ),
            }));
          }
        } catch {
          dirtyWeeklyRef.current.add(key);
        }
      }),
    );
  }, []);

  // Démarrage : en mode connecté, résoudre la session, charger les données et s'abonner au temps réel.
  useEffect(() => {
    if (!REMOTE) return;
    let cancelled = false;
    (async () => {
      try {
        const remoteSession = await resolveRemoteSession();
        if (cancelled) return;
        if (remoteSession) {
          setSession(remoteSession);
          if (remoteSession.role === "student") setStudentView("courses");
        }
        const fresh = await fetchAllRemote();
        if (cancelled) return;
        setData(fresh);
        realtimeCleanupRef.current = subscribeRemote(scheduleRemoteRefresh);
      } catch {
        /* En cas d'indisponibilité réseau, le mode local reste utilisable. */
      } finally {
        if (!cancelled) setBooting(false);
      }
    })();
    const unsubscribeAuth = onAuthChange((event) => {
      if (event === "SIGNED_OUT") {
        realtimeCleanupRef.current?.();
        realtimeCleanupRef.current = null;
        setSession(null);
        setData(seedData());
      }
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        void refreshRemote();
      }
    });
    return () => {
      cancelled = true;
      unsubscribeAuth();
      realtimeCleanupRef.current?.();
      realtimeCleanupRef.current = null;
      window.clearTimeout(progressFlushTimer.current);
      window.clearTimeout(weeklyFlushTimer.current);
      window.clearTimeout(refreshTimer.current);
      // Dernière tentative de synchronisation avant de quitter la page
      if (pendingProgressRef.current.size) void flushProgress();
      if (pendingWeeklyRef.current.size) void flushWeekly();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [trackingQuery, setTrackingQuery] = useState("");
  const [trackingFilter, setTrackingFilter] = useState<"all" | ProgressStatus>(
    "all",
  );

  function notify(message: string, kind: Toast["kind"] = "success") {
    const id = makeId();
    setToasts((current) => [...current.slice(-3), { id, message, kind }]);
    window.setTimeout(
      () => setToasts((current) => current.filter((item) => item.id !== id)),
      4400,
    );
  }

  useEffect(() => {
    try {
      localStorage.setItem(DATA_KEY, JSON.stringify(data));
    } catch {
      notify(
        "Le stockage local est plein. Réduisez la taille des pièces jointes.",
        "error",
      );
    }
  }, [data]);

  useEffect(() => {
    try {
      if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      else localStorage.removeItem(SESSION_KEY);
    } catch {
      /* The current session still works even if storage is unavailable. */
    }
  }, [session]);

  useEffect(() => {
    if (
      session?.role === "student" &&
      !data.students.some(
        (item) => item.id === session.studentId && item.active,
      )
    ) {
      setSession(null);
      setStudentView("courses");
      notify("Votre accès étudiant n'est plus actif.", "error");
    }
  }, [data.students, session]);

  useEffect(() => {
    function sync(event: StorageEvent) {
      if (event.key === DATA_KEY && event.newValue) {
        try {
          const incoming = JSON.parse(event.newValue);
          if (
            Array.isArray(incoming.students) &&
            Array.isArray(incoming.courses) &&
            Array.isArray(incoming.progress)
          )
            setData(incoming);
        } catch {
          /* Ignore corrupted data from another tab. */
        }
      }
    }
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);

  useEffect(() => {
    if (!modal) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setModal(null);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [modal]);

  const assignments = useMemo<Assignment[]>(
    () =>
      data.courses.flatMap((course) =>
        data.students
          .filter((student) => studentMatchesTarget(student, course.target))
          .map((student) => ({
            student,
            course,
            progress: getProgress(data, student.id, course.id),
          })),
      ),
    [data],
  );
  const currentStudent =
    session?.role === "student"
      ? data.students.find((item) => item.id === session.studentId)
      : undefined;
  const studentAssignments = currentStudent
    ? assignments.filter((item) => item.student.id === currentStudent.id)
    : [];
  const currentCourse = selectedCourseId
    ? data.courses.find((item) => item.id === selectedCourseId)
    : undefined;

  async function login(
    mode: LoginMode,
    name: string,
    secret: string,
  ): Promise<string | null> {
    if (REMOTE) {
      const result = await loginRemote(mode, name, secret);
      if (result.error || !result.session) {
        notify(result.error || "Connexion impossible.", "error");
        return result.error || "Connexion impossible.";
      }
      setSession(result.session);
      if (result.session.role === "admin") {
        setAdminView("overview");
        notify("Bienvenue dans votre espace formateur.");
      } else {
        setStudentView("courses");
        const studentId = result.session.studentId;
        const student = data.students.find((item) => item.id === studentId);
        notify(`Bienvenue, ${student?.name.split(" ")[0] || ""} !`);
      }
      return null;
    }
    const normalized = name
      .trim()
      .replace(/\s+/g, " ")
      .toLocaleLowerCase("fr-FR");
    if (mode === "admin") {
      if (
        normalized === ADMIN_NAME.toLocaleLowerCase("fr-FR") &&
        secret === ADMIN_PASSWORD
      ) {
        setSession({ role: "admin" });
        setAdminView("overview");
        notify("Bienvenue dans votre espace formateur.");
        return null;
      }
      notify("Identifiant ou mot de passe formateur incorrect.", "error");
      return "Identifiant ou mot de passe formateur incorrect.";
    }
    const registration = normalizeRegistration(secret);
    const student = data.students.find(
      (item) =>
        item.registration.toUpperCase() === registration &&
        item.name.toLocaleLowerCase("fr-FR") === normalized,
    );
    if (!student) {
      notify("Nom ou immatriculation incorrect.", "error");
      return "Nom ou immatriculation incorrect. Vérifiez les informations reçues par WhatsApp.";
    }
    if (!student.active) {
      notify(
        "Ce compte étudiant est suspendu. Contactez votre formateur.",
        "error",
      );
      return "Ce compte est suspendu. Contactez votre formateur.";
    }
    setSession({ role: "student", studentId: student.id });
    setStudentView("courses");
    notify(`Bienvenue, ${student.name.split(" ")[0]} !`);
    return null;
  }

  function logout() {
    setSession(null);
    setMobileNavOpen(false);
    setModal(null);
    notify("Vous avez été déconnecté.", "info");
  }

  function updateProgress(
    studentId: string,
    courseId: string,
    updater: (progress: Progress) => Progress,
  ) {
    let updated: Progress | null = null;
    setData((current) => {
      const existing = current.progress.find(
        (item) => item.studentId === studentId && item.courseId === courseId,
      );
      updated = updater(existing || emptyProgress(studentId, courseId));
      return {
        ...current,
        progress: existing
          ? current.progress.map((item) =>
              item.studentId === studentId && item.courseId === courseId
                ? updated!
                : item,
            )
          : [...current.progress, updated!],
      };
    });
    // En mode connecté : synchronisation différée pour ne pas écrire à chaque frappe.
    if (REMOTE && updated) {
      const key = `${studentId}/${courseId}`;
      dirtyProgressRef.current.add(key);
      pendingProgressRef.current.set(key, updated);
      window.clearTimeout(progressFlushTimer.current);
      progressFlushTimer.current = window.setTimeout(() => {
        void flushProgress();
      }, 1500);
    }
  }

  async function saveStudent(values: {
    name: string;
    whatsapp: string;
    cohort: string;
  }): Promise<string | null> {
    const name = values.name.trim().replace(/\s+/g, " ");
    const digits = values.whatsapp.replace(/\D/g, "");
    if (name.length < 3 || !/\s/.test(name))
      return "Saisissez le nom complet de l'étudiant (prénom et nom).";
    if (
      name.toLocaleLowerCase("fr-FR") ===
        ADMIN_NAME.toLocaleLowerCase("fr-FR") ||
      data.students.some(
        (item) =>
          item.name.toLocaleLowerCase("fr-FR") ===
          name.toLocaleLowerCase("fr-FR"),
      )
    )
      return "Un compte porte déjà ce nom.";
    if (digits.length < 8 || digits.length > 15)
      return "Saisissez un numéro WhatsApp valide avec indicatif.";
    if (data.students.some((item) => item.whatsapp === `+${digits}`))
      return "Ce numéro WhatsApp est déjà associé à un étudiant.";
    if (!isValidCohort(values.cohort))
      return "Indiquez le mois d'adhésion de l'étudiant.";
    if (REMOTE) {
      try {
        const student = await createStudentRemote({
          name,
          whatsapp: `+${digits}`,
          cohort: values.cohort,
        });
        setData((current) => ({
          ...current,
          students: [...current.students, student],
        }));
        setModal(null);
        notify(
          `${student.name} rejoint la ${cohortLabel(student.cohort)} · Immatriculation ${student.registration}.`,
        );
        return null;
      } catch (error) {
        return error instanceof Error
          ? error.message
          : "Création de l'étudiant impossible.";
      }
    }
    const registration = buildRegistration(name, values.cohort, data.students);
    setData((current) => ({
      ...current,
      students: [
        ...current.students,
        {
          id: makeId(),
          name,
          whatsapp: `+${digits}`,
          registration,
          cohort: values.cohort,
          active: true,
          createdAt: new Date().toISOString(),
        },
      ],
    }));
    setModal(null);
    notify(
      `${name} rejoint la ${cohortLabel(values.cohort)} · Immatriculation ${registration}.`,
    );
    return null;
  }

  function savePortalUrl(value: string): string | null {
    const url = value.trim();
    if (url && !isWebUrl(url))
      return "Saisissez une adresse web complète (https://...).";
    if (REMOTE) {
      saveSettingsRemote(url).catch(() => {
        notify("Enregistrement en ligne impossible pour le moment.", "error");
      });
    }
    setData((current) => ({ ...current, settings: { portalUrl: url } }));
    notify(
      url
        ? "Le lien de l'espace étudiant a été enregistré."
        : `Le lien de l'espace étudiant utilisera ${DEFAULT_PORTAL_URL}.`,
    );
    return null;
  }

  function saveCourse(values: {
    title: string;
    description: string;
    type: ResourceType;
    url: string;
    target: string;
    externalCredentials: Record<string, ExternalCredentials>;
  }): string | null {
    const title = values.title.trim();
    const description = values.description.trim();
    const url = values.url.trim();
    if (title.length < 4 || description.length < 10)
      return "Complétez le titre et des consignes d'au moins 10 caractères.";
    if (!isWebUrl(url)) return "Saisissez une URL web valide (http ou https).";
    if (values.type === "youtube" && !getYouTubeId(url))
      return "Utilisez un lien de vidéo YouTube valide.";
    const targetIsValid =
      values.target === "all" ||
      (values.target.startsWith("cohort:") &&
        data.students.some(
          (item) => `cohort:${item.cohort}` === values.target,
        )) ||
      data.students.some((item) => item.id === values.target);
    if (!targetIsValid)
      return "Sélectionnez une cohorte ou un étudiant existant.";
    const recipients = data.students.filter((student) =>
      studentMatchesTarget(student, values.target),
    );
    const { credentials, error } = validateExternalCredentials(
      values.type === "youtube" ? {} : values.externalCredentials,
      recipients,
    );
    if (error) return error;
    const course: Course = {
      id: makeId(),
      title,
      description,
      type: values.type,
      url,
      target: values.target,
      createdAt: new Date().toISOString(),
      externalCredentials: credentials,
    };
    if (REMOTE) {
      insertCourseRemote(course)
        .then((created) => {
          setData((current) => ({
            ...current,
            courses: [...current.courses, created],
          }));
        })
        .catch(() =>
          notify("Publication en ligne impossible pour le moment.", "error"),
        );
    } else {
      setData((current) => ({
        ...current,
        courses: [...current.courses, course],
      }));
    }
    setModal(null);
    notify(`Le cours « ${title} » a été publié.`);
    return null;
  }

  function saveExternalCredentials(
    courseId: string,
    values: Record<string, ExternalCredentials>,
  ): string | null {
    const course = data.courses.find((item) => item.id === courseId);
    if (!course || course.type === "youtube")
      return "Ce cours est introuvable.";
    const recipients = data.students.filter((student) =>
      studentMatchesTarget(student, course.target),
    );
    const { credentials, error } = validateExternalCredentials(
      values,
      recipients,
    );
    if (error) return error;
    const updatedCourse: Course = { ...course, externalCredentials: credentials };
    if (REMOTE) {
      updateCourseRemote(updatedCourse).catch(() =>
        notify("Enregistrement en ligne impossible pour le moment.", "error"),
      );
    }
    setData((current) => ({
      ...current,
      courses: current.courses.map((item) =>
        item.id === courseId ? updatedCourse : item,
      ),
    }));
    setModal(null);
    notify("Les identifiants externes ont été enregistrés.");
    return null;
  }

  function toggleStudent(student: Student) {
    const nextActive = !student.active;
    if (REMOTE) {
      setStudentActiveRemote(student.id, nextActive)
        .then((updated) => {
          setData((current) => ({
            ...current,
            students: current.students.map((item) =>
              item.id === updated.id ? updated : item,
            ),
          }));
        })
        .catch(() =>
          notify("Mise à jour en ligne impossible pour le moment.", "error"),
        );
    } else {
      setData((current) => ({
        ...current,
        students: current.students.map((item) =>
          item.id === student.id ? { ...item, active: nextActive } : item,
        ),
      }));
    }
    notify(
      `Accès de ${student.name} ${nextActive ? "activé" : "suspendu"}.`,
      nextActive ? "success" : "info",
    );
  }

  function openWhatsApp(student: Student, message: string) {
    window.open(
      `https://wa.me/${student.whatsapp.replace(/\D/g, "")}?text=${encodeURIComponent(message)}`,
      "_blank",
      "noopener,noreferrer",
    );
  }

  /** Message d'accès : immatriculation, lien de l'espace étudiant et cours disponibles. */
  function sendAccess(student: Student) {
    const portal = resolvePortalUrl(data.settings);
    const courses = assignments
      .filter((item) => item.student.id === student.id)
      .map((item) => item.course.title);
    const lines = [
      `Bonjour ${student.name},`,
      "",
      `Bienvenue sur JZ KALYPHOR – ${cohortLabel(student.cohort)}.`,
      "",
      "Vos accès à votre espace étudiant :",
      `• Nom complet : ${student.name}`,
      `• Immatriculation : ${student.registration}`,
      portal ? `• Lien de connexion : ${portal}` : "",
      "",
      courses.length
        ? `Cours disponibles dès maintenant : ${courses
            .slice(0, 4)
            .map((title) => `« ${title} »`)
            .join(", ")}${courses.length > 4 ? "…" : ""}.`
        : "Vos premiers cours seront publiés très prochainement dans votre espace.",
      "",
      "Connectez-vous avec votre nom complet et votre immatriculation. Ces accès sont personnels.",
      "",
      "Important : chaque semaine, un bilan hebdomadaire est à rendre dans votre espace avant le dimanche 23:59.",
      "",
      "Prenez le contrôle de votre avenir professionnel.",
      "Votre formateur – JZ KALYPHOR",
    ].filter((line) => line !== null);
    openWhatsApp(student, lines.join("\n"));
    const sentAt = new Date().toISOString();
    if (REMOTE) {
      markAccessSentRemote(student.id)
        .then((updated) => {
          setData((current) => ({
            ...current,
            students: current.students.map((item) =>
              item.id === updated.id ? updated : item,
            ),
          }));
        })
        .catch(() => {});
    }
    setData((current) => ({
      ...current,
      students: current.students.map((item) =>
        item.id === student.id ? { ...item, accessSentAt: sentAt } : item,
      ),
    }));
    notify(`Accès WhatsApp préparés pour ${student.name}.`, "info");
  }

  /** Ouvre l'inspection d'un rapport et le marque comme inspecté. */
  /** Mise à jour (brouillon) du bilan d'une semaine, enregistrée automatiquement. */
  function updateWeekly(
    studentId: string,
    weekStart: string,
    updater: (report: WeeklyReport) => WeeklyReport,
  ) {
    let updated: WeeklyReport | null = null;
    setData((current) => {
      const existing = findWeeklyReport(current, studentId, weekStart);
      updated = updater(existing || emptyWeeklyReport(studentId, weekStart));
      return {
        ...current,
        weeklyReports: existing
          ? current.weeklyReports.map((item) =>
              item.id === existing.id ? updated! : item,
            )
          : [...current.weeklyReports, updated!],
      };
    });
    // En mode connecté : synchronisation différée pour ne pas écrire à chaque frappe.
    if (REMOTE && updated) {
      const key = `${studentId}/${weekStart}`;
      dirtyWeeklyRef.current.add(key);
      pendingWeeklyRef.current.set(key, updated);
      window.clearTimeout(weeklyFlushTimer.current);
      weeklyFlushTimer.current = window.setTimeout(() => {
        void flushWeekly();
      }, 1500);
    }
  }

  function submitWeekly(weekStart: string): boolean {
    if (!currentStudent) return false;
    const report =
      findWeeklyReport(data, currentStudent.id, weekStart) ||
      emptyWeeklyReport(currentStudent.id, weekStart);
    const deadline = weekDeadline(weekStart).getTime();
    if (report.submittedAt && Date.now() > deadline) {
      notify(
        "L'échéance est passée : ce bilan n'est plus modifiable.",
        "error",
      );
      return false;
    }
    if (report.hours * 60 + report.minutes < 1) {
      notify("Indiquez votre temps d'étude de la semaine.", "error");
      return false;
    }
    if (!report.courseIds.length) {
      notify(
        "Sélectionnez au moins un cours travaillé cette semaine.",
        "error",
      );
      return false;
    }
    if (report.summary.trim().length < 40) {
      notify("Rédigez un compte-rendu d'au moins 40 caractères.", "error");
      return false;
    }
    if (report.nextGoals.trim().length < 15) {
      notify("Précisez vos objectifs pour la semaine prochaine.", "error");
      return false;
    }
    const submittedAt = new Date().toISOString();
    const late = Date.now() > deadline;
    const updatedReport: WeeklyReport = {
      ...report,
      summary: report.summary.trim(),
      difficulties: report.difficulties.trim(),
      nextGoals: report.nextGoals.trim(),
      submittedAt,
      reviewedAt: undefined,
    };
    if (REMOTE) {
      // Envoi immédiat : l'échéance est figée côté serveur à l'horodatage réel.
      const key = `${currentStudent.id}/${weekStart}`;
      pendingWeeklyRef.current.delete(key);
      dirtyWeeklyRef.current.delete(key);
      upsertWeeklyRemote(updatedReport).catch(() => {
        dirtyWeeklyRef.current.add(key);
        pendingWeeklyRef.current.set(key, updatedReport);
      });
    }
    updateWeekly(currentStudent.id, weekStart, () => updatedReport);
    notify(
      late
        ? "Bilan transmis. Il est signalé comme rendu en retard."
        : report.submittedAt
          ? "Votre bilan hebdomadaire a été mis à jour."
          : "Votre bilan hebdomadaire a été transmis à votre formateur.",
      late ? "info" : "success",
    );
    return true;
  }

  function inspectWeekly(reportId: string) {
    const reviewedAt = new Date().toISOString();
    setData((current) => ({
      ...current,
      weeklyReports: current.weeklyReports.map((item) =>
        item.id === reportId
          ? { ...item, reviewedAt: item.reviewedAt || reviewedAt }
          : item,
      ),
    }));
    if (REMOTE) {
      const report = data.weeklyReports.find((item) => item.id === reportId);
      if (report && !report.reviewedAt) {
        const key = `${report.studentId}/${report.weekStart}`;
        pendingWeeklyRef.current.delete(key);
        dirtyWeeklyRef.current.delete(key);
        upsertWeeklyRemote({ ...report, reviewedAt }).catch(() => {});
      }
    }
    setModal({ type: "inspectWeekly", reportId });
  }

  /** Rappel WhatsApp du bilan hebdomadaire (échéance à venir ou dépassée). */
  function remindWeekly(student: Student, weekStart: string) {
    const portal = resolvePortalUrl(data.settings);
    const overdue = Date.now() > weekDeadline(weekStart).getTime();
    const message = [
      `Bonjour ${student.name},`,
      "",
      overdue
        ? `Votre formateur JZ KALYPHOR constate que votre bilan hebdomadaire de la ${weekLabel(weekStart).toLowerCase()} n'a pas été transmis avant l'échéance (${formatDeadline(weekStart)}).`
        : `Rappel : votre bilan hebdomadaire de la ${weekLabel(weekStart).toLowerCase()} est à transmettre avant le ${formatDeadline(weekStart)}.`,
      overdue
        ? "Merci de le rendre dès que possible depuis votre espace : il sera enregistré comme rendu en retard."
        : "Pensez à indiquer votre temps d'étude, les cours travaillés, votre compte-rendu et vos objectifs.",
      "",
      `Votre espace étudiant : ${portal}`,
      `Immatriculation : ${student.registration}`,
      "",
      "Votre formateur – JZ KALYPHOR",
    ].join("\n");
    openWhatsApp(student, message);
    notify(
      overdue
        ? `Relance de bilan en retard préparée pour ${student.name}.`
        : `Rappel d'échéance préparé pour ${student.name}.`,
      "info",
    );
  }

  function inspectReport(studentId: string, courseId: string) {
    updateProgress(studentId, courseId, (current) => ({
      ...current,
      reviewedAt: current.reviewedAt || new Date().toISOString(),
    }));
    setModal({ type: "inspect", studentId, courseId });
  }

  function startTour(kind: "admin" | "student" | "course") {
    setHelpOpen(false);
    setModal(null);
    setTour(kind);
  }

  function finishTour() {
    if (tour === "admin") setGuide((g) => ({ ...g, adminTourDone: true }));
    if (tour === "student" && currentStudent)
      setGuide((g) => ({
        ...g,
        studentTourDone: { ...g.studentTourDone, [currentStudent.id]: true },
      }));
    if (tour === "course" && currentStudent)
      setGuide((g) => ({
        ...g,
        courseTourDone: { ...g.courseTourDone, [currentStudent.id]: true },
      }));
    setTour(null);
    setMobileNavOpen(false);
  }

  const handleTourStep = useCallback((step: TourStep) => {
    setMobileNavOpen(!!step.requiresNav);
  }, []);

  // Première visite : la visite guidée se lance automatiquement, une seule fois par espace.
  useEffect(() => {
    if (!session || modal || tour) return;
    if (
      session.role === "admin" &&
      !guide.adminTourDone &&
      adminView === "overview"
    ) {
      const timer = window.setTimeout(() => setTour("admin"), 700);
      return () => window.clearTimeout(timer);
    }
    if (session.role === "student" && currentStudent) {
      if (
        studentView === "courses" &&
        !guide.studentTourDone[currentStudent.id]
      ) {
        const timer = window.setTimeout(() => setTour("student"), 700);
        return () => window.clearTimeout(timer);
      }
      if (
        studentView === "course" &&
        !guide.courseTourDone[currentStudent.id]
      ) {
        const timer = window.setTimeout(() => setTour("course"), 700);
        return () => window.clearTimeout(timer);
      }
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, adminView, studentView, currentStudent?.id, guide, modal, tour]);

  /**
   * Notification d'un nouveau cours. Seul le lien de l'espace étudiant JZ KALYPHOR
   * est communiqué : l'URL de la plateforme externe n'est jamais transmise par
   * message, l'étudiant la découvre en cliquant sur le bouton d'accès dans son cours.
   */
  function shareCourse(student: Student, course: Course) {
    const portal = resolvePortalUrl(data.settings);
    const message = [
      `Bonjour ${student.name},`,
      "",
      `Un nouveau cours vous attend dans votre espace JZ KALYPHOR : « ${course.title} ».`,
      "",
      portal
        ? `Connectez-vous ici : ${portal}`
        : "Connectez-vous à votre espace étudiant.",
      `Nom complet : ${student.name}`,
      `Immatriculation : ${student.registration}`,
      "",
      "Ouvrez le cours depuis votre espace pour accéder à la ressource, déclarer votre temps d'étude et transmettre votre compte-rendu.",
      "",
      "Votre formateur – JZ KALYPHOR",
    ].join("\n");
    openWhatsApp(student, message);
    notify(`Notification du cours envoyée à ${student.name}.`, "info");
  }

  function remindStudent(student: Student) {
    const pending =
      assignments.find(
        (item) =>
          item.student.id === student.id &&
          item.progress.status === "in_progress",
      ) ||
      assignments.find(
        (item) =>
          item.student.id === student.id &&
          item.progress.status === "not_started",
      );
    const portal = resolvePortalUrl(data.settings);
    const footer = portal
      ? `\n\nVotre espace étudiant : ${portal}\nImmatriculation : ${student.registration}`
      : `\n\nImmatriculation : ${student.registration}`;
    const message = !student.active
      ? `Bonjour ${student.name}, votre accès à la plateforme JZ KALYPHOR est actuellement suspendu. Merci de prendre contact avec votre formateur pour faire le point sur votre parcours et rétablir votre accès.`
      : pending
        ? `Bonjour ${student.name}, votre formateur JZ KALYPHOR constate que le rapport pour le cours « ${pending.course.title} » n'a pas encore été rendu. Merci de finaliser votre temps d'étude, votre compte-rendu et vos preuves dès que possible. Nous restons disponibles si vous avez besoin d'aide.${footer}`
        : `Bonjour ${student.name}, félicitations pour votre progression sur JZ KALYPHOR. Continuez à consulter votre espace pour découvrir vos prochaines ressources. Votre formateur reste à votre écoute.${footer}`;
    openWhatsApp(student, message);
    notify(`Relance WhatsApp préparée pour ${student.name}.`, "info");
  }

  function openStudentCourse(courseId: string) {
    if (!currentStudent) return;
    updateProgress(currentStudent.id, courseId, (progress) => ({
      ...progress,
      status:
        progress.status === "not_started" ? "in_progress" : progress.status,
    }));
    setSelectedCourseId(courseId);
    setStudentView("course");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function submitReport() {
    if (!currentStudent || !currentCourse) return;
    const progress = getProgress(data, currentStudent.id, currentCourse.id);
    const timerElapsed =
      progress.timerSeconds +
      (progress.timerStartedAt
        ? Math.max(0, Math.floor((Date.now() - progress.timerStartedAt) / 1000))
        : 0);
    const totalMinutes =
      progress.hours * 60 +
      progress.minutes +
      (timerElapsed ? Math.ceil(timerElapsed / 60) : 0);
    if (totalMinutes < 1) {
      notify("Indiquez au moins une minute d'étude avant l'envoi.", "error");
      return;
    }
    if (progress.report.trim().length < 20) {
      notify("Rédigez un compte-rendu d'au moins 20 caractères.", "error");
      return;
    }
    if (!progress.proofs.length) {
      notify("Ajoutez au moins une capture ou un PDF comme preuve.", "error");
      return;
    }
    const submittedProgress: Progress = {
      ...progress,
      hours: Math.floor(totalMinutes / 60),
      minutes: totalMinutes % 60,
      timerSeconds: 0,
      timerStartedAt: undefined,
      report: progress.report.trim(),
      status: "submitted",
      submittedAt: new Date().toISOString(),
    };
    if (REMOTE) {
      // Envoi immédiat : le rapport est daté et figé côté serveur.
      const key = `${currentStudent.id}/${currentCourse.id}`;
      pendingProgressRef.current.delete(key);
      dirtyProgressRef.current.delete(key);
      upsertProgressRemote(submittedProgress).catch(() => {
        dirtyProgressRef.current.add(key);
        pendingProgressRef.current.set(key, submittedProgress);
      });
    }
    updateProgress(currentStudent.id, currentCourse.id, () => submittedProgress);
    notify("Votre rapport et vos preuves ont été transmis au formateur.");
  }

  function confirmAction() {
    if (!modal) return;
    if (modal.type === "deleteStudent") {
      const student = data.students.find((item) => item.id === modal.id);
      if (REMOTE) {
        deleteStudentRemote(modal.id).catch(() =>
          notify("Suppression en ligne impossible pour le moment.", "error"),
        );
      }
      setData((current) => ({
        ...current,
        students: current.students.filter((item) => item.id !== modal.id),
        progress: current.progress.filter(
          (item) => item.studentId !== modal.id,
        ),
        weeklyReports: current.weeklyReports.filter(
          (item) => item.studentId !== modal.id,
        ),
        courses: current.courses
          .filter((item) => item.target !== modal.id)
          .map((item) => {
            if (!item.externalCredentials?.[modal.id]) return item;
            const credentials = { ...item.externalCredentials };
            delete credentials[modal.id];
            return { ...item, externalCredentials: credentials };
          }),
      }));
      notify(
        `${student?.name || "L'étudiant"} et ses données ont été supprimés.`,
        "info",
      );
    } else if (modal.type === "deleteCourse") {
      const course = data.courses.find((item) => item.id === modal.id);
      if (REMOTE) {
        deleteCourseRemote(modal.id).catch(() =>
          notify("Suppression en ligne impossible pour le moment.", "error"),
        );
      }
      setData((current) => ({
        ...current,
        courses: current.courses.filter((item) => item.id !== modal.id),
        progress: current.progress.filter((item) => item.courseId !== modal.id),
      }));
      notify(
        `Le cours « ${course?.title || "sélectionné"} » a été supprimé.`,
        "info",
      );
    } else if (modal.type === "reset") {
      setData(seedData());
      setSession(null);
      setAdminView("overview");
      setStudentView("courses");
      setSelectedCourseId(null);
      notify("Les données initiales de la plateforme ont été restaurées.");
    }
    setModal(null);
  }

  function renderModal() {
    if (!modal) return null;
    if (modal.type === "studentForm")
      return (
        <StudentFormModal
          students={data.students}
          onClose={() => setModal(null)}
          onSave={saveStudent}
        />
      );
    if (modal.type === "courseForm")
      return (
        <CourseFormModal
          students={data.students}
          onClose={() => setModal(null)}
          onSave={saveCourse}
        />
      );
    if (modal.type === "externalCredentials") {
      const course = data.courses.find((item) => item.id === modal.courseId);
      return course ? (
        <ExternalCredentialsModal
          course={course}
          students={data.students}
          onClose={() => setModal(null)}
          onSave={saveExternalCredentials}
        />
      ) : null;
    }
    if (modal.type === "inspect") {
      const assignment = assignments.find(
        (item) =>
          item.student.id === modal.studentId &&
          item.course.id === modal.courseId,
      );
      return assignment ? (
        <InspectModal assignment={assignment} onClose={() => setModal(null)} />
      ) : null;
    }
    if (modal.type === "inspectWeekly") {
      const report = data.weeklyReports.find(
        (item) => item.id === modal.reportId,
      );
      const student =
        report && data.students.find((item) => item.id === report.studentId);
      return report && student ? (
        <WeeklyInspectModal
          report={report}
          student={student}
          courses={data.courses}
          onClose={() => setModal(null)}
        />
      ) : null;
    }
    if (modal.type === "deleteStudent")
      return (
        <ConfirmModal
          eyebrow="SUPPRESSION DÉFINITIVE"
          title="Supprimer cet étudiant ?"
          text="Son compte, ses rapports et ses preuves seront supprimés. Les cours qui lui sont exclusivement attribués seront également retirés."
          confirmLabel="Supprimer l'étudiant"
          dangerous
          onClose={() => setModal(null)}
          onConfirm={confirmAction}
        />
      );
    if (modal.type === "deleteCourse")
      return (
        <ConfirmModal
          eyebrow="SUPPRESSION DÉFINITIVE"
          title="Supprimer ce cours ?"
          text="Ce cours ainsi que les temps d'étude, comptes-rendus et preuves associés seront définitivement supprimés."
          confirmLabel="Supprimer le cours"
          dangerous
          onClose={() => setModal(null)}
          onConfirm={confirmAction}
        />
      );
    return (
      <ConfirmModal
        eyebrow="MAINTENANCE DE LA PLATEFORME"
        title="Restaurer les données initiales ?"
        text="Tous les étudiants, cours, accès externes, temps d'étude et fichiers enregistrés sur cet appareil seront effacés, puis la configuration initiale sera restaurée. Cette action est irréversible."
        confirmLabel="Restaurer les données initiales"
        onClose={() => setModal(null)}
        onConfirm={confirmAction}
      />
    );
  }

  if (REMOTE && booting)
    return (
      <div className="boot-screen">
        <Brand large />
        <p>Connexion à votre espace sécurisé…</p>
        <span className="boot-spinner" aria-hidden="true" />
      </div>
    );

  if (!session || (session.role === "student" && !currentStudent?.active))
    return (
      <>
        <LoginScreen onLogin={login} />
        {renderModal()}
        <ToastStack
          toasts={toasts}
          dismiss={(id) =>
            setToasts((current) => current.filter((item) => item.id !== id))
          }
        />
      </>
    );

  const isAdmin = session.role === "admin";
  const view = isAdmin ? adminView : studentView;
  const pageTitle = isAdmin
    ? {
        overview: "Vue d'ensemble",
        students: "Étudiants",
        courses: "Cours & ressources",
        tracking: "Suivi & rapports",
        weekly: "Bilans hebdomadaires",
      }[adminView]
    : studentView === "weekly"
      ? "Bilan hebdomadaire"
      : studentView === "progress"
        ? "Mon parcours"
        : studentView === "course"
          ? "Mon cours"
          : "Mes cours";
  const displayName = isAdmin ? ADMIN_NAME : currentStudent!.name;
  const pendingCourseReviews = assignments.filter(
    (item) => item.progress.status === "submitted" && !item.progress.reviewedAt,
  ).length;
  const pendingWeeklyReviews = data.weeklyReports.filter(
    (item) => item.submittedAt && !item.reviewedAt,
  ).length;
  const pendingReviews = pendingCourseReviews + pendingWeeklyReviews;
  const currentWeek = weekKeyOf(new Date(now));
  const studentWeeklyReports = currentStudent
    ? data.weeklyReports.filter((item) => item.studentId === currentStudent.id)
    : [];
  const studentCurrentReport = studentWeeklyReports.find(
    (item) => item.weekStart === currentWeek,
  );
  const studentMissedWeeks = currentStudent
    ? studentWeeks(currentStudent, now).filter(
        (week) =>
          weeklyStatus(
            studentWeeklyReports.find((item) => item.weekStart === week),
            week,
            now,
          ) === "missing",
      ).length
    : 0;
  const sidebarBadges: Record<string, string | number> = isAdmin
    ? {
        ...(pendingCourseReviews ? { tracking: pendingCourseReviews } : {}),
        ...(pendingWeeklyReviews ? { weekly: pendingWeeklyReviews } : {}),
      }
    : weeklyStatus(studentCurrentReport, currentWeek, now) === "pending"
      ? { weekly: "!" }
      : {};
  const checklistItems: ChecklistItem[] = [
    {
      id: "student",
      label: "Inscrire un premier étudiant",
      hint: "Nom, WhatsApp et mois d'adhésion : l'immatriculation est générée pour vous.",
      done: data.students.length > 0,
      actionLabel: "Ajouter",
      onAction: () => setModal({ type: "studentForm" }),
    },
    {
      id: "access",
      label: "Envoyer les accès à chaque étudiant",
      hint: "Un clic ouvre WhatsApp avec l'immatriculation et le lien de l'espace étudiant.",
      done:
        data.students.length > 0 &&
        data.students.every((student) => student.accessSentAt),
      actionLabel: "Voir les étudiants",
      onAction: () => setAdminView("students"),
    },
    {
      id: "course",
      label: "Publier un premier cours",
      hint: "Vidéo, plateforme ou document, diffusé à tous, à une cohorte ou à une personne.",
      done: data.courses.length > 0,
      actionLabel: "Publier",
      onAction: () => setModal({ type: "courseForm" }),
    },
    {
      id: "review",
      label: "Inspecter un rapport transmis",
      hint: "Temps déclaré, compte-rendu et preuves de visionnage, au même endroit.",
      done: data.progress.some((item) => item.reviewedAt),
      actionLabel: "Ouvrir le suivi",
      onAction: () => {
        setTrackingFilter("submitted");
        setAdminView("tracking");
      },
    },
  ];
  const tourSteps =
    tour === "admin"
      ? ADMIN_TOUR
      : tour === "student"
        ? STUDENT_TOUR
        : COURSE_TOUR;

  return (
    <div className="app-shell">
      <Sidebar
        role={isAdmin ? "admin" : "student"}
        activeView={view}
        studentName={currentStudent?.name}
        studentRegistration={currentStudent?.registration}
        onNavigate={(next) => {
          if (isAdmin) setAdminView(next as AdminView);
          else setStudentView(next as StudentView);
          window.scrollTo({ top: 0, behavior: "smooth" });
        }}
        onLogout={logout}
        open={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
        badges={sidebarBadges}
      />
      <main className="workspace">
        <Topbar
          title={pageTitle}
          role={isAdmin ? "admin" : "student"}
          name={displayName}
          onMenu={() => setMobileNavOpen(true)}
          onHelp={() => setHelpOpen(true)}
          remote={REMOTE}
          pendingReviews={isAdmin ? pendingReviews : 0}
          onPendingClick={() => {
            if (pendingCourseReviews) {
              setTrackingFilter("submitted");
              setAdminView("tracking");
            } else {
              setAdminView("weekly");
            }
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
        />
        <div className="workspace-content" key={view}>
          {isAdmin && adminView === "overview" && (
            <AdminOverview
              assignments={assignments}
              studentsCount={data.students.length}
              cohortsCount={listCohorts(data.students).length}
              coursesCount={data.courses.length}
              onNavigate={setAdminView}
              onInspect={inspectReport}
              onCreateCourse={() => setModal({ type: "courseForm" })}
              weeklyBanner={
                <AdminWeeklyBanner
                  students={data.students}
                  reports={data.weeklyReports}
                  now={now}
                  onOpen={() => setAdminView("weekly")}
                />
              }
              checklist={
                !guide.checklistHidden && (
                  <OnboardingChecklist
                    items={checklistItems}
                    onHide={() =>
                      setGuide((g) => ({ ...g, checklistHidden: true }))
                    }
                  />
                )
              }
            />
          )}
          {isAdmin && adminView === "students" && (
            <AdminStudents
              students={data.students}
              assignments={assignments}
              portalUrl={data.settings.portalUrl}
              cohortFilter={cohortFilter}
              setCohortFilter={setCohortFilter}
              onSendAccess={sendAccess}
              onSavePortalUrl={savePortalUrl}
              query={studentQuery}
              setQuery={setStudentQuery}
              filter={studentFilter}
              setFilter={setStudentFilter}
              onAdd={() => setModal({ type: "studentForm" })}
              onToggle={toggleStudent}
              onDelete={(student) =>
                setModal({ type: "deleteStudent", id: student.id })
              }
              onRemind={remindStudent}
            />
          )}
          {isAdmin && adminView === "courses" && (
            <AdminCourses
              courses={data.courses}
              students={data.students}
              assignments={assignments}
              onAdd={() => setModal({ type: "courseForm" })}
              onCredentials={(course) =>
                setModal({ type: "externalCredentials", courseId: course.id })
              }
              onDelete={(course) =>
                setModal({ type: "deleteCourse", id: course.id })
              }
            />
          )}
          {isAdmin && adminView === "tracking" && (
            <AdminTracking
              assignments={assignments}
              query={trackingQuery}
              setQuery={setTrackingQuery}
              filter={trackingFilter}
              setFilter={setTrackingFilter}
              onInspect={inspectReport}
              onShare={shareCourse}
            />
          )}
          {isAdmin && adminView === "weekly" && (
            <AdminWeekly
              students={data.students}
              reports={data.weeklyReports}
              now={now}
              onInspect={inspectWeekly}
              onRemind={remindWeekly}
            />
          )}
          {!isAdmin && currentStudent && studentView === "courses" && (
            <StudentHome
              student={currentStudent}
              assignments={studentAssignments}
              onOpen={openStudentCourse}
              weeklyBanner={
                <WeeklyDeadlineBanner
                  report={studentCurrentReport}
                  missedCount={studentMissedWeeks}
                  now={now}
                  onOpen={() => {
                    setStudentView("weekly");
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                />
              }
            />
          )}
          {!isAdmin && currentStudent && studentView === "weekly" && (
            <StudentWeekly
              student={currentStudent}
              courses={studentAssignments.map((item) => item.course)}
              reports={studentWeeklyReports}
              now={now}
              onUpdate={(weekStart, updater) =>
                updateWeekly(currentStudent.id, weekStart, updater)
              }
              onSubmit={submitWeekly}
              onNotify={notify}
            />
          )}
          {!isAdmin && currentStudent && studentView === "progress" && (
            <StudentProgress
              assignments={studentAssignments}
              onOpen={openStudentCourse}
            />
          )}
          {!isAdmin &&
            currentStudent &&
            studentView === "course" &&
            currentCourse && (
              <StudentCourse
                key={currentCourse.id}
                course={currentCourse}
                progress={getProgress(
                  data,
                  currentStudent.id,
                  currentCourse.id,
                )}
                studentId={currentStudent.id}
                onBack={() => setStudentView("courses")}
                onUpdate={updateProgress}
                onSubmit={submitReport}
                onNotify={notify}
                dataSize={JSON.stringify(data).length}
              />
            )}
        </div>
        <footer className="workspace-footer">
          <span>
            © {new Date().getFullYear()} JZ KALYPHOR · Votre avenir, votre
            trajectoire.
          </span>
          {isAdmin && (
            <button
              type="button"
              className="footer-maintenance"
              onClick={() => setModal({ type: "reset" })}
            >
              <Icon name="reset" size={12} />
              Restaurer les données initiales
            </button>
          )}
        </footer>
      </main>
      {renderModal()}
      {helpOpen && (
        <HelpPanel
          role={isAdmin ? "admin" : "student"}
          onClose={() => setHelpOpen(false)}
          onStartTour={() => {
            if (isAdmin) {
              setAdminView("overview");
              startTour("admin");
            } else if (studentView === "course") {
              startTour("course");
            } else {
              setStudentView("courses");
              startTour("student");
            }
          }}
        />
      )}
      {tour && (
        <GuidedTour
          steps={tourSteps}
          onStep={handleTourStep}
          onClose={finishTour}
        />
      )}
      <ToastStack
        toasts={toasts}
        dismiss={(id) =>
          setToasts((current) => current.filter((item) => item.id !== id))
        }
      />
    </div>
  );
}

