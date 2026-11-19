import Logger from "./tools/logger.mjs";
import ConfigManager from "./tools/configs.mjs";
import { syncVersionAllPlatforms } from "./tools/platforms.mjs";

async function main() {
	const logger = new Logger();

	const configManager = new ConfigManager("./src/config.json");
	const config = configManager.readConfig();

	logger.log("");
	logger.blue(`>>> Sync version ${config.version} (build ${config.build}) sur les plateformes présentes...`);

	// Résilient : iOS seul, Android seul ou les deux. Chaque plateforme est
	// isolée (l'échec de l'une ne bloque pas l'autre), et une plateforme
	// absente (dossier résiduel sans fichier projet) est ignorée proprement.
	const results = syncVersionAllPlatforms(config.version, config.build, logger);

	// Sortie non-zéro uniquement si une plateforme PRÉSENTE a échoué.
	if (results.some((r) => r.error)) process.exit(1);
}

main().catch((err) => {
	const logger = new Logger();
	logger.error("An error occurred:");
	console.error(err);
	process.exit(1);
});
