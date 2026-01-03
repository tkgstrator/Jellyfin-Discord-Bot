FROM mcr.microsoft.com/devcontainers/base:dev-ubuntu24.04

RUN \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    --mount=type=cache,target=/var/cache/apt,sharing=locked \
    apt-get update && apt-get install -y \
    git-filter-repo