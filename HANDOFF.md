# voice-tutor 部署交付文档

> 用途：把这个项目部署成一个可被任何人访问的 HTTPS 网址（PC、手机都能用），
> 完整语音对话链路跑通。
>
> 受众：
> - **老板**（huanghuanhuanbao-maker）—— 做凭证准备 / 决策 / 验收
> - **技术**（接手部署的同事）—— 做服务器搭建 / 部署
>
> 仓库：https://github.com/huanghuanhuanbao-maker/voice-tutor

---

## 一、项目快速理解（给技术看）

学员说话 → 豆包 ASR 识别 → 调 Spectra 检索课程知识库 → 把答案塞给豆包 TTS 合成语音 → 学员听到回答。

**链路上 3 个外部依赖**：

| 依赖 | 角色 | 协议 | 域名 |
|---|---|---|---|
| 豆包 v3/realtime/dialogue | 实时语音 ASR + TTS | WebSocket | `openspeech.bytedance.com` |
| Spectra Agent 平台 | 知识库 RAG | HTTPS + SSE | `api-spectra.duplik.cn` |
| 浏览器 | 麦克风采集 + 扬声器播放 | HTTPS + WSS | 你的域名 |

**技术栈**：Node.js 20+、纯 HTML/JS（无构建）、WebSocket、Nginx 反代、Let's Encrypt SSL

---

## 二、谁做什么

| 事项 | 老板 | 技术 |
|---|---|---|
| 作废旧 token、生成新 token | ✅ | — |
| 把 GitHub 仓库加技术为 collaborator | ✅ | — |
| 决定云厂商 / 区域 / 域名 | ✅ | 给建议 |
| 域名备案（如走国内云） | ✅ | — |
| 把新凭证通过安全渠道传给技术 | ✅ | — |
| 服务器搭建、SSL、Nginx | — | ✅ |
| 代码部署、进程守护、监控 | — | ✅ |
| 端到端验收 | ✅ | 配合 |
| 上线后的维护、查日志 | — | ✅ |

---

## 三、PART A · 老板要做的事

### A1. 凭证

老板已对所有 token 做了用量限额，**可以直接在消息正文里发给技术**，不需要走密码管理器。

技术需要的 4 个值：

| 变量 | 用途 |
|---|---|
| `DOUBAO_APP_ID` | 火山引擎豆包应用 App ID |
| `DOUBAO_ACCESS_TOKEN` | 豆包应用 Access Token |
| `SPECTRA_TOKEN` | 知识库 agent 平台 token |
| `SPECTRA_AGENT_ID` | 知识库 agent 实例 ID |

填到服务器上 `.env` 文件即可，详见 PART B。

### A2. 给技术做 4 项决策

| 决策 | 选项 | 默认建议 |
|---|---|---|
| 云厂商 | 火山引擎 / 阿里云 / 腾讯云 | 火山引擎（和豆包同生态，延迟最低） |
| 服务器区域 | 中国大陆 / 香港 / 海外 | 中国大陆（豆包在国内） |
| 机器规格 | 1C2G / 2C4G / 4C8G | **2C4G 起步**（语音流并发占内存） |
| 域名 | 用现有 / 新买 | 用你**已备案**的二级域名（最快上线）|

### A3. 关于域名（最大的时间坑）

| 你的情况 | 推荐路径 | 上线时间 |
|---|---|---|
| 已有备案域名 | 加个子域名（如 `voice.你公司.com`），DNS 指过去 | 当天 |
| 没有备案域名，时间不急 | 新买域名 → 走完备案 → 部署 | 10-20 个工作日 |
| 没有备案域名，要快 | 海外 VPS + `.com` 域名（无需备案） | 1-2 小时 |

### A4. 把技术加为 GitHub Collaborator

1. 浏览器开 https://github.com/huanghuanhuanbao-maker/voice-tutor/settings/access
2. 点 **Add people**
3. 输入技术的 GitHub 用户名 / 邮箱
4. 权限选 **Write**（可推代码 + 改 issue，不能改仓库设置）
5. 技术邮箱里收到邀请，他点接受

### A5. 把以下信息打包给技术（直接复制粘贴一条消息）

```
1. 仓库地址：https://github.com/huanghuanhuanbao-maker/voice-tutor
   GitHub 邀请已发送，请接受。

2. 凭证（已配限额，可放心填到 .env）：
   DOUBAO_APP_ID=...
   DOUBAO_ACCESS_TOKEN=...
   SPECTRA_TOKEN=...
   SPECTRA_AGENT_ID=...

3. 决策：
   - 云厂商：xxx
   - 区域：xxx
   - 机器规格：xxx
   - 域名：xxx（已/未备案）

4. 完整部署步骤看仓库根目录的 HANDOFF.md（PART B 那一节）。
```

