const express = require("express");
const { grpc } = require("../../grpc/load");

function createRunRouter(client) {
  const router = express.Router();

  router.post("/run", (req, res) => {
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

    res.on("close", () => {
      if (closed) return;
      closed = true;
      call.cancel();
    });
  });

  return router;
}

module.exports = { createRunRouter };
