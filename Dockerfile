FROM node:20-alpine

RUN apk add --no-cache iputils

WORKDIR /app

COPY package*.json ./

RUN npm install --production

COPY . .

EXPOSE 50051 3000

CMD ["node", "server/grpc/server.js"]