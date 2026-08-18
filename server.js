const PROTO_PATH = __dirname + "/protos/runner.proto"

const grpc = require("@grpc/grpc-js");
const protoLoader = require('@grpc/proto-loader');
const { spawn } = require('child_process');

function getServer() {
    const packageDefinition = protoLoader.loadSync(
        PROTO_PATH,
        {keepCase: true,
         longs: String,
         enums: String,
         defaults: true,
         oneofs: true
        });
    const protoDescriptor = grpc.loadPackageDefinition(packageDefinition);
    const routeguide = protoDescriptor.runner;
    const server = new grpc.Server();

    server.addService(routeguide.RunnerService.service, {
      run: run,
    });

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

    output.stdout.on('data', (data) => {
        write(data.toString());
    });

    output.stderr.on('data', (data) => {
        write(`ERROR: ${data.toString()}`);
    });

    output.on('error', (err) => {
        write(`ERROR: ${err.message}\n`);
        if (!call.writableEnded) call.end();
    });

    output.on('close', (code) => {
        if (!call.writableEnded) call.end();
    });

    call.on('cancelled', () => {
        output.kill('SIGTERM');
    });
}

function main() {
    const server = getServer();
    server.bindAsync('0.0.0.0:50051', grpc.ServerCredentials.createInsecure(), () => {
        console.log("Server is running on port 50051");
    });
}

main(); 