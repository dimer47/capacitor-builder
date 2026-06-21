import child_process from "child_process";
import inquirer from "inquirer";
import OptionsManager from "./tools/options.mjs";
import Logger from "./tools/logger.mjs";
import ConfigManager from "./tools/configs.mjs";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import https from "https";

const logger = new Logger();
const isNonInteractive = process.argv.includes("--yes") || process.argv.includes("-y");

/**
 * Wrapper around inquirer.prompt that respects --yes mode.
 * In non-interactive mode, returns default values automatically.
 * Supports `when` conditions like inquirer does.
 */
async function prompt(questions) {
  if (!isNonInteractive) return inquirer.prompt(questions);

  const result = {};
  const qs = Array.isArray(questions) ? questions : [questions];
  for (const q of qs) {
    // Evaluate `when` condition
    if (q.when !== undefined) {
      const shouldAsk = typeof q.when === "function" ? q.when(result) : q.when;
      if (!shouldAsk) continue;
    }
    if (q.type === "confirm") {
      result[q.name] = q.default !== undefined ? q.default : true;
    } else if (q.type === "list") {
      result[q.name] = q.default || (q.choices?.[0]?.value ?? q.choices?.[0]);
    } else {
      result[q.name] = q.default || "";
    }
    logger.log(`  [--yes] ${q.message} → ${result[q.name]}`);
  }
  return result;
}

// --- Helpers ---

function exec(cmd, options = {}) {
  return child_process.execSync(cmd, { stdio: "inherit", ...options });
}

function execOutput(cmd) {
  return child_process.execSync(cmd).toString().trim();
}

function loadBuilderConfig() {
  const configPath = "./capacitor-builder.config.json";
  if (!fs.existsSync(configPath)) return null;
  return JSON.parse(fs.readFileSync(configPath, "utf-8"));
}

/**
 * Unified HTTPS request helper.
 */
function httpsRequest(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const data = Buffer.concat(chunks).toString();
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(data)); } catch { resolve(data); }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function httpsUpload(options, fileBuffer) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const data = Buffer.concat(chunks).toString();
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(data)); } catch { resolve(data); }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });
    req.on("error", reject);
    req.write(fileBuffer);
    req.end();
  });
}

/**
 * Detect if the iOS project uses SPM (xcodeproj) or CocoaPods (xcworkspace).
 * Returns { type: "spm" | "cocoapods", path: string } or null.
 */
function detectIOSProjectType(iosConfig = {}) {
  if (iosConfig.project && fs.existsSync(iosConfig.project)) {
    return { type: "spm", path: iosConfig.project };
  }
  if (iosConfig.workspace && fs.existsSync(iosConfig.workspace)) {
    return { type: "cocoapods", path: iosConfig.workspace };
  }
  // Auto-detect
  if (fs.existsSync("ios/App/App.xcworkspace")) {
    return { type: "cocoapods", path: "ios/App/App.xcworkspace" };
  }
  if (fs.existsSync("ios/App/App.xcodeproj")) {
    return { type: "spm", path: "ios/App/App.xcodeproj" };
  }
  return null;
}

// --- Help ---

function showHelp() {
  console.log(`
capacitor-builder — Build & deploy Capacitor apps

Commandes :
  --init               Créer le fichier capacitor-builder.config.json (interactif)
  --ios                Build pour iOS
  --android            Build pour Android
  --both               Build pour iOS et Android
  --no-upload          Build sans upload sur les stores
  --changelog          Générer le changelog store (texte brut, 500 chars max)
  --changelog-file     Générer/mettre à jour CHANGELOG.md (format markdown)
  --tag                Tagger le dernier commit avec la version actuelle
  --check              Vérifier la config capacitor-builder.config.json
  --commit             Committer le bump de version + tagger (si oublié après generate)
  --help               Afficher cette aide
  -f, --force          Ignorer les vérifications git (branche, uncommitted)
  -y, --yes            Mode non-interactif : accepte tous les prompts (pour CI/CD et agents IA)

Scripts npm :
  npm run cb:generate                  Build + upload iOS & Android
  npm run cb:generate:no-upload        Build sans upload
  npm run ios:cb:generate              Build + upload iOS seul
  npm run ios:cb:generate:no-upload    Build iOS sans upload
  npm run android:cb:generate          Build + upload Android seul
  npm run android:cb:generate:no-upload Build Android sans upload
  npm run cb:changelog                 Générer le changelog IA (store)
  npm run cb:changelog:file            Générer/mettre à jour CHANGELOG.md
  npm run cb:tag                       Tagger la version actuelle
  npm run cb:commit                    Committer version + tagger
  npm run cb:init                      Créer la config (interactif)
  npm run cb:check                     Vérifier la config
  npm run cb:help                      Afficher cette aide
  npm run cb:sync-version              Sync version vers natif

Démarrage :
  1. Lancez npm run cb:init pour créer capacitor-builder.config.json
  2. Le fichier est automatiquement ajouté au .gitignore
  3. Remplissez les credentials iOS/Android/changelog
  4. Lancez npm run cb:generate

Configuration :
  capacitor-builder.config.json (gitignored) contient :
  - ios: { teamId, scheme, workspace|project, apiKeyPath, apiKeyId, apiIssuerId }
  - android: { packageName, keystorePath, keystorePassword, keyAlias, keyPassword, serviceAccountJsonPath, track }
  - changelog: { provider, apiKey, language }
    providers: "claude-api" | "gemini-api" | "claude-cli" | "codex-cli" | "none"

  iOS : utilisez "workspace" pour CocoaPods, "project" pour SPM.
  Android : "track" peut être "internal" (défaut), "alpha", "beta", ou "production".
`);
}

// --- Init ---