### A6. 验收（技术交付后你做的事）

技术发你一个 https 链接，**你拿手机和电脑各试一次**：

- [ ] 链接打开能看到"长风AI课程 / 语音助教"页面
- [ ] 点"开始对话"弹麦克风权限请求，允许
- [ ] 说一个课程问题，AI 用语音回答
- [ ] 答案用了课程里的具体术语（七步法、清醒四象限等）
- [ ] AI 讲到一半你插话能打断
- [ ] 连问 3 轮，第 3 轮能接住上文
- [ ] PC Chrome 和手机 Safari 都能用

任何一项不行 → 反馈给技术。

---

## 四、PART B · 技术要做的事

### B0. 接手准备

```bash
# 接受 GitHub 邀请后克隆
git clone https://github.com/huanghuanhuanbao-maker/voice-tutor.git
cd voice-tutor

# 先本地跑通验证（可选但强烈建议）
npm install
cp .env.example .env
# 编辑 .env，填入老板给的 4 个凭证
node server.mjs
# 浏览器开 http://localhost:8080 验证
```

如果本地能跑通，部署就只是"换个机器跑一遍"。

### B1. 买机器

- 厂商和规格按老板决策
- 推荐 **Ubuntu 22.04 LTS**
- 安全组放行端口：**22 / 80 / 443**

### B2. 装基础环境

SSH 到服务器后：

```bash
# Node 20 via nvm
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 20 && nvm use 20 && nvm alias default 20

# 系统依赖
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx ufw git

# 进程守护
npm install -g pm2

# 防火墙
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw --force enable
```

### B3. 拉代码 + 起服务

```bash
sudo mkdir -p /var/www/voice-tutor
sudo chown -R $USER:$USER /var/www/voice-tutor
cd /var/www/voice-tutor

git clone https://github.com/huanghuanhuanbao-maker/voice-tutor.git .
npm install --omit=dev

# 填生产凭证
cp .env.example .env
nano .env          # 填好 4 个 token
chmod 600 .env     # 只有 owner 能读，避免误暴露

# 用 PM2 守护
pm2 start server.mjs --name voice-tutor
pm2 save
pm2 startup systemd
# 按 pm2 提示再执行一条 sudo env PATH=... 指令，让 PM2 开机自启
```

验证：`curl http://localhost:8080`，应该返回 HTML。

### B4. DNS 解析

让老板在域名后台加 A 记录：
- **类型**：A
- **主机记录**：`voice`（或你商定的子域名前缀）
- **记录值**：服务器的公网 IP
- **TTL**：默认（10 分钟）

DNS 生效后 `ping voice.公司域名.com` 能 ping 通服务器 IP。

### B5. Nginx 反代

新建 `/etc/nginx/sites-available/voice-tutor`：

```nginx
server {
    listen 80;
    server_name voice.公司域名.com;   # ← 改成实际域名

    # 主站静态 + 普通 HTTP 反代
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket 关键：必须 upgrade
    location /ws {
        proxy_pass http://127.0.0.1:8080/ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade           $http_upgrade;
        proxy_set_header Connection        "upgrade";
        proxy_set_header Host              $host;
        proxy_read_timeout 86400s;   # 24h 长连接不掉
        proxy_send_timeout 86400s;
    }
}
```

启用：

```bash
sudo ln -sf /etc/nginx/sites-available/voice-tutor /etc/nginx/sites-enabled/voice-tutor
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

### B6. 上 SSL（让浏览器允许麦克风）

```bash
sudo certbot --nginx -d voice.公司域名.com
# 一路 enter，最后问 redirect HTTP→HTTPS 的话选 2 (Redirect)
```

certbot 会自动改 nginx 配置加 443、续期任务也自动配好。

### B7. 端到端联调

技术自己先跑一遍：

1. 浏览器开 `https://voice.公司域名.com`
2. 点"开始对话"，允许麦克风
3. 说一个课程相关问题
4. 听到 AI 用女声回答
5. AI 讲到一半插话，应该立刻停
6. 连问 3 轮，第 3 轮应该能接上下文

通了再交付老板。

### B8. 监控 / 维护命令

| 操作 | 命令 |
|---|---|
| 实时日志 | `pm2 logs voice-tutor` |
| 最近 200 行 | `pm2 logs voice-tutor --lines 200 --nostream` |
| 进程状态 | `pm2 status` |
| 重启 | `pm2 restart voice-tutor` |
| 拉取最新代码 | `cd /var/www/voice-tutor && git pull && pm2 restart voice-tutor` |
| 看 nginx 错误 | `sudo tail -50 /var/log/nginx/error.log` |
| 看请求日志 | `sudo tail -50 /var/log/nginx/access.log` |

