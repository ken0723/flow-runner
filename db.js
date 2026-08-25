const { Pool } = require("pg");

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL || "postgres://flowrunner:flowrunner@localhost:5432/flowrunner",
});

const DEFAULT_CONTENT = `name: example-pipeline
on: manual
jobs:
  ping:
    steps:
      - name: ping dns
        run: ping -c 4 8.8.8.8
      - name: finish
        run: echo done
`;

async function waitForDb(attempts = 40) {
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch (err) {
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw lastError || new Error("database unavailable");
}

async function initDb() {
  await waitForDb();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS yaml_files (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      content TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  const { rows } = await pool.query("SELECT COUNT(*)::int AS count FROM yaml_files");
  if (rows[0].count === 0) {
    await pool.query("INSERT INTO yaml_files (name, content) VALUES ($1, $2)", [
      "pipeline.yml",
      DEFAULT_CONTENT,
    ]);
  }
}

module.exports = { pool, initDb };
