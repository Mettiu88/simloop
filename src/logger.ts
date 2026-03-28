import type { LogLevel, SimLogger } from './types.js';

const LOG_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

/** Default console-based logger with simulation time prefix */
export class ConsoleLogger implements SimLogger {
  constructor(
    private name: string = 'Simulation',
    private minLevel: LogLevel = 'info',
  ) {}

  log(level: LogLevel, clock: number, message: string, data?: unknown): void {
    if (LOG_PRIORITY[level] < LOG_PRIORITY[this.minLevel]) return;

    const prefix = `[${this.name} t=${clock.toFixed(2)}] [${level.toUpperCase()}]`;
    const line = data !== undefined ? `${prefix} ${message}` : `${prefix} ${message}`;

    switch (level) {
      case 'debug':
        console.debug(line, ...(data !== undefined ? [data] : []));
        break;
      case 'info':
        console.info(line, ...(data !== undefined ? [data] : []));
        break;
      case 'warn':
        console.warn(line, ...(data !== undefined ? [data] : []));
        break;
      case 'error':
        console.error(line, ...(data !== undefined ? [data] : []));
        break;
    }
  }
}

/** Check if a log level passes the minimum threshold */
export function shouldLog(level: LogLevel, minLevel: LogLevel): boolean {
  return LOG_PRIORITY[level] >= LOG_PRIORITY[minLevel];
}
