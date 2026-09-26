# syntax=docker/dockerfile:1

# ---------- 构建阶段：安装依赖（含 better-sqlite3 原生模块）并跑通全部测试 ----------
FROM node:20-slim AS build
WORKDIR /app

# better-sqlite3 优先下载预编译二进制；下载不可用时回退源码编译，需要工具链
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY src ./src
COPY test ./test
# 构建期跑全部物理钉死测试：测试不过则镜像构建失败，保证镜像里的公式就是被钉死的那套
RUN npm test

# ---------- 运行阶段：node:20-slim 精简运行时 ----------
FROM node:20-slim
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    SHIELDING_DB_PATH=/app/data/shielding.db
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/src ./src
COPY package.json ./

RUN mkdir -p /app/data && chown -R node:node /app
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/index.js"]
