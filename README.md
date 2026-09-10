# 帧序 Frameflow

可运行的 B/S 视频制作网站。前端采用原生 HTML / CSS / JavaScript，后端采用 Node.js 原生 HTTP 服务，项目数据保存到服务器文件。无需安装 npm 依赖。

## 启动

需要 Node.js 22 或更高版本。本地中文配音使用 Windows 已安装的 SAPI 中文语音。

Windows 双击 `start.cmd`，然后在 Chrome / Edge 打开 **http://127.0.0.1:4173**。

也可在此目录执行：

```powershell
npm start
```

保持服务窗口运行。关闭窗口或按 Ctrl+C 会停止网站，但已保存的项目与视频仍保留。HTML 不应直接双击打开，必须通过后端地址访问。

默认仅监听本机，这是单用户本地版本；尚未加入账号体系、多租户和分布式任务队列。

## 严格制作流程

```text
生成脚本 → 生成大纲 → 拆分分镜 → 生成分镜画面 → 生成分镜声音
                                     ↑                │
                                     └── 调整画面 ────┤
                                                      ↓
                                               预览与修改 → 录屏输出
```

1. 首页先选择图片轮播或 HTML 视频模式，再输入创作提示词。
2. 脚本生成完成后，可以编辑并保存脚本。
3. 从脚本生成大纲，支持逐章节编辑。
4. 从大纲拆分分镜，支持编辑标题、画面描述、旁白及最短时长。
5. 生成全部分镜画面。图片模式使用独立图片；HTML 模式使用独立沙盒 iframe 播放真正的 HTML / CSS 动画。
6. 生成分镜声音，包括旁白文件和所选配乐。分镜长度自动适配配音，避免旁白被截断。
7. 预览并检查结果，勾选确认后才能录屏输出。导出完成后文件存入后台并提供下载。

可点击“连续生成至声音”依次运行生成步骤。该操作停在预览阶段，不替用户确认。

后台独立验证步骤前置条件，直接调用 API 也不能跳步。每次保存使用版本号校验，阻止旧页面覆盖新内容；同一项目生成时禁止并发修改。生成失败可重试，服务重启会将未完成任务恢复为失败状态。

### 修改后的失效规则

| 修改内容 | 保留内容 | 必须重新制作 |
| --- | --- | --- |
| 创作提示词 | 已导出的历史文件 | 全部步骤 |
| 完整脚本 | 修改后的脚本 | 大纲及后续步骤 |
| 大纲 | 脚本、修改后的大纲 | 分镜及后续步骤 |
| 分镜标题、画面描述、旁白、时长 | 脚本、大纲、修改后的分镜 | 画面、声音、预览确认、录屏 |
| 返回重新生成画面 | 脚本、大纲、分镜 | 画面、声音、预览确认、录屏 |
| 配乐或重新生成声音 | 脚本、大纲、分镜、画面 | 声音、预览确认、录屏 |

画面与声音采用整组生成，当前版本不做单分镜局部增量生成。旧导出文件始终标记为历史版本。

## 默认模式与 AI 接入

默认 `AI_PROVIDER=demo`：

- 脚本、大纲、分镜使用本地模板，不能代替大模型的自由语义理解。
- 图片是程序绘制的 SVG 示例插画，不会伪装为 AI 生图。
- HTML 为实际 HTML / CSS 动画，具备时间轴驱动的播放、暂停、跳转。
- 配音调用 Windows SAPI，真实生成 PCM WAV；没有中文语音引擎时此步骤明确失败，不能跳过。
- 背景音乐是原创合成的轻柔 / 明亮和弦音轨，或不使用配乐。

接入真实 AI 时，将 `.env.example` 复制为 `.env`：

```dotenv
AI_PROVIDER=gateway
AI_GATEWAY_URL=https://your-generation-service.example/generate
AI_GATEWAY_KEY=your-server-side-key
```

这里的网关是**本项目定义的统一生成协议**，不是任何厂商 API 的直接兼容地址。你的网关需要把以下请求转为所选大模型、生图模型和 TTS 的调用。密钥仅由后端读取，不写入前端，也不随项目返回。当前交付未附第三方 API 密钥、未调用付费 AI 服务。

### 统一生成协议

每次调用 `AI_GATEWAY_URL` 使用 POST，JSON 请求头及可选 `Authorization: Bearer ...`。请求只包含生成需要的素材：

```json
{
  "stage": "scenes",
  "mode": "html",
  "prompt": "介绍一款创作工具",
  "script": "已生成的完整脚本",
  "outline": [{"title":"开场","summary":"引入创作主题"}],
  "scenes": []
}
```

各步骤返回格式：

```json
{"script":"完整脚本"}
```

```json
{"outline":[{"title":"章节标题","summary":"章节摘要"}]}
```

