// 主服务：
//  - 提供静态 index.html
//  - 接受浏览器 WebSocket，再向豆包开一条 WebSocket
//  - 浏览器 → 豆包：音频转发（PCM16 16k）
//  - 豆包 → 浏览器：音频转发（PCM16 24k）+ 文本字幕事件
//  - 豆包 ASR 拿到用户问题文本 → 调用 Spectra → ChatRAGText 灌回豆包

// 启动时自动加载 .env（Node 20.6+ 内置）
try { process.loadEnvFile?.('.env'); } catch { /* .env 不存在时静默 */ }

import http  from 'node:http';
import fs    from 'node:fs';
import path  from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';

import { DOUBAO, SESSION_CONFIG } from './config.mjs';
import { encode, decode, ServerEvent, MessageType } from './doubao-protocol.mjs';
import { askSpectra } from './spectra.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const PORT       = 8080;

// ──────────────── HTTP 静态服务器 ────────────────
const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    fs.createReadStream(path.join(__dirname, 'public', 'index.html')).pipe(res);
  } else if (req.url === '/audio-worklet.js') {
    res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
    fs.createReadStream(path.join(__dirname, 'public', 'audio-worklet.js')).pipe(res);
  } else {
    res.writeHead(404).end('not found');
  }
});

// ──────────────── 浏览器 WS 服务器 ────────────────
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (browserWs) => {
  console.log('[browser] connected');
  const session = new BridgeSession(browserWs);
  session.start();

  browserWs.on('close',   () => session.shutdown('browser closed'));
  browserWs.on('error', e => session.shutdown('browser error: ' + e.message));
});

// ──────────────── 一次浏览器会话 ────────────────
class BridgeSession {
  constructor(browserWs) {
    this.browserWs   = browserWs;
    this.doubaoWs    = null;
    this.sessionId   = randomUUID();
    this.connectId   = randomUUID();
    this.doubaoReady = false;       // SessionStarted 之后才允许上传音频
    this.currentUserQuery = '';     // 当前轮 ASR 累积的文本
    this.spectraInFlight  = false;  // 防止重复触发
    this.currentTtsType   = null;   // 当前 TTS 段的类型，决定要不要转发给浏览器
    this.isSpeaking       = false;  // 我们是否正在向浏览器输出"真"答案音频
    this.spectraAbort     = null;   // AbortController：用户打断时取消 Spectra 请求
    this.conversationId   = null;   // Spectra 会话 ID，第一次为 null，后续多轮复用
    this.dead = false;
  }

  // 只有这几种 tts_type 是"真"答案，要播给用户听
  isWantedTtsType(t) {
    return t === 'external_rag' || t === 'chat_tts_text';
  }

  start() {
    const headers = {
      'X-Api-App-ID'     : DOUBAO.APP_ID,
      'X-Api-Access-Key' : DOUBAO.ACCESS_TOKEN,
      'X-Api-Resource-Id': DOUBAO.RESOURCE_ID,
      'X-Api-App-Key'    : DOUBAO.APP_KEY,
      'X-Api-Connect-Id' : this.connectId,
    };
    console.log('[doubao] connecting...');
    this.doubaoWs = new WebSocket(DOUBAO.WS_URL, { headers });

    this.doubaoWs.on('open', () => {
      console.log('[doubao] ws open, sending StartConnection');
      this.toBrowser({ type: 'status', message: '连接豆包...' });
      this.doubaoWs.send(encode.startConnection());
    });

    this.doubaoWs.on('message', (data, isBinary) => {
      this.onDoubaoFrame(Buffer.isBuffer(data) ? data : Buffer.from(data));
    });

    this.doubaoWs.on('close', (code, reason) => {
      console.log('[doubao] ws closed', code, reason?.toString());
      this.shutdown('doubao closed: ' + code);
    });

    this.doubaoWs.on('error', e => {
      console.error('[doubao] ws error:', e.message);
      this.shutdown('doubao error: ' + e.message);
    });

    // 浏览器消息：二进制 = PCM 上行；文本 = 命令
    this.browserWs.on('message', (data, isBinary) => {
      if (isBinary) {
        if (this.doubaoReady) {
          const audio = Buffer.isBuffer(data) ? data : Buffer.from(data);
          this.doubaoWs.send(encode.taskRequestAudio(this.sessionId, audio));
        }
      } else {
        let cmd;
        try { cmd = JSON.parse(data.toString('utf-8')); } catch { return; }
        this.onBrowserCommand(cmd);
      }
    });
  }

