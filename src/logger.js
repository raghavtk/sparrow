function formatTime() {
  return new Date().toISOString().slice(11, 19);
}

const LEVEL_LABELS = {
  info: "INFO ",
  step: "---- ",
  success: " OK  ",
  warn: "WARN ",
  error: "ERR  ",
  debug: "DBG  "
};

function makeLoggerMethods({ verbose, quiet, write }) {
  return {
    info(message) {
      write("info", message);
    },
    step(message) {
      write("step", message);
    },
    success(message) {
      write("success", message);
    },
    warn(message) {
      write("warn", message);
    },
    error(message) {
      write("error", message);
    },
    debug(message) {
      if (verbose && !quiet) {
        write("debug", message);
      }
    }
  };
}

/** Pretty CLI logger writing to stdout/stderr. */
export function createLogger({ verbose = false, quiet = false } = {}) {
  return makeLoggerMethods({
    verbose,
    quiet,
    write(level, message) {
      if (quiet) return;
      const stream = level === "warn" || level === "error" ? process.stderr : process.stdout;
      stream.write(`[${formatTime()}] ${LEVEL_LABELS[level]} ${message}\n`);
    }
  });
}

/**
 * Logger that emits structured `{ type: "log", level, message }` events.
 * Used by the in-process Express SSE API so the UI gets typed events.
 */
export function createEventLogger(onEvent, { verbose = false, quiet = false } = {}) {
  return makeLoggerMethods({
    verbose,
    quiet,
    write(level, message) {
      if (quiet) return;
      if (typeof onEvent === "function") {
        onEvent({
          type: "log",
          level,
          message,
          text: `[${formatTime()}] ${LEVEL_LABELS[level]} ${message}`
        });
      }
    }
  });
}
