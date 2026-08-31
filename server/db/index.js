const { Pool } = require("pg");
const { hashContent } = require("../lib/content-hash");

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL || "postgres://flowrunner:flowrunner@localhost:5432/flowrunner",
});

const DEFAULT_CONTENT = `name: pipeline
nodes:
  - id: start_1
    type: start
    name: pipeline
    x: 72
    y: 180
  - id: command_1
    type: command
    command: echo hello
    x: 360
    y: 180
  - id: end_1
    type: end
    echo: done
    x: 648
    y: 180
edges:
  - from: start_1
    to: command_1
  - from: command_1
    to: end_1
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
  await pool.query(`
    ALTER TABLE yaml_files
    ADD COLUMN IF NOT EXISTS content_hash TEXT
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS yaml_file_versions (
      id SERIAL PRIMARY KEY,
      file_id INTEGER NOT NULL REFERENCES yaml_files(id) ON DELETE CASCADE,
      version_number INTEGER NOT NULL,
      name TEXT NOT NULL UNIQUE,
      content TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (file_id, version_number)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS yaml_file_versions_file_id_created_at
    ON yaml_file_versions (file_id, created_at DESC)
  `);

  const { rows: missingHash } = await pool.query(
    `SELECT id, content FROM yaml_files
     WHERE content_hash IS NULL OR content_hash = ''`
  );
  for (const row of missingHash) {
    await pool.query("UPDATE yaml_files SET content_hash = $1 WHERE id = $2", [
      hashContent(row.content),
      row.id,
    ]);
  }

  const { rows } = await pool.query("SELECT COUNT(*)::int AS count FROM yaml_files");
  if (rows[0].count === 0) {
    await pool.query(
      "INSERT INTO yaml_files (name, content, content_hash) VALUES ($1, $2, $3)",
      ["pipeline.yml", DEFAULT_CONTENT, hashContent(DEFAULT_CONTENT)]
    );
  }
}

module.exports = { pool, initDb };
