import assert from "node:assert/strict";
import { chromium } from "playwright";

const viteUrl = process.env.VITE_URL || "http://127.0.0.1:5180/";
const standaloneUrl =
  process.env.STANDALONE_URL || "http://127.0.0.1:5181/jz-kalyphor.html";
const ADMIN = { name: "Yves Jonathan", password: "Admin2026@JZ" };
const AMINA = { name: "Amina Diallo", registration: "AD-2026-09" };
const now = new Date();
const currentCohort = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
const fatouRegistration = `FB-${currentCohort}`;
const portalUrl = "https://espace.jz-kalyphor.com/";

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
});
const errors = [];

/** Connexion formateur via l'onglet dédié. */
async function loginAdmin(page) {
  await page.getByRole("tab", { name: "Formateur" }).click();
  await page.getByLabel("Identifiant formateur").fill(ADMIN.name);
  await page.getByLabel("Mot de passe", { exact: true }).fill(ADMIN.password);
  await page.getByRole("button", { name: "Accéder à mon espace" }).click();
  await page.getByRole("heading", { name: "Bonjour, Yves Jonathan" }).waitFor();
}

/** Connexion étudiant : nom complet + immatriculation. */
async function loginStudent(page, name, registration) {
  await page.getByLabel("Nom complet").fill(name);
  await page.getByLabel("Immatriculation").fill(registration);
  await page.getByRole("button", { name: "Accéder à mon espace" }).click();
}

/** Ferme la visite guidée si elle est affichée. */
async function dismissTour(page) {
  const skip = page.locator(".tour-skip");
  try {
    await skip.waitFor({ timeout: 2500 });
    await skip.click();
    await page.locator(".tour-layer").waitFor({ state: "hidden" });
  } catch {
    /* No tour displayed. */
  }
}

async function logout(page) {
  await page.getByRole("button", { name: "Se déconnecter" }).click();
  await page
    .getByRole("heading", { name: "Heureux de vous retrouver." })
    .waitFor();
}

/** Capture l'URL wa.me ouverte par l'application. */
async function captureWhatsApp(page, trigger) {
  await page.evaluate(() => {
    window.__whatsappUrl = "";
    window.open = (url) => {
      window.__whatsappUrl = String(url);
      return null;
    };
  });
  await trigger();
  const url = await page.evaluate(() => window.__whatsappUrl);
  assert.match(url, /^https:\/\/wa\.me\/\d+\?text=/);
  return {
    url,
    message: decodeURIComponent(url.split("?text=")[1]),
  };
}