```json
{"scenes":[{"title":"分镜标题","narration":"旁白和字幕","visualPrompt":"画面描述","duration":8}]}
```

图片模式 `visuals`：

```json
{"visuals":[{"mime":"image/png","base64":"原始图片的 Base64，不带 data: 前缀"}]}
```

支持 PNG、JPEG、WebP；图片序列必须与请求中的分镜顺序和数量一致。

HTML 模式 `visuals`：

```json
{"visuals":[{"html":"<style>h1{animation:in 1s both}@keyframes in{from{opacity:0}to{opacity:1}}</style><h1>创作，从这里开始</h1>"}]}
```

设计画布为 1280 × 720。请使用 HTML、CSS、内联 SVG 与 CSS 动画；自定义 JavaScript、外部脚本、网络访问、表单、导航和嵌套 iframe 会被限制。时间轴通过内置控制器统一驱动 CSS 动画。当前版本不支持依赖任意 JavaScript 动画库的页面。

声音 `audio`：

```json
{"audio":[{"base64":"PCM WAV 文件的 Base64"}]}
```

声音序列与分镜一致。后端解析 WAV 实际时长，单镜头声音上限 60 秒。网关应返回 1–12 个分镜，每段旁白不超过 400 字；大纲 1–12 章，完整脚本不超过 12000 字。网关超时为 120 秒，错误会保留在项目状态中供重试。

## 录屏与导出

- 图片模式：录制 1280 × 720 Canvas，与 Web Audio 混合的旁白和配乐同时写入视频。
- HTML 模式：浏览器弹出标签页选择器，选择**当前网站标签页**。页面进入专用预览画面；支持区域裁剪时自动裁剪，不支持时记录铺满页面的标签页视口。最终尺寸取决于捕获视口。
- HTML 模式需要浏览器提供 `getDisplayMedia`；推荐在独立 Chrome / Edge 中使用，嵌入式浏览器可能不提供标签页共享。
- 录制时保持前台，按 Esc 或停止共享会取消；后台不会把不完整的录制标记为已完成。
- 输出格式按浏览器支持情况选择 WebM / MP4，未加入 FFmpeg 转码。
- 导出文件最大 150 MB。上传失败会尝试下载本地备份，后台仍保持未完成状态。
- 当前后台只检查上传文件类型、大小与容器签名，不进行视频解码验证。

## 后端接口

所有修改请求要求 `X-Frameflow-Client: studio`，JSON 请求要求 `Content-Type: application/json`。同源校验用于本地服务。已有项目修改必须携带当前 `revision`。

| 方法与路径 | 用途 |
| --- | --- |
| `GET /api/config` | 获取当前生成模式与步骤名称 |
| `GET /api/projects` | 获取项目列表 |
| `POST /api/projects` | 创建项目，参数 `mode`、可选 `prompt` |
| `GET /api/projects/:id` | 获取完整项目与步骤状态 |
| `PATCH /api/projects/:id` | 编辑 `prompt`、`script`、`outline`、`scene` 或 `musicStyle`（一次一种） |
| `DELETE /api/projects/:id` | 删除项目记录；媒体文件保留 |
| `POST /api/projects/:id/run` | 执行 `stage`，只支持前五个生成步骤 |
| `POST /api/projects/:id/review` | `confirmed: true` 确认预览 |
| `POST /api/projects/:id/export/start` | 生成导出会话令牌 |
| `POST /api/projects/:id/export` | 上传二进制视频，请求头 `X-Export-Token` |
| `GET /assets/:file` | 访问图片与音频，支持媒体范围读取 |
| `GET /exports/:file` | 下载已保存的视频 |

## 文件结构

```text
frameflow/
  public/             前端页面、样式、时间轴与录制逻辑
  lib/store.mjs       顺序校验、失效规则与原子文件保存
  lib/provider.mjs    本地生成与统一 AI 网关适配器
  lib/speech.ps1      Windows 中文语音生成
  server.mjs         后端 API、媒体与导出服务
  tests/             集成测试
  data/              首次启动自动创建，备份时保留整个目录
```

`data/projects.json` 存储项目元数据，`data/assets/` 存储分镜图片和 WAV，`data/exports/` 存储导出视频。为支持历史版本和失败重试，旧资源不自动删除。

## 验证

```powershell
npm test
```

测试包括跳步拒绝、两种模式生成、上游修改失效、画面与声音回退、版本冲突、并发任务、网关失败重试、输入校验、同源校验、导出会话与服务重启，以及 Windows 本地真实语音合成。测试网关使用临时本地服务，不调用外部模型。

开发环境若限制 Windows 注册表访问，本地语音测试需要在普通 Windows 终端中运行。语音文件接口参考：[Microsoft SpFileStream 文档](https://learn.microsoft.com/en-us/previous-versions/windows/desktop/ms722561(v=vs.85))。
