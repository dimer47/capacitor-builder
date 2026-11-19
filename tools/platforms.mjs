import child_process from "child_process";
import fs from "fs";

/**
 * Détection robuste des plateformes natives.
 *
 * On ne se fie PAS à la simple présence du dossier (`./android` / `./ios`) :
 * un dossier résiduel (ex. `.gradle`, `.idea` laissés après suppression de la
 * plateforme) ferait croire à tort qu'elle est là et ferait planter
 * capacitor-set-version. On exige le fichier projet réel.
 */

export function hasAndroidPlatform(root = ".") {
  return (
    fs.existsSync(`${root}/android/app/build.gradle`) ||
    fs.existsSync(`${root}/android/app/build.gradle.kts`)
  );
}

export function hasIOSPlatform(root = ".") {
  return (
    fs.existsSync(`${root}/ios/App/App.xcodeproj`) ||
    fs.existsSync(`${root}/ios/App/App.xcworkspace`)
  );
}

/**
 * Applique version + build à une plateforme via capacitor-set-version,
 * de façon ISOLÉE : une plateforme qui échoue n'empêche pas l'autre.
 * Retourne { platform, ok, skipped, error }.
 */
export function applyVersionToPlatform(platform, version, build, logger) {
  const present =
    platform === "android" ? hasAndroidPlatform() : hasIOSPlatform();

  if (!present) {
    logger?.log(`  ↳ ${platform} : absent, ignoré`);
    return { platform, ok: false, skipped: true, error: null };
  }

  try {
    logger?.blue(`>>> Sync version ${platform}...`);
    const out = child_process
      .execSync(
        `npx capacitor-set-version set:${platform} -v ${version} -b ${build}`,
        { stdio: "pipe" }
      )
      .toString();
    if (out.trim()) logger?.log(out.trim());
    return { platform, ok: true, skipped: false, error: null };
  } catch (err) {
    const msg = (err.stderr?.toString() || err.stdout?.toString() || err.message || "").trim();
    logger?.error(`  ↳ ${platform} : échec — ${msg}`, false);
    return { platform, ok: false, skipped: false, error: msg };
  }
}

/**
 * Synchronise la version sur TOUTES les plateformes présentes (iOS, Android ou
 * les deux), chacune isolée. Retourne la liste des résultats.
 * `targets` limite éventuellement aux plateformes demandées.
 */
export function syncVersionAllPlatforms(version, build, logger, targets = ["ios", "android"]) {
  const results = [];
  for (const platform of targets) {
    results.push(applyVersionToPlatform(platform, version, build, logger));
  }

  const done = results.filter((r) => r.ok).map((r) => r.platform);
  const failed = results.filter((r) => r.error);

  if (done.length) {
    logger?.success(`=> Version synchronisée : ${done.join(", ")} → v${version} (build ${build}).`);
  }
  if (!done.length && !failed.length) {
    logger?.warning("Aucune plateforme native détectée (ni iOS ni Android).", false);
  }
  if (failed.length) {
    logger?.error(
      `=> Échec sur : ${failed.map((r) => r.platform).join(", ")}. Les autres plateformes ont été traitées.`,
      false
    );
  }
  return results;
}