async function handleInit() {
  const configPath = "./capacitor-builder.config.json";

  if (fs.existsSync(configPath)) {
    logger.warning("capacitor-builder.config.json existe déjà.", false);
    const { overwrite } = await inquirer.prompt([{
      message: "Voulez-vous le recréer ?",
      name: "overwrite",
      type: "confirm",
      default: false,
    }]);
    if (!overwrite) return;
  }

  logger.blue(">>> Configuration de capacitor-builder");
  logger.log("");

  // iOS
  const { configIOS } = await inquirer.prompt([{
    message: "Configurer iOS ?",
    name: "configIOS",
    type: "confirm",
    default: fs.existsSync("./ios"),
  }]);

  let ios = null;
  if (configIOS) {
    // Detect project type for default value
    const detected = detectIOSProjectType();
    const isSPM = detected?.type === "spm";

    const iosAnswers = await inquirer.prompt([
      { message: "Team ID Apple Developer:", name: "teamId", type: "input" },
      { message: "Scheme Xcode:", name: "scheme", type: "input", default: "App" },
      {
        message: isSPM ? "Chemin projet (.xcodeproj):" : "Chemin workspace (.xcworkspace):",
        name: isSPM ? "project" : "workspace",
        type: "input",
        default: detected?.path || "ios/App/App.xcworkspace",
      },
      { message: "Chemin clé API App Store Connect (.p8):", name: "apiKeyPath", type: "input" },
      { message: "API Key ID:", name: "apiKeyId", type: "input" },
      { message: "API Issuer ID:", name: "apiIssuerId", type: "input" },
    ]);
    ios = iosAnswers;
  }

  // Android
  const { configAndroid } = await inquirer.prompt([{
    message: "Configurer Android ?",
    name: "configAndroid",
    type: "confirm",
    default: fs.existsSync("./android"),
  }]);

  let android = null;
  if (configAndroid) {
    const androidAnswers = await inquirer.prompt([
      { message: "Package name (ex: com.example.app):", name: "packageName", type: "input" },
      { message: "Chemin keystore (.jks):", name: "keystorePath", type: "input" },
      { message: "Mot de passe keystore:", name: "keystorePassword", type: "password" },
      { message: "Alias de la clé:", name: "keyAlias", type: "input", default: "key0" },
      { message: "Mot de passe de la clé:", name: "keyPassword", type: "password" },
      { message: "Chemin service account Google Play (.json):", name: "serviceAccountJsonPath", type: "input" },
      {
        message: "Canal Google Play:", name: "track", type: "list",
        choices: [
          { name: "internal (test interne)", value: "internal" },
          { name: "alpha (test fermé)", value: "alpha" },
          { name: "beta (test ouvert)", value: "beta" },
          { name: "production", value: "production" },
        ],
      },
    ]);
    android = androidAnswers;
  }

  // Changelog
  const { configChangelog } = await inquirer.prompt([{
    message: "Configurer le changelog IA ?",
    name: "configChangelog",
    type: "confirm",
    default: true,
  }]);

  let changelog = null;
  if (configChangelog) {
    const changelogAnswers = await inquirer.prompt([
      {
        message: "Provider IA:", name: "provider", type: "list",
        choices: [
          { name: "Claude API (Anthropic)", value: "claude-api" },
          { name: "Gemini API (Google, gratuit)", value: "gemini-api" },
          { name: "Claude CLI (claude -p)", value: "claude-cli" },
          { name: "Codex CLI (codex exec)", value: "codex-cli" },
          { name: "Désactivé", value: "none" },
        ],
      },
      {
        message: "Clé API:", name: "apiKey", type: "password",
        when: (a) => a.provider.endsWith("-api"),
      },
      {
        message: "Langue du changelog:", name: "language", type: "input", default: "fr",
      },
    ]);
    changelog = {};
    changelog.provider = changelogAnswers.provider;
    if (changelogAnswers.apiKey) changelog.apiKey = changelogAnswers.apiKey;
    changelog.language = changelogAnswers.language;
  }

  // Build config
  const config = {};
  if (ios) config.ios = ios;
  if (android) config.android = android;
  if (changelog) config.changelog = changelog;

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  logger.success(`  capacitor-builder.config.json créé`);

  // Ensure gitignored
  ensureGitignored();
}

// --- Gitignore check ---

function isGitignored() {
  const configFile = "capacitor-builder.config.json";

  try {
    execOutput(`git check-ignore -q ${configFile} 2>/dev/null`);
    return true;
  } catch {
    // Not ignored
  }

  const gitignorePath = "./.gitignore";
  if (fs.existsSync(gitignorePath)) {
    const content = fs.readFileSync(gitignorePath, "utf-8");
    return content.split("\n").some((line) => line.trim() === configFile);
  }

  return false;
}

function ensureGitignored() {
  if (isGitignored()) return;

  const gitignorePath = "./.gitignore";
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, "");
  }

  let content = fs.readFileSync(gitignorePath, "utf-8");
  if (!content.endsWith("\n")) content += "\n";
  content += "\n# Capacitor Builder (contient des credentials)\ncapacitor-builder.config.json\n";
  fs.writeFileSync(gitignorePath, content);
  logger.success("  capacitor-builder.config.json ajouté au .gitignore");
}

function checkConfigSafety() {
  const configPath = "./capacitor-builder.config.json";
  if (!fs.existsSync(configPath)) return;

  if (!isGitignored()) {
    logger.log("");
    logger.warning("capacitor-builder.config.json n'est PAS dans le .gitignore !", false);
    logger.warning("  Ce fichier contient des mots de passe et clés API.", false);
    logger.log("");
    ensureGitignored();
  }
}

// --- Check config ---

