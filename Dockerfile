FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN mkdir -p data drafts calendar uploads
EXPOSE 3000
CMD ["npm", "run", "start"]
