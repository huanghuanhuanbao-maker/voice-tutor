// 豆包端到端实时语音 v3/realtime/dialogue 二进制协议编解码
// 移植自 volcengine-audio Python SDK
// 帧结构：4字节header + [event(4)] + [session_id_len(4)+session_id] + payload_len(4) + payload

// ──────────────── 协议常量 ────────────────
export const ProtocolVersion = { V1: 0b0001 };
export const HeaderSize      = { SIZE_4: 0b0001 };

export const MessageType = {
  FULL_CLIENT_REQUEST  : 0b0001,
  AUDIO_ONLY_REQUEST   : 0b0010,
  FULL_SERVER_RESPONSE : 0b1001,
  AUDIO_ONLY_RESPONSE  : 0b1011,
  ERROR_INFORMATION    : 0b1111,
};

export const MessageFlag = {
  NO_SEQUENCE     : 0b0000,
  CARRY_EVENT_ID  : 0b0100,
};

export const Serialization = { RAW: 0b0000, JSON: 0b0001 };
export const Compression   = { NONE: 0b0000, GZIP: 0b0001 };

// 客户端 → 服务端事件
export const ClientEvent = {
  StartConnection     : 1,
  FinishConnection    : 2,
  StartSession        : 100,
  CancelSession       : 101,
  FinishSession       : 102,
  TaskRequest         : 200,
  SayHello            : 300,
  EndASR              : 400,
  ChatTTSText         : 500,
  ChatTextQuery       : 501,
  ChatRAGText         : 502,
  ClientInterrupt     : 515,
};

// 服务端 → 客户端事件
export const ServerEvent = {
  50  : 'ConnectionStarted',
  51  : 'ConnectionFailed',
  52  : 'ConnectionFinished',
  150 : 'SessionStarted',
  152 : 'SessionFinished',
  153 : 'SessionFailed',
  154 : 'UsageResponse',
  350 : 'TTSSentenceStart',
  351 : 'TTSSentenceEnd',
  352 : 'TTSResponse',
  359 : 'TTSEnded',
  450 : 'ASRInfo',
  451 : 'ASRResponse',
  459 : 'ASREnded',
  550 : 'ChatResponse',
  553 : 'ChatTextQueryConfirmed',
  559 : 'ChatEnded',
  599 : 'DialogCommonError',
};

// ──────────────── 编码 ────────────────

function makeHeader(messageType, flag, serialization, compression) {
  return Buffer.from([
    (ProtocolVersion.V1 << 4) | HeaderSize.SIZE_4,
    (messageType        << 4) | flag,
    (serialization      << 4) | compression,
    0x00,
  ]);
}

function u32BE(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0, 0);
  return b;
}

// 通用：构造一个携带 event ID + 可选 session_id + JSON payload 的 full-client-request 帧
function buildJsonFrame(eventId, sessionId, payloadObj) {
  const header  = makeHeader(MessageType.FULL_CLIENT_REQUEST, MessageFlag.CARRY_EVENT_ID,
                             Serialization.JSON, Compression.NONE);
  const event   = u32BE(eventId);
  const json    = Buffer.from(JSON.stringify(payloadObj ?? {}), 'utf-8');
  const parts   = [header, event];
  if (sessionId) {
    const sid = Buffer.from(sessionId, 'utf-8');
    parts.push(u32BE(sid.length), sid);
  }
  parts.push(u32BE(json.length), json);
  return Buffer.concat(parts);
}

