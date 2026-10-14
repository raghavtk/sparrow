#!/bin/sh
set -eu
export SPARROW_BROWSER_EXECUTABLE="$(node -e 'process.stdout.write(require("playwright").chromium.executablePath())')"
exec node server.js
