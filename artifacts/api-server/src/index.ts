import buildApp from "./app";
import { logger } from "./lib/logger";
import { pool } from "@workspace/db";
import { ensureReadMailTable, repairSettingsTables } from "./db/repairSettings";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// A database that missed schema changes broke every settings read and save.
// Repairs are additive, and a failure here never stops the server.
try {
  const done = [
    ...await repairSettingsTables((sql) => pool.query(sql)),
    ...await ensureReadMailTable((sql) => pool.query(sql)),
  ];
  if (done.length > 0) logger.info({ done }, "Repaired settings tables");
} catch (err) {
  logger.warn({ err }, "Couldn't check the settings tables");
}

const app = await buildApp();

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
