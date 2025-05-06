import child_process from "child_process";
import inquirer from "inquirer";
import OptionsManager from "./tools/options.mjs";
import Logger from "./tools/logger.mjs";
import ConfigManager from "./tools/configs.mjs";
import fs from "fs";

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
          choices: [
            { name: "patch (0.0.1)", value: "patch", description: "Increment x.x.1" },
            { name: "minor (0.1.0)", value: "minor", description: "Increment x.1.x" },
            { name: "major (1.0.0)", value: "major", description: "Increment 1.x.x" },
          ],
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
    let versionParts = (config.version+"").split('.');
    versionParts[0] = versionParts[0] ? parseInt(versionParts[0]) : 0;
    versionParts[1] = versionParts[1] ? parseInt(versionParts[1]) : 0;
    versionParts[2] = versionParts[2] ? parseInt(versionParts[2]) : 0;

    if(version_type === "minor") {
      versionParts[1] = parseInt(versionParts[1]) + 1;
      versionParts[2] = 0;
    } else if(version_type === "major") {
      versionParts[0] = parseInt(versionParts[0]) + 1;
      versionParts[1] = 0;
      versionParts[2] = 0;
    } else if(version_type === "patch") {
      versionParts[2] = parseInt(versionParts[2]) + 1;
    }
    new_config.version = versionParts.join('.');
  }

  if (increase_build_version) new_config.build += 1;

  configManager.writeConfig(new_config);

  logger.log("");

  logger.blue(">>> Building ...");
  logger.log(child_process.execSync("npm run build").toString());

  logger.blue(">>> Syncing ...");
  logger.log(child_process.execSync("npx cap sync").toString());

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
