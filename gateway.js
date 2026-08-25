const path = require("path");
const express = require("express");
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const { pool, initDb } = require("./db");
const { createFilesRouter } = require("./files-api");

const PROTO_PATH = path.join(__dirname, "protos", "runner.proto");
const GRPC_HOST = process.env.GRPC_HOST || "localhost:50051";
const PORT = Number(process.env.PORT) || 3000;

function createGrpcClient() {
  const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  const proto = grpc.loadPackageDefinition(packageDefinition);
  return new proto.runner.RunnerService(
    GRPC_HOST,
    grpc.credentials.createInsecure()
  );
}

const client = createGrpcClient();
const app = express();

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "web")));
app.use("/api/files", createFilesRouter(pool));

app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, grpc: GRPC_HOST, db: true });
  } catch {
    res.status(503).json({ ok: false, grpc: GRPC_HOST, db: false });
  }
});

app.post("/api/run", (req, res) => {
  const command = typeof req.body?.command === "string" ? req.body.command.trim() : "";

  if (!command) {
    res.status(400).json({ error: "command is required" });
    return;
  }

  console.log("Run:", command);

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof req.socket?.setNoDelay === "function") {
    req.socket.setNoDelay(true);
  }
  res.flushHeaders();
  // SSE comment so the browser/fetch gets a first chunk immediately
  res.write(": connected\n\n");

  let closed = false;
  const call = client.run({ command });

  const send = (payload) => {
    if (closed || res.writableEnded) return;
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  const finish = (payload) => {
    if (closed) return;
    closed = true;
    if (payload && !res.writableEnded) send(payload);
    if (!res.writableEnded) res.end();
  };

  call.on("data", (message) => {
    send({ type: "log", output: message.output || "" });
  });

  call.on("end", () => {
    finish({ type: "done" });
  });

  call.on("error", (err) => {
    if (err.code === grpc.status.CANCELLED) {
      finish({ type: "done" });
      return;
    }
    console.error("gRPC error:", err.message);
    finish({
      type: "error",
      message: err.details || err.message || "gRPC stream failed",
    });
  });

  // Listen on the response, not the request: Express has already
  // finished reading the POST body, which can emit req "close".
  res.on("close", () => {
    if (closed) return;
    closed = true;
    call.cancel();
  });
});

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