try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: true,
  });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: new URL(viteUrl).origin,
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(`Vite: ${error.message}`));
  await page.goto(viteUrl, { waitUntil: "domcontentloaded" });
  await page
    .getByRole("heading", { name: "Heureux de vous retrouver." })
    .waitFor();

  // 1. La page de connexion n'expose aucun accès.
  const loginText = await page.locator("body").innerText();
  for (const secret of [
    ADMIN.password,
    AMINA.registration,
    "KM-2026-10",
    "DÉMONSTRATION",
    "Amina Diallo",
    "Kouassi Marc",
  ]) {
    assert.ok(
      !loginText.includes(secret),
      `Login page must not expose: ${secret}`,
    );
  }
  assert.equal(
    await page.getByLabel("Mot de passe", { exact: true }).count(),
    0,
  );

  // 2. Erreurs de connexion claires.
  await loginStudent(page, AMINA.name, "AD-2020-01");
  assert.match(await page.locator(".form-error").innerText(), /incorrect/);
  await page.getByRole("tab", { name: "Formateur" }).click();
  await page.getByLabel("Identifiant formateur").fill(ADMIN.name);
  await page.getByLabel("Mot de passe", { exact: true }).fill("mauvais");
  await page.getByRole("button", { name: "Accéder à mon espace" }).click();
  assert.match(await page.locator(".form-error").innerText(), /incorrect/);

  // 3. Espace formateur.
  await page.getByLabel("Mot de passe", { exact: true }).fill(ADMIN.password);
  await page.getByRole("button", { name: "Accéder à mon espace" }).click();
  await page.getByRole("heading", { name: "Bonjour, Yves Jonathan" }).waitFor();
  assert.match(await page.locator(".kpi-grid").innerText(), /2 \/ 6/);
  assert.match(await page.locator(".kpi-grid").innerText(), /2 cohortes/);

  // 3b. Visite guidée automatique au premier accès : parcours complet.
  const tourCard = page.locator(".tour-card");
  await tourCard.waitFor({ timeout: 5000 });
  assert.match(await tourCard.innerText(), /Étape 1 \/ 7/);
  assert.match(await tourCard.innerText(), /indicateurs/);
  for (let step = 1; step < 7; step += 1) {
    await tourCard.getByRole("button", { name: "Suivant" }).click();
    await page.getByText(`Étape ${step + 1} / 7`).waitFor();
  }
  await tourCard.getByRole("button", { name: "Terminer" }).click();
  await page.locator(".tour-layer").waitFor({ state: "hidden" });

  // Checklist de démarrage : 2 étapes restantes (accès, inspection).
  const checklist = page.locator(".checklist");
  assert.match(await checklist.innerText(), /2\/4/);
  assert.match(
    await checklist.innerText(),
    /Prochaine étape : Envoyer les accès/,
  );
  assert.match(
    await page.locator(".pending-chip").innerText(),
    /3 rapports à inspecter/,
  );

  // Bannière hebdomadaire de la vue d'ensemble.
  const weeklyOverview = page.locator(".weekly-overview");
  assert.match(
    await weeklyOverview.innerText(),
    /0 \/ 2 bilans reçus cette semaine/,
  );
  assert.match(await weeklyOverview.innerText(), /dimanche .* à 23:59/);
  assert.match(await weeklyOverview.innerText(), /1 en retard/);

  // Panneau d'aide : FAQ et relance de la visite.
  await page
    .getByRole("button", { name: "Ouvrir le guide d'utilisation" })
    .click();
  const help = page.getByRole("dialog", { name: "Guide d'utilisation" });
  await help.getByText("Comment inscrire un étudiant ?").click();
  assert.match(await help.innerText(), /immatriculation/);
  await help.getByRole("button", { name: /Relancer la visite guidée/ }).click();
  await tourCard.waitFor();
  await page.locator(".tour-skip").click();
  await page.locator(".tour-layer").waitFor({ state: "hidden" });

  // 4. Lien de l'espace étudiant (adresse officielle par défaut, personnalisable).
  await page.getByRole("button", { name: "Étudiants", exact: true }).click();
  assert.equal(
    await page.getByLabel("Lien de l'espace étudiant").inputValue(),
    "https://jzkalyphorpedagogie.netlify.app",
  );
  const defaultAccess = await captureWhatsApp(page, () =>
    page
      .locator("tr")
      .filter({ hasText: "Amina Diallo" })
      .getByRole("button", { name: "Envoyer les accès" })
      .click(),
  );
  assert.ok(defaultAccess.message.includes("https://jzkalyphorpedagogie.netlify.app"));
  await page.getByLabel("Lien de l'espace étudiant").fill("pas-une-url");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  assert.match(await page.locator(".portal-error").innerText(), /https/);
  await page.getByLabel("Lien de l'espace étudiant").fill(portalUrl);
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await page
    .getByText("Le lien de l'espace étudiant a été enregistré.")
    .waitFor();

  // 5. Inscription avec immatriculation générée.
  assert.match(
    await page.locator(".students-table").innerText(),
    /Cohorte 2026-09/,
  );
  assert.match(
    await page.locator(".students-table").innerText(),
    /Cohorte 2026-10/,
  );
  await page.getByRole("button", { name: "Ajouter un étudiant" }).click();
  const studentDialog = page.getByRole("dialog", {
    name: "Ajouter un étudiant",
  });
  assert.equal(await studentDialog.getByLabel(/mot de passe/i).count(), 0);
  await studentDialog
    .getByRole("textbox", { name: "Nom complet" })
    .fill("Fatou Bamba");
  await studentDialog.getByText(fatouRegistration).waitFor();
  await studentDialog
    .getByRole("textbox", { name: "Numéro WhatsApp" })
    .fill("+225 07 00 01 23 45");
  await studentDialog
    .getByRole("button", { name: "Créer l'inscription" })
    .click();
  const fatouRow = page.locator("tr").filter({ hasText: "Fatou Bamba" });
  await fatouRow.waitFor();
  assert.match(await fatouRow.innerText(), new RegExp(fatouRegistration));

  // Homonymie : une 2e "F. B." dans la même cohorte reçoit un indice.
  await page.getByRole("button", { name: "Ajouter un étudiant" }).click();
  await studentDialog
    .getByRole("textbox", { name: "Nom complet" })
    .fill("Fanta Bakayoko");
  await studentDialog.getByText(`${fatouRegistration}-2`).waitFor();
  await studentDialog.getByRole("button", { name: "Annuler" }).click();

  // 6. Envoi des accès et relance WhatsApp.
  const access = await captureWhatsApp(page, () =>
    fatouRow.getByRole("button", { name: "Envoyer les accès" }).click(),
  );
  assert.match(access.url, /wa\.me\/2250700012345/);
  assert.ok(access.message.includes(`Immatriculation : ${fatouRegistration}`));
  assert.ok(access.message.includes(portalUrl));
  assert.ok(access.message.includes(`Cohorte ${currentCohort}`));
  assert.match(await fatouRow.innerText(), /Accès envoyés le/);
  assert.ok(access.message.includes("avant le dimanche 23:59"));
  const reminder = await captureWhatsApp(page, () =>
    fatouRow.getByRole("button", { name: "Relancer" }).click(),
  );
  assert.match(reminder.message, /rapport pour le cours/);

  // Filtre par cohorte.
  await page.getByLabel("Filtrer par cohorte").selectOption("2026-09");
  assert.equal(
    await page
      .locator(".students-table tr:not(.cohort-row) td .person-cell")
      .count(),
    1,
  );
  await page.getByLabel("Filtrer par cohorte").selectOption("all");

  // 7. Suspension bloque la connexion.
  await fatouRow.getByRole("button", { name: "Suspendre" }).click();
  assert.match(await fatouRow.innerText(), /Suspendu/);
  await logout(page);
  await loginStudent(page, "Fatou Bamba", fatouRegistration);
  assert.match(await page.locator(".form-error").innerText(), /suspendu/);
  await loginAdmin(page);
  await page.getByRole("button", { name: "Étudiants", exact: true }).click();
  await page
    .locator("tr")
    .filter({ hasText: "Fatou Bamba" })
    .getByRole("button", { name: "Activer" })
    .click();

  // 8. Publication ciblée (cohorte puis étudiant) avec accès externes.
  await page
    .getByRole("button", { name: "Cours & ressources", exact: true })
    .click();
  await page.getByRole("button", { name: "Publier un cours" }).click();
  const courseDialog = page.getByRole("dialog", { name: "Publier un cours" });
  await courseDialog
    .getByRole("textbox", { name: "Titre du cours" })
    .fill("Atelier de rentrée");
  await courseDialog
    .getByRole("textbox", { name: "Description & consignes" })
    .fill("Visionnez l'atelier d'accueil réservé à votre cohorte.");
  await courseDialog
    .getByRole("textbox", { name: "URL de la ressource" })
    .fill("https://www.youtube.com/watch?v=iU2yx3L-cXI");
  await courseDialog
    .getByRole("combobox", { name: "Diffuser à" })
    .selectOption("cohort:2026-09");
  await courseDialog.getByRole("button", { name: "Publier le cours" }).click();
  assert.match(
    await page
      .locator("tr")
      .filter({ hasText: "Atelier de rentrée" })
      .innerText(),
    /Cohorte 2026-09/,
  );

  await page.getByRole("button", { name: "Publier un cours" }).click();
  await courseDialog
    .getByRole("textbox", { name: "Titre du cours" })
    .fill("Élaborer son plan de communication");
  await courseDialog
    .getByRole("textbox", { name: "Description & consignes" })
    .fill(
      "Lisez la ressource puis rédigez vos trois prochaines actions concrètes.",
    );
  await courseDialog
    .getByRole("button", { name: "Plateforme / lien web" })
    .click();
  await courseDialog
    .getByRole("textbox", { name: "URL de la ressource" })
    .fill("https://www.francenum.gouv.fr/");
  await courseDialog
    .getByRole("combobox", { name: "Diffuser à" })
    .selectOption({ label: `Fatou Bamba · ${fatouRegistration}` });
  await courseDialog
    .getByRole("textbox", {
      name: "E-mail ou nom d'utilisateur externe pour Fatou Bamba",
    })
    .fill("fatou@formation-externe.test");
  await courseDialog.getByRole("button", { name: "Publier le cours" }).click();
  assert.match(
    await courseDialog.locator(".form-error").innerText(),
    /e-mail .*mot de passe/,
  );
  await courseDialog
    .getByLabel("Mot de passe de la plateforme externe pour Fatou Bamba")
    .fill("Externe2026!");
  await courseDialog.getByRole("button", { name: "Publier le cours" }).click();
  await page
    .getByText("Élaborer son plan de communication", { exact: true })
    .waitFor();
  await page
    .locator("tr")
    .filter({ hasText: "Élaborer son plan de communication" })
    .getByRole("button", {
      name: "Gérer les identifiants externes de Élaborer son plan de communication",
    })
    .click();
  const credentialsDialog = page.getByRole("dialog", {
    name: "Gérer les identifiants externes",
  });
  await credentialsDialog
    .getByLabel("Mot de passe de la plateforme externe pour Fatou Bamba")
    .fill("NouveauExterne2026!");
  await credentialsDialog
    .getByRole("button", { name: "Enregistrer les accès" })
    .click();

  // 9. Suivi : envoi du lien d'un cours et inspection d'un rapport.
  await page
    .getByRole("button", { name: "Suivi & rapports", exact: true })
    .click();
  const share = await captureWhatsApp(page, () =>
    page
      .locator("tr")
      .filter({ hasText: "Fatou Bamba" })
      .filter({ hasText: "Élaborer son plan de communication" })
      .getByRole("button", { name: /Notifier le cours/ })
      .click(),
  );
  // Le lien externe du cours ne doit jamais apparaître dans un message WhatsApp.
  assert.ok(!share.message.includes("francenum.gouv.fr"));
  assert.ok(share.message.includes("Élaborer son plan de communication"));
  assert.ok(share.message.includes(portalUrl));
  assert.ok(share.message.includes(fatouRegistration));
  for (const text of [access.message, reminder.message, share.message]) {
    assert.ok(
      !/youtube\.com|francenum|\.pdf/i.test(text),
      "external link leaked",
    );
  }
  const aminaReport = page
    .locator("tr")
    .filter({ hasText: "Amina Diallo" })
    .filter({ hasText: "Les fondamentaux du marketing digital" });
  await aminaReport.getByRole("button", { name: "Inspecter" }).click();
  const inspection = page.getByRole("dialog", {
    name: "Rapport de Amina Diallo",
  });
  assert.match(await inspection.innerText(), /capture-visionnage/);
  await inspection
    .getByRole("button", { name: "Prévisualiser capture-visionnage.svg" })
    .first()
    .click();
  await inspection
    .getByRole("dialog", { name: "Aperçu de capture-visionnage.svg" })
    .waitFor();
  await inspection.getByRole("button", { name: "Fermer l'aperçu" }).click();
  await inspection.getByRole("button", { name: "Fermer l'inspection" }).click();
  assert.match(await aminaReport.innerText(), /Inspecté/);
  assert.match(
    await page.locator(".pending-chip").innerText(),
    /2 rapports à inspecter/,
  );

  // 10. Parcours étudiant complet.
  await logout(page);
  await loginStudent(page, "fatou bamba", fatouRegistration.toLowerCase());
  await page.getByRole("heading", { name: "Bonjour, Fatou" }).waitFor();
  await dismissTour(page);
  assert.match(
    await page.locator(".identity-chips").innerText(),
    new RegExp(fatouRegistration),
  );
  assert.equal(await page.locator(".student-course-row").count(), 4);
  assert.match(await page.locator(".next-action").innerText(), /Commencer/);

  await page
    .locator(".student-course-row")
    .filter({ hasText: "Élaborer son plan de communication" })
    .click();
  // Visite guidée du cours : parcours complet des 6 étapes.
  const courseTour = page.locator(".tour-card");
  await courseTour.waitFor({ timeout: 5000 });
  for (let step = 1; step < 6; step += 1) {
    await courseTour.getByRole("button", { name: "Suivant" }).click();
    await page.getByText(`Étape ${step + 1} / 6`).waitFor();
  }
  await courseTour.getByRole("button", { name: "Terminer" }).click();
  await page.locator(".tour-layer").waitFor({ state: "hidden" });
  assert.match(await page.locator(".submit-note").innerText(), /Il reste à/);
  assert.equal(await page.locator(".course-step.step-done").count(), 0);
  await page
    .getByRole("button", {
      name: "Copier l'e-mail ou le nom d'utilisateur de la plateforme externe",
    })
    .click();
  assert.equal(
    await page.evaluate(() => navigator.clipboard.readText()),
    "fatou@formation-externe.test",
  );
  assert.equal(await page.getByText("NouveauExterne2026!").count(), 0);
  await page
    .getByRole("button", { name: "Afficher le mot de passe externe" })
    .click();
  await page.getByText("NouveauExterne2026!").waitFor();
  await page
    .getByRole("button", {
      name: "Copier le mot de passe de la plateforme externe",
    })
    .click();
  assert.equal(
    await page.evaluate(() => navigator.clipboard.readText()),
    "NouveauExterne2026!",
  );
  await page.getByRole("button", { name: "Démarrer le chrono" }).click();
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: "Mettre en pause" }).click();
  await page.getByRole("button", { name: "Ajouter au temps" }).click();
  assert.equal(
    await page.locator(".time-fields input").nth(1).inputValue(),
    "1",
  );
  await page.locator(".time-fields input").nth(0).fill("1");
  await page.locator(".time-fields input").nth(1).fill("12");
  await page
    .getByRole("textbox", { name: "Votre compte-rendu de séance" })
    .fill(
      "J'ai étudié le document et préparé trois actions concrètes pour mon projet professionnel. Je vais commencer par définir mon audience, planifier mes contenus et mesurer les résultats.",
    );
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==",
    "base64",
  );
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: "preuve.png", mimeType: "image/png", buffer: png });
  await page.getByText("preuve.png").waitFor();
  assert.equal(await page.locator(".course-step.step-done").count(), 4);
  assert.match(
    await page.locator(".submit-note").innerText(),
    /Transmission officielle/,
  );
  await page.getByRole("button", { name: "Envoyer mon rapport" }).click();
  await page
    .getByRole("button", { name: "Mettre à jour mon rapport" })
    .waitFor();
  await page.reload();
  await page.getByRole("heading", { name: "Bonjour, Fatou" }).waitFor();
  await page.waitForTimeout(1000);
  assert.equal(
    await page.locator(".tour-layer").count(),
    0,
    "tour must not restart",
  );
  assert.match(
    await page
      .locator(".student-course-row")
      .filter({ hasText: "Élaborer son plan de communication" })
      .innerText(),
    /Terminé/,
  );

  // 10b. Bilan hebdomadaire : remise à temps de la semaine en cours.
  const banner = page.locator(".weekly-banner");
  assert.match(
    await banner.innerText(),
    /À rendre avant le dimanche .* à 23:59/,
  );
  assert.match(await banner.innerText(), /Il reste/);
  await banner.getByRole("button", { name: "Rédiger mon bilan" }).click();
  await page
    .getByRole("heading", { name: "Mon bilan de la semaine" })
    .waitFor();
  const hero = page.locator(".weekly-hero");
  assert.match(await hero.innerText(), /SEMAINE EN COURS/);
  assert.match(await hero.innerText(), /À rendre/);
  await page.getByRole("button", { name: "Transmettre mon bilan" }).click();
  await page.getByText("Indiquez votre temps d'étude de la semaine.").waitFor();
  const editor = page.locator(".weekly-editor");
  await editor.getByLabel("Heures").fill("5");
  await editor.getByLabel("Minutes").fill("30");
  await editor
    .getByRole("button", { name: "Élaborer son plan de communication" })
    .click();
  await editor
    .getByLabel("Ce que j'ai appris et réalisé")
    .fill(
      "Cette semaine, j'ai étudié la stratégie de communication et finalisé mon premier rapport de cours avec preuves.",
    );
  await editor
    .getByLabel(/Difficultés rencontrées/)
    .fill("Organiser mes séances d'étude en fin de journée.");
  assert.equal(await editor.locator(".course-step.step-done").count(), 3);
  await editor
    .getByLabel("Objectifs de la semaine prochaine")
    .fill("Démarrer le guide pratique et rendre mon rapport.");
  assert.equal(await editor.locator(".course-step.step-done").count(), 4);
  await page.getByRole("button", { name: "Transmettre mon bilan" }).click();
  await page
    .getByText("Votre bilan hebdomadaire a été transmis à votre formateur.")
    .waitFor();
  assert.match(await hero.innerText(), /Rendu à temps/);
  await page.getByRole("button", { name: "Mettre à jour mon bilan" }).waitFor();

  // 10c. Semaine précédente manquée → remise en retard.
  await logout(page);
  await page.evaluate(() => {
    const key = "jz-kalyphor-platform-v2";
    const data = JSON.parse(localStorage.getItem(key));
    const fatou = data.students.find((item) => item.name === "Fatou Bamba");
    fatou.createdAt = new Date(Date.now() - 15 * 86400000).toISOString();
    localStorage.setItem(key, JSON.stringify(data));
  });
  await page.reload();
  await loginStudent(page, "Fatou Bamba", fatouRegistration);
  await page.getByRole("heading", { name: "Bonjour, Fatou" }).waitFor();
  assert.match(await page.locator(".weekly-banner").innerText(), /non rendu/);
  assert.match(
    await page.locator(".weekly-banner").innerText(),
    /Bilan de la semaine transmis/,
  );
  await page.getByRole("button", { name: "Voir mon bilan" }).click();
  const history = page.locator(".weekly-history-item");
  assert.ok((await history.count()) >= 2);
  assert.match(await history.nth(1).innerText(), /Non rendu/);
  await history.nth(1).click();
  assert.match(
    await page.locator(".weekly-hero").innerText(),
    /SEMAINE PASSÉE/,
  );
  await editor.getByLabel("Heures").fill("2");
  await editor
    .getByRole("button", { name: "Construire une stratégie de contenu" })
    .click();
  await editor
    .getByLabel("Ce que j'ai appris et réalisé")
    .fill(
      "Lecture de la ressource sur la stratégie de contenu et identification de trois formats adaptés à mon projet.",
    );
  await editor
    .getByLabel("Objectifs de la semaine prochaine")
    .fill("Rédiger mon plan de communication complet.");
  await page.getByRole("button", { name: "Transmettre en retard" }).click();
  await page
    .getByText("Bilan transmis. Il est signalé comme rendu en retard.")
    .waitFor();
  assert.match(
    await page.locator(".weekly-hero").innerText(),
    /Rendu en retard/,
  );
  assert.match(await editor.innerText(), /n'est plus modifiable/);
  assert.equal(await editor.locator("textarea:not([disabled])").count(), 0);

  // Amina (cohorte 2026-09) voit l'atelier ciblé, Marc (2026-10) non.
  await logout(page);
  await loginStudent(page, AMINA.name, AMINA.registration);
  await page.getByRole("heading", { name: "Bonjour, Amina" }).waitFor();
  await dismissTour(page);
  assert.equal(await page.locator(".student-course-row").count(), 4);
  await logout(page);
  await loginStudent(page, "Kouassi Marc", "KM-2026-10");
  await page.getByRole("heading", { name: "Bonjour, Kouassi" }).waitFor();
  await dismissTour(page);
  assert.equal(await page.locator(".student-course-row").count(), 3);

  // 11. Inspection du nouveau rapport puis restauration.
  await logout(page);
  await loginAdmin(page);
  await page
    .getByRole("button", { name: "Suivi & rapports", exact: true })
    .click();
  await page
    .locator("tr")
    .filter({ hasText: "Fatou Bamba" })
    .filter({ hasText: "Élaborer son plan de communication" })
    .getByRole("button", { name: "Inspecter" })
    .click();
  assert.match(
    await page
      .getByRole("dialog", { name: "Rapport de Fatou Bamba" })
      .innerText(),
    /preuve.png/,
  );
  await page.getByRole("button", { name: "Fermer l'inspection" }).click();

  // 11b. Suivi hebdomadaire côté formateur.
  await page.getByRole("button", { name: "Bilans hebdo", exact: true }).click();
  await page.getByRole("heading", { name: "Bilans hebdomadaires" }).waitFor();
  const weeklyRow = (name) =>
    page.locator(".weekly-table tr").filter({ hasText: name });
  assert.match(await weeklyRow("Fatou Bamba").innerText(), /Rendu à temps/);
  assert.match(await weeklyRow("Fatou Bamba").innerText(), /5 h 30/);
  assert.match(await weeklyRow("Amina Diallo").innerText(), /À rendre/);
  const weeklyReminder = await captureWhatsApp(page, () =>
    weeklyRow("Amina Diallo")
      .getByRole("button", { name: "Rappel échéance" })
      .click(),
  );
  assert.match(weeklyReminder.message, /bilan hebdomadaire/);
  assert.match(weeklyReminder.message, /dimanche .* à 23:59/);
  assert.ok(weeklyReminder.message.includes(portalUrl));
  assert.ok(!/youtube\.com|francenum|\.pdf/i.test(weeklyReminder.message));
  await weeklyRow("Fatou Bamba")
    .getByRole("button", { name: "Inspecter" })
    .click();
  const weeklyDialog = page.getByRole("dialog", {
    name: "Bilan hebdomadaire de Fatou Bamba",
  });
  assert.match(await weeklyDialog.innerText(), /Organiser mes séances/);
  assert.match(
    await weeklyDialog.innerText(),
    /Élaborer son plan de communication/,
  );
  await weeklyDialog.getByRole("button", { name: "Fermer le bilan" }).click();
  assert.match(await weeklyRow("Fatou Bamba").innerText(), /Revoir/);

  await page.getByRole("button", { name: "Semaine précédente" }).click();
  assert.match(await weeklyRow("Amina Diallo").innerText(), /Rendu à temps/);
  assert.match(await weeklyRow("Kouassi Marc").innerText(), /Rendu en retard/);
  assert.match(await weeklyRow("Fatou Bamba").innerText(), /Rendu en retard/);
  assert.match(await page.locator(".weekly-stat-rate").innerText(), /100%/);
  await weeklyRow("Kouassi Marc")
    .getByRole("button", { name: "Inspecter" })
    .click();
  assert.match(
    await page
      .getByRole("dialog", { name: "Bilan hebdomadaire de Kouassi Marc" })
      .innerText(),
    /Rendu en retard/,
  );
  await page.getByRole("button", { name: "Fermer le bilan" }).click();

  await page.locator(".footer-maintenance").click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Restaurer les données initiales" })
    .click();
  await page
    .getByRole("heading", { name: "Heureux de vous retrouver." })
    .waitFor();
  const resetData = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("jz-kalyphor-platform-v2")),
  );
  assert.equal(resetData.students.length, 2);
  assert.equal(resetData.courses.length, 3);

  // 12. Version autonome (React 18 CDN) sur mobile.
  const standalone = await browser.newPage({
    viewport: { width: 390, height: 844 },
    ignoreHTTPSErrors: true,
  });
  standalone.on("pageerror", (error) =>
    errors.push(`Standalone: ${error.message}`),
  );
  await standalone.goto(standaloneUrl, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await standalone
    .getByRole("heading", { name: "Heureux de vous retrouver." })
    .waitFor({ timeout: 60000 });
  await loginAdmin(standalone);
  await dismissTour(standalone);
  assert.equal(
    await standalone.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await standalone.getByRole("button", { name: "Ouvrir le menu" }).click();
  await standalone
    .getByRole("button", { name: "Étudiants", exact: true })
    .click();
  await standalone.getByRole("heading", { name: "Vos étudiants" }).waitFor();
  assert.match(
    await standalone.locator(".students-table").innerText(),
    /AD-2026-09/,
  );
  await standalone.getByRole("button", { name: "Ouvrir le menu" }).click();
  await standalone.getByRole("button", { name: "Se déconnecter" }).click();
  await loginStudent(standalone, AMINA.name, AMINA.registration);
  await standalone.getByRole("heading", { name: "Bonjour, Amina" }).waitFor();
  await dismissTour(standalone);
  assert.match(
    await standalone.locator(".next-action").innerText(),
    /Reprendre/,
  );
  assert.equal(
    await standalone.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );

  assert.deepEqual(errors, []);
  console.log(
    "Smoke test passed: weekly reports (on time, late, reminders, inspection), guided tours (admin/student/course), help panel, checklist, pending chip, registration login, admin tab, portal link, auto-generated immatriculation, homonym suffix, WhatsApp access/reminder/course share, cohort filter & targeting, suspension, external credentials, timer, upload, report, inspection, reset, standalone mobile.",
  );
} finally {
  await browser.close();
}