function handleCheck() {
  const configPath = "./capacitor-builder.config.json";

  if (!fs.existsSync(configPath)) {
    logger.error("capacitor-builder.config.json introuvable. Lancez --init pour le créer.");
    return;
  }

  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    logger.success("JSON valide");
  } catch (e) {
    logger.error(`JSON invalide: ${e.message}`);
    return;
  }

  let errors = 0;
  let warnings = 0;

  // Check gitignore
  if (isGitignored()) {
    logger.success(".gitignore: OK");
  } else {
    logger.warning(".gitignore: capacitor-builder.config.json n'est PAS ignoré !", false);
    warnings++;
  }

  // Check iOS
  if (config.ios) {
    logger.blue("\n--- iOS ---");
    const iosRequired = ["teamId", "scheme", "apiKeyPath", "apiKeyId", "apiIssuerId"];
    for (const key of iosRequired) {
      if (!config.ios[key]) {
        logger.warning(`  ios.${key}: manquant`, false);
        warnings++;
      } else {
        logger.success(`  ios.${key}: OK`);
      }
    }
    // Check workspace OR project
    if (!config.ios.workspace && !config.ios.project) {
      logger.warning("  ios.workspace ou ios.project: manquant", false);
      warnings++;
    } else {
      const iosProjectPath = config.ios.project || config.ios.workspace;
      const iosProjectKey = config.ios.project ? "project" : "workspace";
      if (fs.existsSync(iosProjectPath)) {
        logger.success(`  ios.${iosProjectKey}: OK (${config.ios.project ? "SPM" : "CocoaPods"})`);
      } else {
        logger.warning(`  ios.${iosProjectKey}: fichier introuvable (${iosProjectPath})`, false);
        errors++;
      }
    }
    if (config.ios.apiKeyPath && !fs.existsSync(config.ios.apiKeyPath)) {
      logger.warning(`  ios.apiKeyPath: fichier introuvable (${config.ios.apiKeyPath})`, false);
      errors++;
    }
  } else {
    logger.warning("\nios: non configuré", false);
    warnings++;
  }

  // Check Android
  if (config.android) {
    logger.blue("\n--- Android ---");
    const androidRequired = ["packageName", "keystorePath", "keystorePassword", "keyAlias", "keyPassword", "serviceAccountJsonPath"];
    for (const key of androidRequired) {
      if (!config.android[key]) {
        logger.warning(`  android.${key}: manquant`, false);
        warnings++;
      } else {
        const isSecret = key.toLowerCase().includes("password");
        logger.success(`  android.${key}: ${isSecret ? "****" : "OK"}`);
      }
    }
    logger.log(`  android.track: ${config.android.track || "internal (défaut)"}`);
    if (config.android.keystorePath && !fs.existsSync(config.android.keystorePath)) {
      logger.warning(`  android.keystorePath: fichier introuvable (${config.android.keystorePath})`, false);
      errors++;
    }
    if (config.android.serviceAccountJsonPath && !fs.existsSync(config.android.serviceAccountJsonPath)) {
      logger.warning(`  android.serviceAccountJsonPath: fichier introuvable (${config.android.serviceAccountJsonPath})`, false);
      errors++;
    }
  } else {
    logger.warning("\nandroid: non configuré", false);
    warnings++;
  }

  // Check Changelog
  if (config.changelog) {
    logger.blue("\n--- Changelog ---");
    const provider = config.changelog.provider || "none";
    logger.log(`  provider: ${provider}`);
    if (provider.endsWith("-api") && !config.changelog.apiKey) {
      logger.warning(`  apiKey: manquante (requise pour ${provider})`, false);
      errors++;
    } else if (provider.endsWith("-api")) {
      logger.success("  apiKey: OK (*****)");
    }
    if (provider === "claude-cli") {
      try { execOutput("which claude"); logger.success("  claude CLI: trouvé"); }
      catch { logger.warning("  claude CLI: non trouvé dans le PATH", false); errors++; }
    }
    if (provider === "codex-cli") {
      try { execOutput("which codex"); logger.success("  codex CLI: trouvé"); }
      catch { logger.warning("  codex CLI: non trouvé dans le PATH", false); errors++; }
    }
    logger.success(`  language: ${config.changelog.language || "fr"}`);
  } else {
    logger.warning("\nchangelog: non configuré (pas de changelog IA)", false);
    warnings++;
  }

  // Check src/config.json
  logger.blue("\n--- Projet ---");
  const appConfigPath = "./src/config.json";
  if (fs.existsSync(appConfigPath)) {
    const appConfig = JSON.parse(fs.readFileSync(appConfigPath, "utf-8"));
    logger.success(`  version: ${appConfig.version}`);
    logger.success(`  build: ${appConfig.build}`);
  } else {
    logger.warning("  src/config.json: introuvable", false);
    errors++;
  }

  // Summary
  logger.log("");
  if (errors === 0 && warnings === 0) {
    logger.success("Tout est OK !");
  } else {
    if (errors > 0) logger.warning(`${errors} erreur(s)`, false);
    if (warnings > 0) logger.warning(`${warnings} avertissement(s)`, false);
  }
}

// --- Changelog AI ---

function getCommitsSinceLastTag() {
  try {
    const lastTag = execOutput("git describe --tags --abbrev=0 2>/dev/null");
    const commits = execOutput(`git log ${lastTag}..HEAD --oneline --no-decorate`);
    if (commits) return commits;
    const prevTag = execOutput(`git describe --tags --abbrev=0 ${lastTag}^ 2>/dev/null`);
    return execOutput(`git log ${prevTag}..${lastTag} --oneline --no-decorate`);
  } catch {
    return execOutput("git log --oneline --no-decorate -20");
  }
}