export const encode = {
  startConnection: () =>
    buildJsonFrame(ClientEvent.StartConnection, null, {}),

  finishConnection: () =>
    buildJsonFrame(ClientEvent.FinishConnection, null, {}),

  startSession: (sessionId, config) =>
    buildJsonFrame(ClientEvent.StartSession, sessionId, config),

  finishSession: (sessionId) =>
    buildJsonFrame(ClientEvent.FinishSession, sessionId, {}),

  chatTTSText: (sessionId, { start, content, end }) =>
    buildJsonFrame(ClientEvent.ChatTTSText, sessionId, { start, content, end }),

  chatTextQuery: (sessionId, content) =>
    buildJsonFrame(ClientEvent.ChatTextQuery, sessionId, { content }),

  chatRAGText: (sessionId, externalRag) =>
    buildJsonFrame(ClientEvent.ChatRAGText, sessionId, { external_rag: externalRag }),

  sayHello: (sessionId, content) =>
    buildJsonFrame(ClientEvent.SayHello, sessionId, { content }),

  clientInterrupt: (sessionId) =>
    buildJsonFrame(ClientEvent.ClientInterrupt, sessionId, {}),

  // TaskRequest 上传音频：header + event + session_id + payload(audio bytes)
  // message type = AUDIO_ONLY_REQUEST(0b0010), serialization = RAW
  taskRequestAudio: (sessionId, audioBytes) => {
    const header = makeHeader(MessageType.AUDIO_ONLY_REQUEST, MessageFlag.CARRY_EVENT_ID,
                              Serialization.RAW, Compression.NONE);
    const event  = u32BE(ClientEvent.TaskRequest);
    const sid    = Buffer.from(sessionId, 'utf-8');
    const audio  = Buffer.isBuffer(audioBytes) ? audioBytes : Buffer.from(audioBytes);
    return Buffer.concat([
      header, event,
      u32BE(sid.length), sid,
      u32BE(audio.length), audio,
    ]);
  },
};

// ──────────────── 解码 ────────────────

// 解析服务端发来的帧
// 返回 { messageType, flag, serialization, compression, event, sessionId, payload(Buffer or object) }
export function decode(frame) {
  if (!Buffer.isBuffer(frame)) frame = Buffer.from(frame);
  if (frame.length < 4) throw new Error('frame too short');

  const b0 = frame[0], b1 = frame[1], b2 = frame[2];
  // const protoVersion = b0 >> 4;     // 不用，假定为 V1
  // const headerSize   = b0 & 0x0F;
  const messageType    = b1 >> 4;
  const flag           = b1 & 0x0F;
  const serialization  = b2 >> 4;
  const compression    = b2 & 0x0F;

  let offset = 4;
  const out = { messageType, flag, serialization, compression };

  // 可选 sequence (flag 0b0001 / 0b0010 / 0b0011)
  if (flag === 0b0001 || flag === 0b0010 || flag === 0b0011) {
    out.sequence = frame.readInt32BE(offset);
    offset += 4;
  }

  // 错误帧带 code
  if (flag === 0b1111) {
    out.code = frame.readUInt32BE(offset);
    offset += 4;
  }

  // 携带 event ID (flag 0b0100)
  if (flag === MessageFlag.CARRY_EVENT_ID) {
    out.event = frame.readUInt32BE(offset);
    offset += 4;
  }

  // Connect 类事件 (1, 2, 50-52): 可能带 connect_id
  // Session 类事件 (>= 100): 带 session_id
  // 这里简化：所有 session 级事件都期待 session_id
  if (out.event !== undefined && out.event !== 50 && out.event !== 51 && out.event !== 52
                              && out.event !== 1  && out.event !== 2) {
    if (offset + 4 <= frame.length) {
      const sidLen = frame.readUInt32BE(offset);
      offset += 4;
      if (sidLen > 0 && offset + sidLen <= frame.length) {
        out.sessionId = frame.slice(offset, offset + sidLen).toString('utf-8');
        offset += sidLen;
      }
    }
  }

  // payload
  if (offset + 4 <= frame.length) {
    const payloadLen = frame.readUInt32BE(offset);
    offset += 4;
    const raw = frame.slice(offset, offset + payloadLen);
    if (serialization === Serialization.JSON) {
      try {
        out.payload = JSON.parse(raw.toString('utf-8'));
      } catch {
        out.payload = raw.toString('utf-8');
      }
    } else {
      out.payload = raw;  // 二进制（音频 / raw）
    }
  }

  out.eventName = ServerEvent[out.event] || (out.event === undefined ? '(no event)' : `Event#${out.event}`);
  return out;
}
