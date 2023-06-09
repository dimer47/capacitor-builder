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
  }

  getOptions() {
    this.program.parse(process.argv);
    return this.program.opts();
  }
}

export default OptionsManager;
