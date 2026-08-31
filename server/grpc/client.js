const { loadRunner, grpc } = require("./load");

const GRPC_HOST = process.env.GRPC_HOST || "localhost:50051";

function getClient() {
  const runner = loadRunner();
  return new runner.RunnerService(GRPC_HOST, grpc.credentials.createInsecure());
}

function main() {
  const client = getClient();
  const call = client.run({ command: "ping -c 4 8.8.8.8" });

  call.on("data", (message) => {
    console.log("Received:", message);
  });
  call.on("error", (err) => {
    console.error("Error:", err);
  });
  call.on("end", () => {
    console.log("Command ended");
  });
}

main();
