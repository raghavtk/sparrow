#!/usr/bin/env node
import { runMonitor } from "./monitor.js";
import { createLogger } from "./logger.js";
import { parseArgs } from "./utils.js";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const log = createLogger({ verbose: args.verbose, quiet: args.quiet });

  const { rows, table, counts } = await runMonitor({
    sitesFile: args.sites,
    dbPath: args.db,
    headless: args.headless,
    concurrency: args.concurrency,
    log
  });

  if (!args.quiet) {
    log.info("Run complete. Final report:");
  }
  console.table(table);
  console.log(
    `Totals: ${counts.total} | WORKING=${counts.working} SLOW=${counts.slow} BROKEN=${counts.broken} DOWN=${counts.down} REDIRECT-LOOP=${counts.redirectLoop} TOO-MANY-ADS=${counts.tooManyAds}`
  );

  const failed = rows.filter((r) => r.error_message);
  if (failed.length) {
    console.log("\nErrors:");
    for (const item of failed) {
      console.log(`- ${item.site_url}: ${item.error_message}`);
    }
  }
}

main().catch((err) => {
  console.error(`Fatal: ${err.message}`);
  process.exitCode = 1;
});