function buildChangelogPrompt(commits, language = "fr", format = "store") {
  const langName = language === "fr" ? "français" : language === "en" ? "anglais" : language === "es" ? "espagnol" : language === "pt" ? "portugais" : language === "pl" ? "polonais" : language;

  if (format === "markdown") {
    return `Tu es un rédacteur de notes de version pour une application mobile.
À partir de la liste de commits ci-dessous, génère un résumé clair et concis destiné aux utilisateurs finaux, au format markdown.

Règles :
- En ${langName}
- Résume les changements importants pour l'utilisateur (pas les détails techniques)
- Regroupe les changements par thème avec des titres ### markdown
- Utilise des bullet points courts et compréhensibles
- Ne mentionne pas les hash de commits ni les noms de fichiers
- Ignore les commits techniques (chore, refactor, merge) sauf s'ils apportent un bénéfice utilisateur visible
- Maximum 10 bullet points
- Formule du point de vue utilisateur (pas développeur)

Commits :
${commits}

Génère uniquement le contenu markdown (sans le titre de version ##, je l'ajoute moi-même).`;
  }

  // Format store (texte brut, max 500 chars)
  return `Tu es un rédacteur de notes de version pour une application mobile.
À partir de la liste de commits ci-dessous, génère un changelog concis et professionnel pour les utilisateurs.

Règles strictes :
- Maximum 500 caractères (limite Google Play Store)
- En ${langName}
- Pas de préfixe comme "Changelog:" ou "Notes de version:"
- Pas de markdown (ni **, ni #, ni backticks, ni [lien])
- Utilise des tirets - comme bullet points
- Si tu utilises des titres de section, ils doivent être EN MAJUSCULES et sans caractère spécial (ex: NOUVEAUTÉS, CORRECTIONS)
- Commence directement par le contenu
- Regroupe les changements par thème si possible
- Ignore les commits techniques (chore, refactor, merge) sauf s'ils apportent un bénéfice utilisateur visible
- Formule du point de vue utilisateur (pas développeur)
- Ne dépasse JAMAIS 500 caractères

Commits :
${commits}

Réponds UNIQUEMENT avec le texte du changelog, rien d'autre.`;
}

// --- AI Providers ---

async function callClaudeAPI(prompt, apiKey, maxTokens = 1024) {
  const body = JSON.stringify({
    model: "claude-sonnet-4-20250514",
    max_tokens: maxTokens,
    messages: [{ role: "user", content: prompt }],
  });
  const result = await httpsRequest({
    hostname: "api.anthropic.com",
    path: "/v1/messages",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Length": Buffer.byteLength(body),
    },
  }, body);
  return result.content[0].text;
}

