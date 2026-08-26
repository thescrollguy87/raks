# Stage 1: build the static bundle with Vite.
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
# VITE_* vars are baked into the JS bundle at build time (Vite convention),
# not read at container startup — pass them as build args, not runtime env,
# or the frontend will silently use whatever was baked in at build time.
ARG VITE_API_PROXY_TARGET
ARG VITE_DEFAULT_STATION_ID
RUN npm run build

# Stage 2: serve the built files with nginx — no Node runtime needed in
# the final image, just static files.
FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
