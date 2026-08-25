const express = require("express");

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
          `INSERT INTO yaml_files (name, content)
           VALUES ($1, $2)
           RETURNING id, name, content, updated_at`,
          [name, content]
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

      const { rows } = await pool.query(
        `UPDATE yaml_files
         SET content = $1, updated_at = NOW()
         WHERE id = $2
         RETURNING id, name, content, updated_at`,
        [content, id]
      );
      if (!rows[0]) {
        res.status(404).json({ error: "not found" });
        return;
      }
      res.json(rows[0]);
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
