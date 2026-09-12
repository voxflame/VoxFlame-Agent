# Frontend Dockerfile for VoxFlame
# Using DaoCloud Debian-based image for full glibc compatibility (required by Next.js SWC)

FROM docker.m.daocloud.io/library/node:20-slim AS base

# 安装依赖时使用阿里云 Debian 源
FROM base AS deps
WORKDIR /app

# 配置阿里云 Debian 源
RUN sed -i 's/deb.debian.org/mirrors.aliyun.com/g' /etc/apt/sources.list.d/debian.sources || \
    (echo "deb https://mirrors.aliyun.com/debian/ bookworm main contrib non-free non-free-firmware" > /etc/apt/sources.list && \
     echo "deb https://mirrors.aliyun.com/debian/ bookworm-updates main contrib non-free non-free-firmware" >> /etc/apt/sources.list)

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# 配置 npm 阿里云镜像源
RUN npm config set registry https://registry.npmmirror.com

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm ci

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app

# 配置阿里云 Debian 源
RUN sed -i 's/deb.debian.org/mirrors.aliyun.com/g' /etc/apt/sources.list.d/debian.sources || \
    (echo "deb https://mirrors.aliyun.com/debian/ bookworm main contrib non-free non-free-firmware" > /etc/apt/sources.list && \
     echo "deb https://mirrors.aliyun.com/debian/ bookworm-updates main contrib non-free non-free-firmware" >> /etc/apt/sources.list)

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# 配置 npm 阿里云镜像源
RUN npm config set registry https://registry.npmmirror.com

# Build Next.js
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_PHONE_AUTH_ENABLED
ARG NEXT_PUBLIC_RTC_EXECUTION_BACKEND
ARG NEXT_PUBLIC_ICP_BEIAN_NUMBER
ARG NEXT_PUBLIC_ICP_BEIAN_URL
ARG NEXT_PUBLIC_ICP_BEIAN_COMPANY_NAME
ARG NEXT_PUBLIC_ANDROID_APP_DOWNLOAD_URL
ARG NEXT_PUBLIC_IOS_APP_DOWNLOAD_URL
ARG BACKEND_INTERNAL_URL
ARG VOXFLAME_PUBLIC_BASE_URL
ARG NEXT_PUBLIC_VOXFLAME_SITE_MODE
ARG NEXT_PUBLIC_VOXFLAME_BRAND_NAME
ARG NEXT_PUBLIC_VOXFLAME_BRAND_ENGLISH_NAME
ARG NEXT_PUBLIC_VOXFLAME_BRAND_TAGLINE
ARG NEXT_PUBLIC_VOXFLAME_BRAND_LOGO_URL
ARG NEXT_PUBLIC_VOXFLAME_BRAND_ACCENT

ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_PHONE_AUTH_ENABLED=$NEXT_PUBLIC_PHONE_AUTH_ENABLED
ENV NEXT_PUBLIC_RTC_EXECUTION_BACKEND=$NEXT_PUBLIC_RTC_EXECUTION_BACKEND
ENV NEXT_PUBLIC_ICP_BEIAN_NUMBER=$NEXT_PUBLIC_ICP_BEIAN_NUMBER
ENV NEXT_PUBLIC_ICP_BEIAN_URL=$NEXT_PUBLIC_ICP_BEIAN_URL
ENV NEXT_PUBLIC_ICP_BEIAN_COMPANY_NAME=$NEXT_PUBLIC_ICP_BEIAN_COMPANY_NAME
ENV NEXT_PUBLIC_ANDROID_APP_DOWNLOAD_URL=$NEXT_PUBLIC_ANDROID_APP_DOWNLOAD_URL
ENV NEXT_PUBLIC_IOS_APP_DOWNLOAD_URL=$NEXT_PUBLIC_IOS_APP_DOWNLOAD_URL
ENV BACKEND_INTERNAL_URL=$BACKEND_INTERNAL_URL
ENV VOXFLAME_PUBLIC_BASE_URL=$VOXFLAME_PUBLIC_BASE_URL
ENV NEXT_PUBLIC_VOXFLAME_SITE_MODE=$NEXT_PUBLIC_VOXFLAME_SITE_MODE
ENV NEXT_PUBLIC_VOXFLAME_BRAND_NAME=$NEXT_PUBLIC_VOXFLAME_BRAND_NAME
ENV NEXT_PUBLIC_VOXFLAME_BRAND_ENGLISH_NAME=$NEXT_PUBLIC_VOXFLAME_BRAND_ENGLISH_NAME
ENV NEXT_PUBLIC_VOXFLAME_BRAND_TAGLINE=$NEXT_PUBLIC_VOXFLAME_BRAND_TAGLINE
ENV NEXT_PUBLIC_VOXFLAME_BRAND_LOGO_URL=$NEXT_PUBLIC_VOXFLAME_BRAND_LOGO_URL
ENV NEXT_PUBLIC_VOXFLAME_BRAND_ACCENT=$NEXT_PUBLIC_VOXFLAME_BRAND_ACCENT

RUN npm run build

# Production image
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

# 配置阿里云 Debian 源
RUN sed -i 's/deb.debian.org/mirrors.aliyun.com/g' /etc/apt/sources.list.d/debian.sources || \
    (echo "deb https://mirrors.aliyun.com/debian/ bookworm main contrib non-free non-free-firmware" > /etc/apt/sources.list && \
     echo "deb https://mirrors.aliyun.com/debian/ bookworm-updates main contrib non-free non-free-firmware" >> /etc/apt/sources.list)

# Install runtime utilities
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create logs directory
RUN mkdir -p /app/logs && chmod 777 /app/logs

RUN groupadd --system --gid 1001 nodejs
RUN useradd --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
RUN mkdir .next
RUN chown nextjs:nodejs .next

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Use startup script to serve the public HTTP entrypoint
COPY --chmod=755 docker-entrypoint.sh /app/docker-entrypoint.sh
COPY --chown=nextjs:nodejs proxy-server.cjs /app/proxy-server.cjs

USER nextjs

CMD ["/app/docker-entrypoint.sh"]