  onBrowserCommand(cmd) {
    if (cmd.type === 'finish') {
      this.shutdown('user finished');
    } else if (cmd.type === 'text' && typeof cmd.content === 'string') {
      // 调试用：浏览器直接发文本 query
      this.handleUserQuery(cmd.content);
    }
  }

  onDoubaoFrame(frame) {
    let msg;
    try { msg = decode(frame); }
    catch (e) { console.error('[doubao] decode error', e); return; }

    const name = msg.eventName || `MsgType#${msg.messageType}`;

    // 音频响应：只转发 external_rag / chat_tts_text 类型的，丢掉默认闲聊的音频
    if (msg.messageType === MessageType.AUDIO_ONLY_RESPONSE && Buffer.isBuffer(msg.payload)) {
      if (this.isWantedTtsType(this.currentTtsType)) {
        this.browserWs.send(msg.payload, { binary: true });
      }
      // 否则静音掉
      return;
    }

    // 错误帧
    if (msg.messageType === MessageType.ERROR_INFORMATION) {
      console.error('[doubao] ERROR frame:', msg);
      this.toBrowser({ type: 'error', message: `豆包错误码 ${msg.code}: ${JSON.stringify(msg.payload)}` });
      return;
    }

    // JSON 事件
    console.log(`[doubao] ← ${name}`, msg.payload && typeof msg.payload === 'object' ? JSON.stringify(msg.payload).slice(0, 200) : '');

    switch (msg.event) {
      case 50:  // ConnectionStarted
        this.toBrowser({ type: 'status', message: '豆包已连接，正在建会话...' });
        this.doubaoWs.send(encode.startSession(this.sessionId, SESSION_CONFIG));
        break;

      case 150: // SessionStarted
        this.doubaoReady = true;
        this.toBrowser({ type: 'status', message: '会话就绪，请说话' });
        this.toBrowser({ type: 'ready' });
        break;

      case 450: // ASRInfo - 用户开始说话（可能是首次问，也可能是中途打断）
        // 永远执行一次清理：
        //  - 即使豆包侧 TTSEnded 已经触发（isSpeaking=false），浏览器队列里可能还有几十秒音频在播
        //  - 浏览器 player.interrupt() 对空队列是 no-op，安全
        console.log('[interrupt] ASRInfo fired, flushing any in-flight response');
        this.interruptCurrent();
        this.currentUserQuery = '';
        this.spectraInFlight  = false;
        this.toBrowser({ type: 'asr-start' });
        break;

      case 451: { // ASRResponse - 用户说话的文本（流式）
        const results = msg.payload?.results || [];
        // 取最后一条（通常是 interim/final），并累计 final 部分
        let text = '';
        for (const r of results) text += r.text || '';
        this.currentUserQuery = text;
        this.toBrowser({ type: 'asr', text, final: results.every(r => !r.is_interim) });
        break;
      }

      case 459: { // ASREnded - 用户说话结束
        this.toBrowser({ type: 'asr-end', text: this.currentUserQuery });
        const q = this.currentUserQuery.trim();
        if (q && !this.spectraInFlight) {
          this.spectraInFlight = true;
          this.handleUserQuery(q);
        }
        break;
      }

      case 350: // TTSSentenceStart - 一段 TTS 即将开始，告诉我们是哪种 tts_type
        this.currentTtsType = msg.payload?.tts_type || null;
        if (this.isWantedTtsType(this.currentTtsType)) this.isSpeaking = true;
        console.log(`[doubao]   TTS 段开始 type=${this.currentTtsType} (${this.isWantedTtsType(this.currentTtsType) ? '播放' : '丢弃'})`);
        break;

      case 351: // TTSSentenceEnd
        break;

      case 359: // TTSEnded - 整轮 TTS 结束，清空当前类型
        this.currentTtsType = null;
        this.isSpeaking     = false;
        break;

      case 550: // ChatResponse - 只转发"真"答案的文字（与音频规则一致）
        if (this.isWantedTtsType(this.currentTtsType)) {
          this.toBrowser({ type: 'chat', text: msg.payload?.content || '' });
        }
        break;

      case 559: // ChatEnded
        if (this.isWantedTtsType(this.currentTtsType)) {
          this.toBrowser({ type: 'chat-end' });
        }
        break;

      case 599: // DialogCommonError
        this.toBrowser({ type: 'error', message: `豆包: ${msg.payload?.message || JSON.stringify(msg.payload)}` });
        break;

      case 153: // SessionFailed
      case 51:  // ConnectionFailed
        this.toBrowser({ type: 'error', message: `豆包失败: ${JSON.stringify(msg.payload)}` });
        break;
    }
  }

