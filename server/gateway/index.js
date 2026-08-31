const path = require("path");
const express = require("express");
const { grpc, loadRunner } = require("../grpc/load");
const { pool, initDb } = require("../db");
const { createFilesRouter } = require("./routes/files");
const { createHealthRouter } = require("./routes/health");
const { createRunRouter } = require("./routes/run");

const WEB_ROOT = path.join(__dirname, "..", "..", "web");
const GRPC_HOST = process.env.GRPC_HOST || "localhost:50051";
const PORT = Number(process.env.PORT) || 3000;

function createGrpcClient() {
  const runner = loadRunner();
  return new runner.RunnerService(GRPC_HOST, grpc.credentials.createInsecure());
}

const client = createGrpcClient();
const app = express();

app.use(express.json({ limit: "1mb" }));
app.use(express.static(WEB_ROOT));
app.use("/api/files", createFilesRouter(pool));
app.use("/api", createHealthRouter(pool, GRPC_HOST));
app.use("/api", createRunRouter(client));

app.use((err, _req, res, _next) => {
  console.error(err);
  if (res.headersSent) return;
  res.status(500).json({ error: err.message || "internal error" });
});

async function main() {
  await initDb();
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`FlowRunner gateway on http://localhost:${PORT}`);
    console.log(`Proxying gRPC to ${GRPC_HOST}`);
  });
}

main().catch((err) => {
  console.error("Failed to start gateway:", err);
  process.exit(1);
});
