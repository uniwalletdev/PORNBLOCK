# syntax=docker/dockerfile:1

FROM node:20-alpine AS development
WORKDIR /app
RUN apk add --no-cache dumb-init
COPY package*.json ./
RUN npm ci
EXPOSE 5173
ENTRYPOINT ["dumb-init", "--"]
CMD ["npm", "run", "dev"]

FROM development AS builder
COPY . .
RUN npm run build

FROM nginx:1.27-alpine AS production
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
