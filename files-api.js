const express = require("express");
const { hashContent } = require("./content-hash");
const { applyContentChange } = require("./file-versions");

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function normalizeName(name) {
  const raw = String(name || "").trim().replace(/[/\\]/g, "");
  if (!raw || raw.length > 128) return null;
  const next = /\.ya?ml$/i.test(raw) ? raw : `${raw}.yml`;
  if (!/^[\w.-]+\.ya?ml$/i.test(next)) return null;
  return next;
}

function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function withTransaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore rollback failure
    }
    throw err;
  } finally {
    client.release();
  }
}

function publicFile(row) {
  if (!row) return row;
  return {
    id: row.id,
    name: row.name,
    content: row.content,
    updated_at: row.updated_at,
  };
}

function createFilesRouter(pool) {
  const router = express.Router();

  router.get(
    "/",
    asyncHandler(async (_req, res) => {
      const { rows } = await pool.query(
        "SELECT id, name, updated_at FROM yaml_files ORDER BY name ASC"
      );
      res.json(rows);
    })
  );

  router.post(
    "/",
    asyncHandler(async (req, res) => {
      const name = normalizeName(req.body?.name);
      if (!name) {
        res.status(400).json({ error: "invalid name" });
        return;
      }

      const content = typeof req.body?.content === "string" ? req.body.content : "";
      try {
        const { rows } = await pool.query(
          `INSERT INTO yaml_files (name, content, content_hash)
           VALUES ($1, $2, $3)
           RETURNING id, name, content, updated_at`,
          [name, content, hashContent(content)]
        );
        res.status(201).json(rows[0]);
      } catch (err) {
        if (err.code === "23505") {
          res.status(409).json({ error: "name already exists" });
          return;
        }
        throw err;
      }
    })
  );

  router.get(
    "/:id/versions",
    asyncHandler(async (req, res) => {
      const id = parseId(req.params.id);
      if (!id) {
        res.status(400).json({ error: "invalid id" });
        return;
      }

      const { rows: files } = await pool.query("SELECT id FROM yaml_files WHERE id = $1", [id]);
      if (!files[0]) {
        res.status(404).json({ error: "not found" });
        return;
      }

      const { rows } = await pool.query(
        `SELECT id, name, version_number, content_hash, created_at
         FROM yaml_file_versions
         WHERE file_id = $1
         ORDER BY version_number DESC`,
        [id]
      );
      res.json(rows);
    })
  );

  router.get(
    "/:id/versions/:versionId",
    asyncHandler(async (req, res) => {
      const id = parseId(req.params.id);
      const versionId = parseId(req.params.versionId);
      if (!id || !versionId) {
        res.status(400).json({ error: "invalid id" });
        return;
      }

      const { rows } = await pool.query(
        `SELECT id, file_id, name, version_number, content, content_hash, created_at
         FROM yaml_file_versions
         WHERE id = $1 AND file_id = $2`,
        [versionId, id]
      );
      if (!rows[0]) {
        res.status(404).json({ error: "not found" });
        return;
      }
      res.json(rows[0]);
    })
  );

  router.delete(
    "/:id/versions/:versionId",
    asyncHandler(async (req, res) => {
      const id = parseId(req.params.id);
      const versionId = parseId(req.params.versionId);
      if (!id || !versionId) {
        res.status(400).json({ error: "invalid id" });
        return;
      }

      const { rowCount } = await pool.query(
        "DELETE FROM yaml_file_versions WHERE id = $1 AND file_id = $2",
        [versionId, id]
      );
      if (!rowCount) {
        res.status(404).json({ error: "not found" });
        return;
      }
      res.json({ ok: true });
    })
  );

  router.post(
    "/:id/rollback",
    asyncHandler(async (req, res) => {
      const id = parseId(req.params.id);
      const versionId = parseId(req.body?.versionId);
      if (!id || !versionId) {
        res.status(400).json({ error: "invalid id" });
        return;
      }

      const updated = await withTransaction(pool, async (client) => {
        const { rows: files } = await client.query(
          `SELECT id, name, content, content_hash, updated_at
           FROM yaml_files
           WHERE id = $1
           FOR UPDATE`,
          [id]
        );
        if (!files[0]) return null;

        const { rows: versions } = await client.query(
          `SELECT id, content
           FROM yaml_file_versions
           WHERE id = $1 AND file_id = $2`,
          [versionId, id]
        );
        if (!versions[0]) return { missingVersion: true };

        const result = await applyContentChange(client, files[0], versions[0].content);
        return result.file;
      });

      if (!updated) {
        res.status(404).json({ error: "not found" });
        return;
      }
      if (updated.missingVersion) {
        res.status(404).json({ error: "not found" });
        return;
      }
      res.json(publicFile(updated));
    })
  );

  router.get(
    "/:id",
    asyncHandler(async (req, res) => {
      const id = parseId(req.params.id);
      if (!id) {
        res.status(400).json({ error: "invalid id" });
        return;
      }

      const { rows } = await pool.query(
        "SELECT id, name, content, updated_at FROM yaml_files WHERE id = $1",
        [id]
      );
      if (!rows[0]) {
        res.status(404).json({ error: "not found" });
        return;
      }
      res.json(rows[0]);
    })
  );

  router.put(
    "/:id",
    asyncHandler(async (req, res) => {
      const id = parseId(req.params.id);
      if (!id) {
        res.status(400).json({ error: "invalid id" });
        return;
      }

      const content = typeof req.body?.content === "string" ? req.body.content : null;
      if (content == null) {
        res.status(400).json({ error: "content is required" });
        return;
      }

      const updated = await withTransaction(pool, async (client) => {
        const { rows } = await client.query(
          `SELECT id, name, content, content_hash, updated_at
           FROM yaml_files
           WHERE id = $1
           FOR UPDATE`,
          [id]
        );
        if (!rows[0]) return null;
        const result = await applyContentChange(client, rows[0], content);
        return result.file;
      });

      if (!updated) {
        res.status(404).json({ error: "not found" });
        return;
      }
      res.json(publicFile(updated));
    })
  );

  router.delete(
    "/:id",
    asyncHandler(async (req, res) => {
      const id = parseId(req.params.id);
      if (!id) {
        res.status(400).json({ error: "invalid id" });
        return;
      }

      const { rowCount } = await pool.query("DELETE FROM yaml_files WHERE id = $1", [id]);
      if (!rowCount) {
        res.status(404).json({ error: "not found" });
        return;
      }
      res.json({ ok: true });
    })
  );

  return router;
}

module.exports = { createFilesRouter };
