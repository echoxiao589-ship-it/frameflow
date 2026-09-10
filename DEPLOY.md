# 部署到服务器（免费方案）

本项目是一个标准的单端口 Node.js HTTP 服务（无第三方依赖），可以部署到任意支持 Node 的云平台。

## 一、部署前的两个关键设置

| 环境变量 | 作用 | 本地 | 服务器 |
| --- | --- | --- | --- |
| `PORT` | 监听端口。**平台会注入**；只要它存在，服务就自动绑定 `0.0.0.0` 并放行任意域名 | 不设 | 平台自动注入 |
| `HOST` | 手动指定监听地址，覆盖上面的自动判断 | `127.0.0.1` | `0.0.0.0` |
| `ALLOWED_HOSTS` | 允许访问的域名，逗号分隔；`*` 表示放行全部 | 只放行本机 | `*` |
| `DATA_DIR` | 项目与媒体文件落盘目录，默认 `./data` | 默认 | 建议挂载持久卷 |

> 只要平台注入了 `PORT`，主机白名单会自动放行公网域名，**无需再手工配置**。
> 如果手动 `node server.mjs` 对外提供服务，请显式设置 `HOST=0.0.0.0`。

## 二、三种部署方式

### 1. Render（免费、无需信用卡，推荐）

在 Render 控制台直接建 Web Service：New + → Web Service → 选本仓库 → 填写：

| 字段 | 值 |
| --- | --- |
| Name | `frameflow` |
| Region | Singapore（国内访问最快） |
| Build Command | `npm install` |
| Start Command | `node server.mjs` |
| Instance Type | Free（512 MB / 0.1 CPU，无需信用卡） |

> **端口不用填**：Render 会注入 `PORT`，服务会自动绑定 `0.0.0.0` 并放行公网域名。

也可以走 Blueprint：仓库已含 `render.yaml`，New + → Blueprint → 选本仓库 → Apply，环境变量会自动填好。

免费档的两个限制：**15 分钟无访问会休眠**（下次打开冷启动 30～60 秒）、**文件系统临时**（重新部署后 `data/` 清空）。

### 2. Docker（任意容器平台 / 自建服务器）

仓库已含 `Dockerfile`：

```bash
docker build -t frameflow .
docker run -d -p 8080:8080 --name frameflow \
  -v frameflow-data:/app/data \
  frameflow
# 访问 http://服务器IP:8080
```

挂载 `/app/data` 到持久卷，项目数据才不会随容器重建丢失。

### 3. Koyeb / 其他 Node 平台

> ⚠️ **Koyeb 免费版已关闭**：2026 年 2 月 Koyeb 被 Mistral AI 收购，免费 Starter 计划不再对新用户开放（新账号最低 $29/月）。仍在运行的老账号不受影响，但新部署请改用上面第 1 种方式。

其他支持 Node 的平台可直接用 Git 部署，平台会执行 `npm install` 与 `npm start`（即 `node server.mjs`）；若平台**不注入 `PORT`**，需手动设置 `HOST=0.0.0.0`。

## 三、绑定自己的域名

在平台的 Domains / Custom Domain 里添加域名，然后到你的 DNS 服务商添加一条记录：

| 要绑定的域名 | 记录类型 | 记录值 |
| --- | --- | --- |
| `www.你的域名` | CNAME | 平台给你的默认域名（如 `xxx.onrender.com`） |
| `你的域名`（裸域） | A / ALIAS | 平台提供的 IP，或用 CNAME 扁平化 / 301 跳转到 www |

证书由平台自动签发（Let's Encrypt），无需自己配置 HTTPS。

**注意**：域名解析到**中国大陆境内**的服务器，必须先完成 ICP 备案；解析到中国香港、新加坡、日韩、欧美等境外节点则不需要备案。

## 四、已知限制

- **中文配音**：本地语音合成依赖 Windows 系统语音（SAPI）。部署到 Linux 服务器时，
  「生成分镜声音」会自动降级为等长静音音轨，画面、字幕、配乐、时长全部正常，
  整条流程仍可完整跑通；接入生成网关（`AI_PROVIDER=gateway`）即可换成真人配音。
- **数据持久化**：项目数据以 JSON 文件存放在 `DATA_DIR`。多数免费平台的文件系统是临时的，
  重新部署或休眠唤醒后可能重置，如需长期保存请挂载持久卷或改用数据库。

## 五、常见问题

- **打开是 403「不允许的访问主机」**：说明 `PORT` 未注入且 `ALLOWED_HOSTS` 没放行该域名。
  设置 `ALLOWED_HOSTS=*` 或直接设置 `HOST=0.0.0.0`。
- **页面能开但提交无反应**：写入请求需要同源。若前面还套了一层代理并且改写了 `Host` 头，
  请确保 `Host` 与浏览器地址栏域名一致。
- **录屏导出（HTML 模式）没反应**：浏览器录屏要求在 HTTPS 页面或 `localhost` 下使用，
  并需要你在弹窗中手动选择「当前标签页」。