async function callGeminiAPI(prompt, apiKey) {
  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
  });
  const result = await httpsRequest({
    hostname: "generativelanguage.googleapis.com",
    path: `/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
    },
  }, body);
  return result.candidates[0].content.parts[0].text;
}

function callCLI(prompt, cli) {
  const tmpFile = path.join(process.env.TMPDIR || "/tmp", `changelog-prompt-${Date.now()}.txt`);
  fs.writeFileSync(tmpFile, prompt);
  try {
    if (cli === "codex-cli") {
      return execOutput(`cat "${tmpFile}" | codex exec`);
    }
    return execOutput(`cat "${tmpFile}" | claude -p`);
  } finally {
    fs.unlinkSync(tmpFile);
  }
}

/**
 * Unified changelog generation via AI provider.
 * @param {object} changelogConfig - { provider, apiKey, language }
 * @param {"store"|"markdown"} format - Output format
 * @returns {string|null}
 */
async function generateChangelogWithAI(changelogConfig = {}, format = "store") {
  const provider = changelogConfig.provider || "none";
  const apiKey = changelogConfig.apiKey || "";
  const language = changelogConfig.language || "fr";

  if (provider === "none") return null;

  logger.blue(`>>> Génération du changelog ${format === "markdown" ? "(markdown)" : "(store)"} via IA...`);

  const commits = getCommitsSinceLastTag();
  if (!commits) {
    logger.warning("Aucun commit trouvé depuis le dernier tag.", false);
    return null;
  }

  if (format === "store") {
    logger.log(`  Provider: ${provider}`);
    logger.log(`  Commits depuis le dernier tag:\n${commits}\n`);
  }

  const promptText = buildChangelogPrompt(commits, language, format);
  const maxTokens = format === "markdown" ? 1024 : 300;

  try {
    let result;
    if (provider === "claude-api") {
      if (!apiKey) { logger.warning("Clé API Anthropic manquante dans changelog.apiKey", false); return null; }
      result = await callClaudeAPI(promptText, apiKey, maxTokens);
    } else if (provider === "gemini-api") {
      if (!apiKey) { logger.warning("Clé API Gemini manquante dans changelog.apiKey", false); return null; }
      result = await callGeminiAPI(promptText, apiKey);
    } else if (provider === "claude-cli") {
      result = callCLI(promptText, "claude-cli");
    } else if (provider === "codex-cli") {
      result = callCLI(promptText, "codex-cli");
    } else {
      logger.warning(`Provider inconnu: ${provider}`, false);
      return null;
    }
    const trimmed = result ? result.trim() : null;
    return format === "store" && trimmed ? trimmed.substring(0, 500) : trimmed;
  } catch (e) {
    logger.warning(`Erreur changelog (${provider}): ${e.message}`, false);
    return null;
  }
}

async function getChangelogFromUser(changelogConfig = {}) {
  const generated = await generateChangelogWithAI(changelogConfig, "store");

  if (generated) {
    logger.log("");
    logger.blue("--- Changelog généré ---");
    console.log(generated);
    logger.blue(`--- ${generated.length}/500 caractères ---`);
    logger.log("");

    const { action } = await prompt([{
      message: "Que faire avec ce changelog ?",
      name: "action",
      type: "list",
      choices: [
        { name: "Utiliser tel quel", value: "use" },
        { name: "Modifier manuellement", value: "edit" },
        { name: "Régénérer", value: "regen" },
        { name: "Passer (pas de changelog)", value: "skip" },
      ],
    }]);

    if (action === "use") return generated;
    if (action === "regen") return getChangelogFromUser(changelogConfig);
    if (action === "skip") return null;
  }

  // Manual edit or no AI result
  const { changelog } = await prompt([{
    message: "Entrez le changelog (max 500 chars, vide pour passer):",
    name: "changelog",
    type: "editor",
  }]);

  if (!changelog || !changelog.trim()) return null;
  return changelog.trim().substring(0, 500);
}

// --- CHANGELOG.md file generation ---

async function writeChangelogFile(version, changelogConfig = {}) {
  logger.blue(">>> Génération du CHANGELOG.md...");

  const date = new Date().toISOString().split("T")[0];
  let markdownContent = await generateChangelogWithAI(changelogConfig, "markdown");

  if (!markdownContent) {
    // Fallback: liste brute des commits
    const commits = getCommitsSinceLastTag();
    if (commits) {
      markdownContent = commits.split("\n").filter(Boolean).map(line => {
        const match = line.match(/^[a-f0-9]+\s+(.+)$/);
        return match ? `- ${match[1]}` : `- ${line}`;
      }).join("\n");
    } else {
      markdownContent = "- Mise à jour mineure";
    }
  }

  const versionHeader = `## v${version} (${date})`;
  const newSection = `${versionHeader}\n\n${markdownContent}\n\n`;

  const changelogPath = path.resolve(process.cwd(), "CHANGELOG.md");
  let existingContent = "";

  if (fs.existsSync(changelogPath)) {
    existingContent = fs.readFileSync(changelogPath, "utf-8");
    existingContent = existingContent.replace(/^# Changelog\n\n/, "");
  }

  // Si la version existe déjà, remplacer la section
  const versionEscaped = version.replace(/\./g, "\\.");
  if (existingContent.includes(`## v${version}`)) {
    const regex = new RegExp(`## v${versionEscaped}[\\s\\S]*?(?=## v|$)`);
    existingContent = existingContent.replace(regex, "");
  }

  const fullChangelog = `# Changelog\n\n${newSection}${existingContent}`;
  fs.writeFileSync(changelogPath, fullChangelog);
  logger.success(`✓ CHANGELOG.md mis à jour (v${version})`);
}

// --- Android: signing.properties ---

function writeSigningProperties(androidConfig) {
  const propsPath = "./android/app/signing.properties";
  const content = [
    `storeFile=${androidConfig.keystorePath}`,
    `storePassword=${androidConfig.keystorePassword}`,
    `keyAlias=${androidConfig.keyAlias}`,
    `keyPassword=${androidConfig.keyPassword}`,
  ].join("\n");
  fs.writeFileSync(propsPath, content);
  logger.log("  signing.properties créé");
}

function cleanSigningProperties() {
  const propsPath = "./android/app/signing.properties";
  if (fs.existsSync(propsPath)) fs.unlinkSync(propsPath);
}

// --- Android: build AAB ---

function buildAndroidAAB() {
  logger.blue(">>> [Android] Building release AAB...");
  const gradlew = process.platform === "win32" ? "gradlew.bat" : "./gradlew";
  exec(`cd android && ${gradlew} bundleRelease`);
  const aabPath = "android/app/build/outputs/bundle/release/app-release.aab";
  if (!fs.existsSync(aabPath)) {
    logger.error("AAB non trouvé: " + aabPath);
  }
  logger.success("  AAB généré: " + aabPath);
  return aabPath;
}

// --- Android: Google Play upload ---

function generateJWT(serviceAccount) {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/androidpublisher",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })).toString("base64url");
  const sig = crypto.sign("sha256", Buffer.from(header + "." + payload), serviceAccount.private_key).toString("base64url");
  return header + "." + payload + "." + sig;
}

async function getAccessToken(serviceAccount) {
  const jwt = generateJWT(serviceAccount);
  const postData = `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`;
  const result = await httpsRequest({
    hostname: "oauth2.googleapis.com",
    path: "/token",
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(postData) },
  }, postData);
  return result.access_token;
}

async function uploadToGooglePlay(androidConfig, aabPath, changelog = null) {
  logger.blue(">>> [Android] Upload sur Google Play...");

  const serviceAccount = JSON.parse(fs.readFileSync(androidConfig.serviceAccountJsonPath, "utf-8"));
  const token = await getAccessToken(serviceAccount);
  const pkg = androidConfig.packageName;
  const track = androidConfig.track || "internal";

  // 1. Create edit
  logger.log("  Création de l'edit...");
  const edit = await httpsRequest({
    hostname: "androidpublisher.googleapis.com",
    path: `/androidpublisher/v3/applications/${pkg}/edits`,
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  }, "{}");

  // 2. Upload AAB
  logger.log("  Upload de l'AAB...");
  const aabBuffer = fs.readFileSync(aabPath);
  const uploadResult = await httpsUpload({
    hostname: "androidpublisher.googleapis.com",
    path: `/upload/androidpublisher/v3/applications/${pkg}/edits/${edit.id}/bundles?uploadType=media`,
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/octet-stream",
      "Content-Length": aabBuffer.length,
    },
  }, aabBuffer);
  logger.log(`  AAB uploadé — versionCode: ${uploadResult.versionCode}`);

  // 3. Assign to track with changelog
  logger.log(`  Assignation au canal '${track}'...`);
  const release = {
    versionCodes: [uploadResult.versionCode],
    status: "completed",
  };
  if (changelog) {
    release.releaseNotes = [{ language: "fr-FR", text: changelog }];
  }
  const trackBody = JSON.stringify({ track, releases: [release] });
  await httpsRequest({
    hostname: "androidpublisher.googleapis.com",
    path: `/androidpublisher/v3/applications/${pkg}/edits/${edit.id}/tracks/${track}`,
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(trackBody) },
  }, trackBody);

  // 4. Commit edit
  logger.log("  Commit de l'edit...");
  await httpsRequest({
    hostname: "androidpublisher.googleapis.com",
    path: `/androidpublisher/v3/applications/${pkg}/edits/${edit.id}:commit`,
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  }, "{}");

  logger.success(`  Android uploadé sur Google Play (canal ${track})`);
}

