import chalk from "chalk";

class Logger {
  log(message, exit) {
    console.log(message);
    if (exit) process.exit(1);
  }

  error(message, exit = true) {
    console.error(chalk.red(message));
    if (exit) process.exit(1);
  }

  success(message, exit) {
    console.log(chalk.green(message));
    if (exit) process.exit(1);
  }

  warning(message, exit) {
    console.log(chalk.yellow(message));
    if (exit) process.exit(1);
  }

  blue(message, exit) {
    console.log(chalk.blue(message));
    if (exit) process.exit(1);
  }
}

export default Logger;
