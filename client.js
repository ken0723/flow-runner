const PROTO_PATH = __dirname + "/protos/runner.proto"

const grpc = require("@grpc/grpc-js");
const protoLoader = require('@grpc/proto-loader');

function getClient() {
    const packageDefinition = protoLoader.loadSync(
        PROTO_PATH,
        {keepCase: true,
         longs: String,
         enums: String,
         defaults: true,
         oneofs: true
    });

    const protoDescriptor = grpc.loadPackageDefinition(packageDefinition);
    const runner = protoDescriptor.runner;
    const client = new runner.RunnerService('localhost:50051', grpc.credentials.createInsecure());

    return client;
}

function main() {
    const client = getClient();
    const call = client.run({ command: "ping -c 4 8.8.8.8" });

    call.on('data', (message) => {
        console.log("Received:", message);
    });
    call.on('error', (err) => {
        console.error("Error:", err);
    });
    call.on('end', () => {
        console.log("Command ended");
    });
}

main();