### B9. 交付给老板

发给老板：

1. **可访问的 HTTPS 链接**
2. **简易维护说明**（重启 / 拉代码 / 看日志 三条命令就行）
3. **用量看板入口**：豆包用量、Spectra 用量、服务器监控分别在哪看
4. **告警机制**（可选）：服务挂了你怎么知道？至少配一个 PM2 + 邮件 / 飞书 / 钉钉机器人通知

---

## 五、架构图

```
   ┌──────────────┐         https://voice.公司域名.com
   │   用户浏览器  │ ◄──────────────────────────────────
   │ (麦克风/扬声) │
   └──────┬───────┘
          │ 443/TCP (TLS)
          ▼
   ┌──────────────┐
   │    Nginx     │  ← Let's Encrypt SSL termination
   │  (HTTPS→HTTP)│  ← WebSocket Upgrade 头
   └──────┬───────┘
          │ 127.0.0.1:8080
          ▼
   ┌──────────────┐
   │  Node.js     │  ← PM2 守护，开机自启
   │  server.mjs  │
   └──┬────────┬──┘
      │        │
      │WSS     │HTTPS+SSE
      ▼        ▼
   ┌─────┐  ┌─────────┐
   │豆包  │  │ Spectra │
   │实时  │  │  Agent  │
   │语音  │  │         │
   └─────┘  └─────────┘
```

---

## 六、常见踩坑速查

| 现象 | 原因 | 解决 |
|---|---|---|
| 点"开始对话"没反应 | 浏览器没给麦克风权限 | URL 必须是 https；浏览器地址栏左侧 ⓘ 里手动允许 |
| 浏览器打开 OK 但 WebSocket 失败 | Nginx 缺 `Upgrade` 头 | 检查 `/ws` location 块的 4 个 proxy_set_header |
| 麦克风有声但 AI 不响应 | 豆包 token 失效 / 配额耗尽 | 火山引擎控制台查用量；token 重发 |
| AI 答案泛泛、不像课程 | Spectra agent 没绑对 | 老板核对 `SPECTRA_AGENT_ID` |
| AI 答案乱编课程外内容 | Spectra agent 的 prompt 没设好 | 老板自己在 Spectra 平台调 prompt |
| 多人同时用串话 | 单实例进程内 session | 当前 demo 阶段先单机；流量上来再做 Redis session |
| 一对话就 502 | Node 进程挂了 / 端口不对 | `pm2 logs` 查 Node 日志，`netstat -tlnp` 查 8080 端口 |
| SSL 证书快过期 | certbot 没启用自动续期 | `sudo systemctl status certbot.timer` 应该是 active |

---

## 七、用量监控

| 服务 | 在哪查 |
|---|---|
| 豆包 token 余额 | 火山引擎控制台 → 端到端实时语音 → 资源购买详情 |
| Spectra 调用量 | 智能体搭建平台后台 |
| 服务器 CPU / 内存 / 流量 | 云厂商监控页 |

**一次完整 5 分钟对话**大约消耗 **5000-10000 token**。账号目前 100 万 token 免费额度大约够 **100-200 次完整对话**。流量上来要充值。

---

## 八、当前已知局限（给两边对齐预期）

| 局限 | 说明 |
|---|---|
| Spectra 单次响应 30-60 秒 | 知识库 RAG 耗时长，等待期间豆包会说"稍等我查一下" |
| 单进程并发上限 ~10-20 人 | 每个用户开一对 WebSocket，2C4G 机器跑这么多够 |
| 没有用户认证 | 链接知道就能用。需要权限控制再加 |
| 没有对话历史持久化 | 浏览器刷新 = 新会话，不存数据库 |
| 没有用量限流 | 单人恶意刷可能很快耗 token，必要时加 IP/UA 频控 |

这些都是预期内的 demo 阶段取舍，不影响"可用"。

---

## 九、给两边的最终 checklist

### 老板这边走完才能交给技术
- [ ] 4 个旧 token 已作废、新 token 已生成
- [ ] 新 token 用安全方式传给技术
- [ ] 4 项决策做完（云厂商、区域、规格、域名）
- [ ] 技术已被加为仓库 Collaborator
- [ ] 域名 DNS 准备好等技术给 IP

### 技术这边走完才能交回老板
- [ ] 拿到所有凭证、已 clone 仓库
- [ ] 机器装好，本地能跑通 voice-tutor
- [ ] Nginx + SSL 配好，HTTPS 能访问
- [ ] WebSocket 连通（浏览器开发者工具 Network 里能看到 wss 升级成功）
- [ ] PM2 已配开机自启
- [ ] 监控命令文档化交给老板
- [ ] 链接发给老板验收
