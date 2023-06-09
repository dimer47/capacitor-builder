import fs from "fs";
import child_process from "child_process";
import inquirer from "inquirer";
import OptionsManager from "./tools/options.mjs";
import Logger from "./tools/logger.mjs";
import ConfigManager from "./tools/configs.mjs";

async function main() {
  const optionsManager = new OptionsManager();
  const logger = new Logger();

  optionsManager.defineOptions();
  const options = optionsManager.getOptions();

  if (!options.force) {
    const branch = child_process
      .execSync("git rev-parse --abbrev-ref HEAD")
      .toString()
      .trim();
    if (branch !== "main")
      logger.error(
        "Please use main branch to generate build of application.",
        true
      );

    if (
      child_process.execSync("git status --porcelain").toString().trim()
        .length > 0
    )
      logger.warning(
        "=> Please commit changes before running the app build.",
        true
      );
  }

  const configManager = new ConfigManager("./src/config.json");
  const config = configManager.readConfig();

  const osOptions = {
    "--ios": "ios",
    "--android": "android",
  };

  const OS = process.argv.find((arg) => osOptions[arg]);

  if (!OS) logger.error("Cannot find OS to use for generating the app.");

  const { increase_app_version, version_type, increase_build_version } =
    await inquirer.prompt([
      {
        message: "Increase app version",
        name: "increase_app_version",
        type: "confirm",
        default: true,
      },
      {
        message: "Version type",
        name: "version_type",
        type: "list",
        choices: ["minor", "major"],
      },
      {
        message: "Increase build",
        name: "increase_build_version",
        type: "confirm",
        default: true,
      },
    ]);

  const new_config = { ...config };

  if (increase_app_version) {
	  const newVersion = Number(config.version) + (version_type === "minor" ? 0.1 : 1);
	  new_config.version = Number(newVersion.toFixed(2));
  }

  if (increase_build_version) new_config.build += 1;

  configManager.writeConfig(new_config);

  logger.log("");

  logger.blue(">>> Building ...");
  logger.log(child_process.execSync("npm run build").toString());

  logger.blue(">>> Syncing ...");
  logger.log(child_process.execSync("npx cap sync").toString());

  logger.blue(">>> Updating version and build ...");
  logger.log(
    child_process
      .execSync(
        `capacitor-set-version set:${osOptions[OS]} -v ${new_config.version} -b ${new_config.build}`
      )
      .toString()
  );

  logger.blue(">>> Run xCode or Android Studio ...");
  logger.log(
    child_process.execSync(`npx cap open ${osOptions[OS]}`).toString()
  );

  if (increase_app_version) {
    logger.blue(">>> Tag version in VCS");
    logger.log(
      child_process.execSync(`git tag v${new_config.version}`).toString()
    );
  }

  logger.success("=> Build success");
}

main().catch((err) => {
  const logger = new Logger();
  logger.error("An error occurred:");
  console.log(err);
  console.error(err);
  process.exit(1);
});
