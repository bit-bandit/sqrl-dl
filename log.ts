// so i cant screw up the numbers
const logLevelNames: Array<string> = [
  "quiet", // don't log to quiet please thanks
  "catastrophic",
  "error",
  "warning",
  "info",
  "verbose",
  "pedantic",
  "nittygritty",
  "debug",
];

// A map from a log level name's to its index.
export const log: Record<string, number> = {};

for (const [index, name] of Object.entries(logLevelNames)) {
  log[name] = parseInt(index); // javascript moment
}

// Configurable settings, including the log level.
export const logSettings: Record<string, any> = {
  errorLevel: log.error,
  warnLevel: log.warning,
  debugLevel: log.verbose,
  logLevel: log.info,
  prefix: false,
};

/**
 * Logs a message to the console via the appropriate APIs, except those not masked by the set log level.
 * @param {number} level The intended log level of the messages.
 * @param {Array<string>} messages The messages to log.
 */
export function logMessage(level: number, ...messages: Array<any>): void {
  if (level < 0 || level == log.quiet || level >= logLevelNames.length) {
    throw new Error("Invalid log level");
  }

  if (logSettings.prefix) {
    const logLevelNameUpper = logLevelNames[level].toUpperCase();
    messages.unshift(`[${logLevelNameUpper}]:`);
  }

  if (level <= logSettings.logLevel) {
    if (level <= logSettings.errorLevel) {
      console.error(...messages);
    } else if (level <= logSettings.warnLevel) {
      console.warn(...messages);
    } else if (level >= logSettings.debugLevel) {
      console.debug(...messages);
    } else {
      console.log(...messages);
    }
  }
}
