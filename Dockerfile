# ビルドステージ（Bunでビルド）
FROM oven/bun:latest AS build
WORKDIR /app

# 依存関係をインストール（キャッシュマウント使用）
RUN --mount=type=bind,source=package.json,target=/app/package.json,readonly \
  --mount=type=bind,source=bun.lock,target=/app/bun.lock,readonly \
  bun install --frozen-lockfile --ignore-scripts

# TypeScriptのビルド
RUN --mount=type=bind,source=tsconfig.json,target=/app/tsconfig.json,readonly \
  --mount=type=bind,source=package.json,target=/app/package.json,readonly \
  --mount=type=bind,source=src,target=/app/src,readonly \
  bun run build

# 本番依存関係のインストールステージ
FROM oven/bun:latest AS package
WORKDIR /app

# Bunで本番依存関係のみインストール
RUN --mount=type=bind,source=package.json,target=/app/package.json,readonly \
  --mount=type=bind,source=bun.lock,target=/app/bun.lock,readonly \
  bun install --frozen-lockfile --ignore-scripts --omit=dev

# 本番用ステージ（Node.jsで実行）
FROM node:lts-slim
WORKDIR /app

RUN \
  --mount=type=cache,target=/var/lib/apt,sharing=locked \
  --mount=type=cache,target=/var/cache/apt,sharing=locked \
  apt-get update && apt-get install -y \
  ffmpeg

# ビルドステージから必要なファイルをコピー
COPY --from=package /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
