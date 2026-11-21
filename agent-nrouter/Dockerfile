FROM oven/bun:1.3.10-slim
WORKDIR /app
COPY shared /shared
COPY agent-nrouter /app/agent-nrouter
WORKDIR /app/agent-nrouter
ENV PORT=8124
EXPOSE 8124
CMD ["bun", "src/main.ts"]
