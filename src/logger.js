function formatTime() {
  return new Date().toISOString().slice(11, 19);
}

export function createLogger({ verbose = false, quiet = false } = {}) {
  const write = (stream, label, message) => {
    if (quiet) return;
    stream.write(`[${formatTime()}] ${label} ${message}\n`);
  };

  return {
    info(message) {
      write(process.stdout, "INFO ", message);
    },
    step(message) {
      write(process.stdout, "---- ", message);
    },
    success(message) {
      write(process.stdout, " OK  ", message);
    },
    warn(message) {
      write(process.stderr, "WARN ", message);
    },
    error(message) {
      write(process.stderr, "ERR  ", message);
    },
    debug(message) {
      if (verbose && !quiet) {
        write(process.stdout, "DBG  ", message);
      }
    }
  };
}
