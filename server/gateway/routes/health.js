const express = require("express");

function createHealthRouter(pool, grpcHost) {
  const router = express.Router();

  router.get("/health", async (_req, res) => {
    try {
      await pool.query("SELECT 1");
      res.json({ ok: true, grpc: grpcHost, db: true });
    } catch {
      res.status(503).json({ ok: false, grpc: grpcHost, db: false });
    }
  });

  return router;
}

module.exports = { createHealthRouter };
