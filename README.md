# voice-tutor

基于火山引擎豆包端到端实时语音大模型 + Spectra 知识库的语音课程助教 demo。

用户用语音提问，系统调用 Spectra 检索课程知识库，再把答案通过豆包合成自然女声播放给用户听。支持多轮上下文、随时打断追问。

## 架构

```
浏览器 (麦克风 + 扬声器)
   ⇅  WebSocket (PCM 16k / 24k 二进制)
Node.js Server (server.mjs)
   ├─ ⇅ WebSocket   → 豆包 v3/realtime/dialogue
   └─ → POST (SSE)  → Spectra Agent
```

流程：浏览器把麦克风 PCM 流上传 → 豆包 ASR 识别文字 → 服务器拿到文字调用 Spectra → Spectra 返回答案 → 通过豆包 `ChatTTSText` 合成语音回放给浏览器。

## 本地运行

需求：Node.js 20.6+（用了内置 `process.loadEnvFile`）

```bash
git clone <repo-url>
cd voice-tutor
npm install
cp .env.example .env       # 然后用编辑器把 .env 填好
node server.mjs
```

打开 [http://localhost:8080](http://localhost:8080)，点"开始对话"。

> **必须用 localhost 或 HTTPS** —— 浏览器只在这两种 origin 下允许麦克风权限。

## 环境变量

| 变量 | 必填 | 说明 |
|---|---|---|
| `DOUBAO_APP_ID` | ✅ | 火山引擎豆包语音控制台 → 应用管理拿到的 App ID |
| `DOUBAO_ACCESS_TOKEN` | ✅ | 同上应用详情页的 Access Token |
| `DOUBAO_SPEAKER` | ❌ | 默认 `zh_female_xiaohe_jupiter_bigtts`（小荷） |
| `SPECTRA_TOKEN` | ✅ | Spectra agent 平台的 Bearer token |
| `SPECTRA_AGENT_ID` | ✅ | 你创建的知识库 agent ID |
| `SPECTRA_URL` | ❌ | 默认 `https://api-spectra.duplik.cn/v1/conversations` |
| `BOT_NAME` | ❌ | 默认 `黄老师课程助教` |

## 项目结构

```
voice-tutor/
├─ server.mjs             # Node 主服务：HTTP + WebSocket 桥接
├─ doubao-protocol.mjs    # 豆包 v3 二进制协议编解码（移植自 volcengine-audio）
├─ spectra.mjs            # Spectra 流式调用 + 多轮 conversation_id 维护
├─ config.mjs             # 从 env 读凭证 + 会话默认配置（system_role 等）
├─ public/
│  ├─ index.html          # 前端 UI（光球可视化 + 对话气泡）
│  └─ audio-worklet.js    # 麦克风 PCM 16k 下采样 worklet
├─ .env.example           # 凭证模板
└─ package.json
```

## 部署提示

1. **必须 HTTPS**：浏览器麦克风权限要求。用 nginx + Let's Encrypt 或者 Cloudflare 代理。
2. **WebSocket 走 wss**：nginx 配置时要 `proxy_http_version 1.1` + `Upgrade` / `Connection` 头。
3. **建议中国大陆机房**：豆包和 Spectra 接口都在国内，减少延迟。
4. **生产凭证不要进代码**：通过云厂商的"环境变量"功能或者 `pm2 ecosystem` 注入。

## 已知限制

- Spectra 单轮查询耗时与 agent 设计相关，复杂问题可能 30-60 秒。等待期间豆包会先说一句"稍等我查一下"占位，真正答案到达后才开始念。
- 浏览器原生回声消除（`echoCancellation: true`）已经开启；打断功能在用耳机时最稳，外放扬声器场景下偶尔会失效。
- 当前是单实例进程内会话，不支持横向扩展。多实例部署需要把 session 状态外存（Redis）。

## License

私有项目，未授权请勿外发。
