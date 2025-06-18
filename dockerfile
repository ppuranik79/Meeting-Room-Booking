FROM node:18-slim
WORKDIR /app

# install only production deps
COPY package.json package-lock.json ./
RUN npm install --production

# copy source
COPY . .

EXPOSE 4000
CMD ["node", "server.js"]
