FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY src ./src
EXPOSE 8080
# Explicit 127.0.0.1, not localhost: Alpine's musl resolver returns ::1
# before 127.0.0.1, and BusyBox wget doesn't fall back across address
# families, so a plain "localhost" here fails on IPv6 even though the app
# (bound to 0.0.0.0, IPv4-only) is genuinely listening and healthy.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/health || exit 1
CMD ["node", "src/index.js"]
