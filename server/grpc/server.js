const { spawn } = require("child_process");
const { grpc, loadRunner } = require("./load");

function getServer() {
  const runner = loadRunner();
  const server = new grpc.Server();
  server.addService(runner.RunnerService.service, { run });
  return server;
}

function run(call) {
  const command = call.request.command;
  const output = spawn(command, {
    shell: true,
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
  });

  const write = (text) => {
    if (!call.writableEnded) {
      call.write({ output: text });
    }
  };

  output.stdout.on("data", (data) => {
    write(data.toString());
  });

  output.stderr.on("data", (data) => {
    write(`ERROR: ${data.toString()}`);
  });

  output.on("error", (err) => {
    write(`ERROR: ${err.message}\n`);
    if (!call.writableEnded) call.end();
  });

  output.on("close", () => {
    if (!call.writableEnded) call.end();
  });

  call.on("cancelled", () => {
    output.kill("SIGTERM");
  });
}

function main() {
  const server = getServer();
  server.bindAsync("0.0.0.0:50051", grpc.ServerCredentials.createInsecure(), () => {
    console.log("gRPC server is running on port 50051");
  });
}

main();
