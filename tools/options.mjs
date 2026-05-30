import { program } from "commander";

class OptionsManager {
  constructor() {
    this.program = program;
  }

  defineOptions() {
    this.program.option(
      "-f, --force",
      "Force generation of build even if not in main branch or not commit changes."
    );
    this.program.option("--ios", "Generate build for iOS.");
    this.program.option("--android", "Generate build for Android.");
    this.program.option("--both", "Generate build for both iOS and Android.");
    this.program.option("--no-upload", "Build without uploading to stores.");
    this.program.option("--changelog", "Generate changelog only (no build).");
    this.program.option("--tag", "Tag the current version (no build).");
    this.program.option("--init", "Create capacitor-builder.config.json interactively.");
    this.program.option("--check", "Validate capacitor-builder.config.json.");
    this.program.option("--commit", "Commit version bump and tag.");
    this.program.option("-h, --help", "Show help.");
  }

  getOptions() {
    this.program.parse(process.argv);
    return this.program.opts();
  }
}

export default OptionsManager;