  // 拿到用户问题后，去 Spectra 查，然后把答案塞回豆包
  async handleUserQuery(query) {
    console.log('[spectra] querying:', query);
    this.toBrowser({ type: 'rag-start', query });
    this.spectraAbort = new AbortController();
    try {
      const { answer, elapsedMs, conversationId } = await askSpectra(query, {
        conversationId: this.conversationId,
        signal: this.spectraAbort.signal,
      });
      // 拿到/更新会话 ID，下一轮带上以维持多轮上下文
      if (conversationId && conversationId !== this.conversationId) {
        this.conversationId = conversationId;
        console.log(`[spectra] conversation_id = ${conversationId}`);
      }
      console.log(`[spectra] answered in ${elapsedMs}ms, ${answer.length} chars`);
      this.toBrowser({ type: 'rag-done', answer, elapsedMs });

      if (this.dead || !this.doubaoReady) return;

      // 先尝试打断豆包正在进行的"默认闲聊"生成
      try { this.doubaoWs.send(encode.clientInterrupt(this.sessionId)); }
      catch (e) { console.warn('[doubao] ClientInterrupt 发送失败', e?.message); }

      // 用 ChatTTSText 让豆包"逐字念"，不做总结/口语化改写
      this.doubaoWs.send(encode.chatTTSText(this.sessionId, { start: true,  content: answer, end: false }));
      this.doubaoWs.send(encode.chatTTSText(this.sessionId, { start: false, content: '',     end: true  }));

      // ChatTTSText 模式下豆包不会回流 ChatResponse 文字事件，
      // 所以我们自己把答案文字推给浏览器，对话气泡和音频同步出现。
      // 注意：不主动 fire chat-end，浏览器侧会在音频队列播完时自己切回 listening。
      this.toBrowser({ type: 'chat', text: answer });
    } catch (e) {
      if (e?.name === 'AbortError') {
        console.log('[spectra] aborted (user interrupted)');
      } else {
        console.error('[spectra] error', e);
        this.toBrowser({ type: 'error', message: 'Spectra 错误: ' + e.message });
      }
    } finally {
      this.spectraInFlight = false;
      this.spectraAbort    = null;
    }
  }

  // 用户打断时调用：清空所有正在/将要播放的音频和正在跑的查询
  interruptCurrent() {
    // 1. 取消 Spectra
    if (this.spectraAbort) {
      try { this.spectraAbort.abort(); } catch {}
      this.spectraAbort = null;
    }
    // 2. 让豆包停止生成
    try { this.doubaoWs.send(encode.clientInterrupt(this.sessionId)); } catch {}
    // 3. 让浏览器立刻 flush 当前排队的音频
    this.toBrowser({ type: 'interrupt' });
    // 4. 重置本地状态
    this.isSpeaking     = false;
    this.currentTtsType = null;
  }

  toBrowser(obj) {
    if (this.browserWs.readyState === WebSocket.OPEN) {
      this.browserWs.send(JSON.stringify(obj));
    }
  }

  shutdown(reason) {
    if (this.dead) return;
    this.dead = true;
    console.log('[session] shutdown:', reason);
    try {
      if (this.doubaoWs?.readyState === WebSocket.OPEN) {
        if (this.doubaoReady) this.doubaoWs.send(encode.finishSession(this.sessionId));
        this.doubaoWs.send(encode.finishConnection());
        setTimeout(() => this.doubaoWs.close(), 500);
      }
    } catch {}
    try { this.browserWs.close(); } catch {}
  }
}

server.listen(PORT, () => {
  console.log(`\n🎙️  voice-tutor running at  http://localhost:${PORT}\n`);
});
