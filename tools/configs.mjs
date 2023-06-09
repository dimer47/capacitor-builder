import fs from "fs";

class ConfigManager {
  constructor(configPath) {
    this.configPath = configPath;
  }

  readConfig() {
    const config = JSON.parse(fs.readFileSync(this.configPath, "utf-8"));
    return config;
  }

  writeConfig(config) {
    fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2));
  }
}


export default ConfigManager;