// --- iOS: archive + export + upload ---

function buildXcodebuildArgs(iosConfig) {
  const project = detectIOSProjectType(iosConfig);
  if (!project) {
    logger.error("Impossible de détecter le type de projet iOS (pas de .xcworkspace ni .xcodeproj)");
  }
  return project.type === "spm"
    ? `-project "${project.path}"`
    : `-workspace "${project.path}"`;
}

function buildExportOptionsPlist(iosConfig, withUpload = false) {
  let plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>method</key>
    <string>app-store-connect</string>
    <key>teamID</key>
    <string>${iosConfig.teamId}</string>
    <key>signingStyle</key>
    <string>automatic</string>`;

  if (withUpload) {
    plist += `
    <key>destination</key>
    <string>upload</string>`;
  }

  plist += `
    <key>uploadSymbols</key>
    <true/>
</dict>
</plist>`;
  return plist;
}

function archiveIOS(iosConfig, version) {
  logger.blue(">>> [iOS] Archive...");
  const archivePath = `build/App-${version}.xcarchive`;
  const projectArg = buildXcodebuildArgs(iosConfig);
  exec([
    "xcodebuild archive",
    projectArg,
    `-scheme "${iosConfig.scheme}"`,
    `-archivePath "${archivePath}"`,
    `-destination "generic/platform=iOS"`,
    `-allowProvisioningUpdates`,
    `DEVELOPMENT_TEAM=${iosConfig.teamId}`,
  ].join(" "));
  logger.success("  Archive créée: " + archivePath);
  return archivePath;
}

function exportAndUploadIOS(iosConfig, archivePath, version) {
  logger.blue(">>> [iOS] Export & Upload sur App Store Connect...");
  const exportPath = `build/export-${version}`;
  const exportOptionsPath = "build/ExportOptions.plist";

  fs.mkdirSync("build", { recursive: true });
  fs.writeFileSync(exportOptionsPath, buildExportOptionsPlist(iosConfig, true));

  // Copy API key for authentication
  const privateKeysDir = path.join(process.env.HOME, "private_keys");
  fs.mkdirSync(privateKeysDir, { recursive: true });
  const destKeyPath = path.join(privateKeysDir, `AuthKey_${iosConfig.apiKeyId}.p8`);
  if (!fs.existsSync(destKeyPath)) {
    fs.copyFileSync(iosConfig.apiKeyPath, destKeyPath);
  }

  exec([
    "xcodebuild -exportArchive",
    `-archivePath "${archivePath}"`,
    `-exportPath "${exportPath}"`,
    `-exportOptionsPlist "${exportOptionsPath}"`,
    `-allowProvisioningUpdates`,
    `-authenticationKeyPath "${iosConfig.apiKeyPath}"`,
    `-authenticationKeyID "${iosConfig.apiKeyId}"`,
    `-authenticationKeyIssuerID "${iosConfig.apiIssuerId}"`,
  ].join(" "));

  logger.success("  iOS exporté et uploadé sur App Store Connect");
}

function buildIOSOnly(iosConfig, version) {
  logger.blue(">>> [iOS] Build sans upload...");
  const archivePath = archiveIOS(iosConfig, version);
  const exportPath = `build/export-${version}`;
  const exportOptionsPath = "build/ExportOptions.plist";

  fs.mkdirSync("build", { recursive: true });
  fs.writeFileSync(exportOptionsPath, buildExportOptionsPlist(iosConfig, false));

  exec([
    "xcodebuild -exportArchive",
    `-archivePath "${archivePath}"`,
    `-exportPath "${exportPath}"`,
    `-exportOptionsPlist "${exportOptionsPath}"`,
    `-allowProvisioningUpdates`,
  ].join(" "));

  const ipaFiles = fs.readdirSync(exportPath).filter((f) => f.endsWith(".ipa"));
  if (ipaFiles.length > 0) {
    logger.success(`  IPA généré: ${path.join(exportPath, ipaFiles[0])}`);
  } else {
    logger.success(`  Archive créée: ${archivePath}`);
  }
}

// --- Git: tag workflow ---

function getCurrentVersion() {
  const configPath = "./src/config.json";
  if (!fs.existsSync(configPath)) return null;
  const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  return config.version;
}

async function handleTagWorkflow(version, initialCommit) {
  const currentCommit = execOutput("git rev-parse HEAD");
  const hasChanges = execOutput("git status --porcelain src/config.json CHANGELOG.md").length > 0;

  if (hasChanges) {
    const { doCommit } = await prompt([{
      message: `Fichiers modifiés (v${version}). Créer un commit de version ?`,
      name: "doCommit",
      type: "confirm",
      default: true,
    }]);

    if (doCommit) {
      exec(`git add src/config.json`);
      if (fs.existsSync("CHANGELOG.md")) {
        exec(`git add CHANGELOG.md`);
      }
      exec(`git commit -m "chore: bump version to ${version}"`);
      logger.success(`  Commit de version créé`);
    }
  }

  // Propose to tag
  const { doTag } = await prompt([{
    message: `Tagger ce commit avec v${version} ?`,
    name: "doTag",
    type: "confirm",
    default: true,
  }]);

  if (doTag) {
    try {
      exec(`git tag v${version}`);
      logger.success(`  Tag v${version} créé`);
    } catch (e) {
      logger.warning(`Tag v${version} existe peut-être déjà`, false);
    }
  }

  // Propose to push
  const { doPush } = await prompt([{
    message: `Pousser le commit et le tag sur origin ?`,
    name: "doPush",
    type: "confirm",
    default: true,
  }]);

  if (doPush) {
    try {
      const branch = execOutput("git rev-parse --abbrev-ref HEAD");
      exec(`git push origin ${branch}`);
      if (doTag) exec(`git push origin v${version}`);
      logger.success(`  Poussé sur origin`);
    } catch (e) {
      logger.warning(`Erreur push: ${e.message}`, false);
    }
  }
}

async function handleTagOnly() {
  const version = getCurrentVersion();
  if (!version) {
    logger.error("Impossible de lire la version depuis src/config.json");
    return;
  }

  logger.blue(`>>> Version actuelle: ${version}`);

  // Check if tag already exists
  try {
    execOutput(`git rev-parse v${version} 2>/dev/null`);
    logger.warning(`Le tag v${version} existe déjà.`, false);

    const { retag } = await prompt([{
      message: `Voulez-vous déplacer le tag v${version} sur le commit actuel ?`,
      name: "retag",
      type: "confirm",
      default: false,
    }]);

    if (retag) {
      exec(`git tag -d v${version}`);
      exec(`git tag v${version}`);
      logger.success(`  Tag v${version} déplacé sur le commit actuel`);
    }
    return;
  } catch {
    // Tag doesn't exist, create it
  }

  const { doTag } = await prompt([{
    message: `Créer le tag v${version} sur le commit actuel ?`,
    name: "doTag",
    type: "confirm",
    default: true,
  }]);

  if (doTag) {
    exec(`git tag v${version}`);
    logger.success(`  Tag v${version} créé`);
  }
}

// --- Commit version bump ---

async function handleCommit() {
  const version = getCurrentVersion();
  if (!version) {
    logger.error("Impossible de lire la version depuis src/config.json");
    return;
  }

  logger.blue(`>>> Version actuelle: ${version}`);

  const configChanged = execOutput("git status --porcelain src/config.json").length > 0;

  if (configChanged) {
    exec("git add src/config.json");
    if (fs.existsSync("CHANGELOG.md") && execOutput("git status --porcelain CHANGELOG.md").length > 0) {
      exec("git add CHANGELOG.md");
    }
    exec(`git commit -m "chore: bump version to ${version}"`);
    logger.success(`  Commit de version créé (v${version})`);
  } else {
    const lastMsg = execOutput("git log -1 --format=%s");
    if (lastMsg.includes(version)) {
      logger.log(`  Le dernier commit contient déjà la version ${version}`);
    } else {
      logger.warning("src/config.json n'a pas de modifications non commitées.", false);
      return;
    }
  }

  // Propose to tag
  await handleTagOnly();
}

// --- Main ---

async function main() {
  const optionsManager = new OptionsManager();
  optionsManager.defineOptions();
  const options = optionsManager.getOptions();

  // Help mode
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    showHelp();
    return;
  }

  // Init mode
  if (process.argv.includes("--init")) {
    await handleInit();
    return;
  }

  // Check mode
  if (process.argv.includes("--check")) {
    handleCheck();
    return;
  }

  // Tag-only mode
  if (process.argv.includes("--tag")) {
    await handleTagOnly();
    return;
  }

  // Commit mode
  if (process.argv.includes("--commit")) {
    await handleCommit();
    return;
  }

  // Check config safety (gitignore)
  checkConfigSafety();

  // Load builder config
  const builderConfig = loadBuilderConfig();

  // Changelog-only mode (store format)
  if (process.argv.includes("--changelog")) {
    const changelogConfig = builderConfig?.changelog || {};
    if (changelogConfig.provider === "none" || !changelogConfig.provider) {
      logger.warning("Changelog non configuré. Ajoutez 'changelog' dans capacitor-builder.config.json", false);
      logger.log("  Exemple: { \"changelog\": { \"provider\": \"claude-api\", \"apiKey\": \"sk-ant-...\", \"language\": \"fr\" } }");
      return;
    }
    const changelog = await generateChangelogWithAI(changelogConfig, "store");
    if (changelog) {
      console.log("\n" + changelog);
      logger.blue(`\n--- ${changelog.length}/500 caractères ---`);
    } else {
      logger.warning("Impossible de générer le changelog.", false);
    }
    return;
  }

  // Changelog-file-only mode (markdown format)
  if (process.argv.includes("--changelog-file")) {
    const changelogConfig = builderConfig?.changelog || {};
    const configManager = new ConfigManager("./src/config.json");
    const config = configManager.readConfig();
    await writeChangelogFile(config.version, changelogConfig);
    return;
  }

  // Determine platforms
  const hasIOS = process.argv.includes("--ios");
  const hasAndroid = process.argv.includes("--android");
  const hasBoth = process.argv.includes("--both");
  const noUpload = process.argv.includes("--no-upload");
  const platforms = [];
  if (hasBoth || hasIOS) platforms.push("ios");
  if (hasBoth || hasAndroid) platforms.push("android");
  if (platforms.length === 0) {
    logger.error("Spécifiez une plateforme: --ios, --android, ou --both");
  }

  const canUpload = !!builderConfig && !noUpload;

  if (noUpload) {
    logger.blue(">>> Mode --no-upload: build sans envoi sur les stores");
  } else if (!builderConfig) {
    logger.warning("Pas de capacitor-builder.config.json trouvé — mode legacy (ouverture IDE)", false);
  }

  // Save initial commit for tag workflow
  const initialCommit = execOutput("git rev-parse HEAD");

  // Git checks
  if (!options.force) {
    const branch = execOutput("git rev-parse --abbrev-ref HEAD");
    const hasUncommittedChanges = execOutput("git status --porcelain").length > 0;
    const hasWrongBranch = branch !== "main";

    if (hasWrongBranch || hasUncommittedChanges) {
      if (hasWrongBranch) logger.warning("Vous n'êtes pas sur la branche main.", false);
      if (hasUncommittedChanges) logger.warning("Des fichiers ne sont pas commités.", false);

      if (isNonInteractive) {
        logger.log("  [--yes] Poursuite automatique malgré les avertissements");
      } else {
        const { continueBuild } = await prompt([{
          message: "Vous n'êtes pas dans les conditions recommandées, mais voulez-vous continuer ?",
          name: "continueBuild",
          type: "confirm",
          default: false,
        }]);
        if (!continueBuild) logger.error("Build annulé.", true);
      }
    }
  }

  // Version bump
  const configManager = new ConfigManager("./src/config.json");
  const config = configManager.readConfig();

  const { increase_app_version, version_type, increase_build_version } = await prompt([
    { message: "Increase app version", name: "increase_app_version", type: "confirm", default: true },
    {
      message: "Version type", name: "version_type", type: "list",
      when: (a) => a.increase_app_version,
      choices: [
        { name: "patch (0.0.1)", value: "patch" },
        { name: "minor (0.1.0)", value: "minor" },
        { name: "major (1.0.0)", value: "major" },
      ],
    },
    { message: "Increase build", name: "increase_build_version", type: "confirm", default: true },
  ]);

  const new_config = { ...config };
  if (increase_app_version) {
    let v = (config.version + "").split(".").map((x) => parseInt(x) || 0);
    while (v.length < 3) v.push(0);
    if (version_type === "major") { v[0]++; v[1] = 0; v[2] = 0; }
    else if (version_type === "minor") { v[1]++; v[2] = 0; }
    else if (version_type === "patch") { v[2]++; }
    new_config.version = v.join(".");
  }
  if (increase_build_version) new_config.build += 1;
  configManager.writeConfig(new_config);

  logger.log("");
  logger.blue(`>>> Version: ${new_config.version} (build ${new_config.build})`);

  // Generate store changelog
  let changelog = null;
  const changelogConfig = builderConfig?.changelog || {};
  if (changelogConfig.provider && changelogConfig.provider !== "none") {
    changelog = await getChangelogFromUser(changelogConfig);
    if (changelog) {
      logger.success(`  Changelog validé (${changelog.length}/500 chars)`);
    }
  }

  // Build web
  logger.blue(">>> Building web...");
  exec("npm run build");

  // Sync
  logger.blue(">>> Syncing...");
  if (platforms.includes("android")) {
    exec("npx cap sync android");
  }
  if (platforms.includes("ios")) {
    exec("npx cap copy ios");
    if (fs.existsSync("ios/App/Podfile")) {
      exec("cd ios/App && pod install");
    } else {
      logger.blue(">>> SPM project detected, skipping pod install");
    }
  }

  // Update native versions
  logger.blue(">>> Updating native versions...");
  if (platforms.includes("android") && fs.existsSync("./android")) {
    exec(`npx capacitor-set-version set:android -v ${new_config.version} -b ${new_config.build}`);
  }
  if (platforms.includes("ios") && fs.existsSync("./ios")) {
    exec(`npx capacitor-set-version set:ios -v ${new_config.version} -b ${new_config.build}`);
  }

  // --- Build & Upload per platform ---

  if (platforms.includes("ios")) {
    if (canUpload && builderConfig.ios) {
      const archivePath = archiveIOS(builderConfig.ios, new_config.version);
      exportAndUploadIOS(builderConfig.ios, archivePath, new_config.version);
    } else if (noUpload && builderConfig && builderConfig.ios) {
      buildIOSOnly(builderConfig.ios, new_config.version);
    } else {
      logger.blue(">>> Ouverture de Xcode...");
      exec("npx cap open ios");
    }
  }

  if (platforms.includes("android")) {
    if (canUpload && builderConfig.android) {
      writeSigningProperties(builderConfig.android);
      try {
        const aabPath = buildAndroidAAB();
        await uploadToGooglePlay(builderConfig.android, aabPath, changelog);
      } finally {
        cleanSigningProperties();
      }
    } else if (noUpload && builderConfig && builderConfig.android) {
      writeSigningProperties(builderConfig.android);
      try {
        buildAndroidAAB();
      } finally {
        cleanSigningProperties();
      }
    } else {
      logger.blue(">>> Ouverture d'Android Studio...");
      exec("npx cap open android");
    }
  }

  // Generate CHANGELOG.md (markdown format)
  if (changelogConfig.provider && changelogConfig.provider !== "none") {
    await writeChangelogFile(new_config.version, changelogConfig);
  }

  // Git: commit version + tag workflow
  if (increase_app_version) {
    logger.log("");
    await handleTagWorkflow(new_config.version, initialCommit);
  }

  logger.success(`\n=> Build & deploy terminé — v${new_config.version} (build ${new_config.build})`);
}

main().catch((err) => {
  logger.error("An error occurred:");
  console.log(err);
  console.error(err);
  process.exit(1);
});
