FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080

# 无第三方依赖，直接把源码与前端资源复制进镜像
COPY package.json server.mjs ./
COPY lib ./lib
COPY public ./public

# 项目与媒体数据的落盘目录（容器内可写；需要长期保存请挂载持久卷）
RUN mkdir -p data

EXPOSE 8080
CMD ["node", "server.mjs"]
