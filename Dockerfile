FROM node:18-slim

# Sistema mínimo (Baileys conecta via WebSocket, não precisa de Chrome)
RUN apt-get update && apt-get install -y \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

RUN mkdir -p logs media

EXPOSE 3000

CMD ["npm", "start"]
