// DEV-only console for the web app. In a production build (import.meta.env.DEV === false) every
// call does nothing, and the build drops the calls with their messages (vite.config.ts:
// treeshake.manualPureFunctions = LOG_PURE_NAMES in src/lib/logPure.ts), so neither the console nor the bundle carries
// them. The ONLY production console line is the start banner (src/redesign/main.tsx).
// Server (Render) logs are unaffected — this is the browser app only.
type LogFn = (...args: unknown[]) => void;
export interface Logger { log: LogFn; info: LogFn; warn: LogFn; error: LogFn; debug: LogFn }

const noop: LogFn = () => {};

export function makeLogger(enabled: boolean, sink: Pick<Console, "log" | "info" | "warn" | "error" | "debug"> = console): Logger {
  if (!enabled) return { log: noop, info: noop, warn: noop, error: noop, debug: noop };
  return {
    log: (...a) => sink.log(...a),
    info: (...a) => sink.info(...a),
    warn: (...a) => sink.warn(...a),
    error: (...a) => sink.error(...a),
    debug: (...a) => sink.debug(...a),
  };
}

export const log: Logger = makeLogger(import.meta.env.DEV === true);

