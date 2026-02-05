import child_process from "child_process";
import inquirer from "inquirer";
import OptionsManager from "./tools/options.mjs";
import Logger from "./tools/logger.mjs";
import ConfigManager from "./tools/configs.mjs";
import fs from "fs";

function runCommand(command, logger) {
  try {
    return child_process.execSync(command).toString();
  } catch (error) {
    logger.error(`Command failed: ${command}`);
    if (error?.stdout) console.log(error.stdout.toString());
    if (error?.stderr) console.error(error.stderr.toString());
    process.exit(1);
  }
}

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

    const hasUncommittedChanges =
        child_process.execSync("git status --porcelain").toString().trim()
            .length > 0;
    const hasWrongBranch = branch !== "main";

    if (hasWrongBranch || hasUncommittedChanges) {
      if (hasWrongBranch)
        logger.warning(
            "Vous n'êtes pas sur la branche main.",
            false
        );

      if (hasUncommittedChanges)
        logger.warning(
            "Des fichiers ne sont pas commités.",
            false
        );

      const { continueBuild } = await inquirer.prompt([
        {
          message: "Vous n'êtes pas dans les conditions recommandées, mais voulez-vous continuer ?",
          name: "continueBuild",
          type: "confirm",
          default: false,
        },
      ]);

      if (!continueBuild)
        logger.error("Build annulé.", true);
    }
  }

  const configManager = new ConfigManager("./src/config.json");
  const config = configManager.readConfig();

  const osOptions = {
    "--ios": "ios",
    "--android": "android",
  };

  const OS = process.argv.find((arg) => osOptions[arg]);

  if (!OS) logger.error("Cannot find OS to use for generating the app.", true);

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
          when: (answers) => answers.increase_app_version,
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
    const versionParts = (config.version + "").split(".").map((part) => Number.parseInt(part, 10) || 0);

    if (version_type === "minor") {
      versionParts[1] += 1;
      versionParts[2] = 0;
    } else if (version_type === "major") {
      versionParts[0] += 1;
      versionParts[1] = 0;
      versionParts[2] = 0;
    } else if (version_type === "patch") {
      versionParts[2] += 1;
    }

    new_config.version = versionParts.join(".");
  }

  if (increase_build_version) new_config.build += 1;

  logger.log("");

  logger.blue(">>> Building ...");
  logger.log(runCommand("npm run build", logger));

  logger.blue(">>> Syncing ...");
  logger.log(runCommand("npx cap sync", logger));

  logger.blue(">>> Updating version and build ...");

  if (fs.existsSync("./android")) {
    logger.log(
        runCommand(
            `capacitor-set-version set:android -v ${new_config.version} -b ${new_config.build}`,
            logger
        )
    );
  }

  if (fs.existsSync("./ios")) {
    logger.log(
        runCommand(
            `capacitor-set-version set:ios -v ${new_config.version} -b ${new_config.build}`,
            logger
        )
    );
  }

  configManager.writeConfig(new_config);

  logger.blue(">>> Run xCode or Android Studio ...");
  logger.log(
      runCommand(`npx cap open ${osOptions[OS]}`, logger)
  );

  if (increase_app_version) {
    logger.blue(">>> Tag version in VCS");
    logger.log(
        runCommand(`git tag v${new_config.version}`, logger)
    );
    logger.warning(
        `Tag v${new_config.version} created locally. Push it with: git push origin v${new_config.version}`,
        false
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
