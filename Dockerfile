FROM node:20-alpine

WORKDIR /usr/src/app

RUN apk add --no-cache ffmpeg

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 -G nodejs

COPY package*.json ./
RUN npm ci --only=production

COPY . .

RUN mkdir -p uploads/videos processed && \
    chown -R nodejs:nodejs /usr/src/app

USER nodejs

EXPOSE 3000

CMD ["node", "app.js"]