import child_process from "child_process";
import Logger from "./tools/logger.mjs";
import ConfigManager from "./tools/configs.mjs";
import fs from "fs";

async function main() {
	const logger = new Logger();

	const configManager = new ConfigManager("./src/config.json");
	const config = configManager.readConfig();

	logger.log("");

	logger.blue(">>> Updating version and build ...");

	if (fs.existsSync("./android")) {
		logger.log(
			child_process
				.execSync(
					`capacitor-set-version set:android -v ${config.version} -b ${config.build}`
				)
				.toString()
		);
	}

	if (fs.existsSync("./ios")) {
		logger.log(
			child_process
				.execSync(
					`capacitor-set-version set:ios -v ${config.version} -b ${config.build}`
				)
				.toString()
		);
	}

	logger.success("=> Successfully updated version and build.");
}

main().catch((err) => {
	const logger = new Logger();
	logger.error("An error occurred:");
	console.log(err);
	console.error(err);
	process.exit(1);
});
