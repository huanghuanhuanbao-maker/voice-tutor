import { SPECTRA } from './config.mjs';

// 调用 Spectra agent，把流式返回拼成完整答案返回。
// 支持 signal: AbortController.signal 用于中途取消（用户打断时用）。
// 返回 { answer, elapsedMs, eventTypes }。
export async function askSpectra(query, { conversationId, signal } = {}) {
  const t0 = Date.now();

  const body = {
    inputs           : {},
    query            : query,
    message          : query,
    agent_id         : SPECTRA.AGENT_ID,
    enable_websearch : false,
    stream           : true,
    response_mode    : 'streaming',
  };
  // 仅当真的有 conversation_id 时才带上（区分"新建对话"与"延续对话"）
  if (conversationId) body.conversation_id = conversationId;

  const res = await fetch(SPECTRA.URL, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type' : 'application/json',
      'Authorization': `Bearer ${SPECTRA.TOKEN}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Spectra HTTP ${res.status}: ${await res.text()}`);
  }

  const reader  = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buf = '';
  let answer = '';
  let convId = conversationId;
  const eventTypes = new Set();
  const seenFirstOfType = new Set();   // 每种 type 只打印第一条样本，便于看结构

  // 在嵌套结构里递归找 conversation_id（兼容各种 API 风格）
  const findConvId = (o, depth = 0) => {
    if (depth > 4 || !o || typeof o !== 'object') return null;
    if (typeof o.conversation_id === 'string' && o.conversation_id) return o.conversation_id;
    if (typeof o.conv_id          === 'string' && o.conv_id)          return o.conv_id;
    if (typeof o.conversationId   === 'string' && o.conversationId)   return o.conversationId;
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (v && typeof v === 'object') {
        const found = findConvId(v, depth + 1);
        if (found) return found;
      }
    }
    return null;
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') continue;
      try {
        const evt = JSON.parse(payload);
        const type = evt.type || '(no-type)';
        eventTypes.add(type);

        // 每种事件类型只打印第一条原始结构，方便排查 conversation_id 字段藏在哪儿
        if (!seenFirstOfType.has(type)) {
          seenFirstOfType.add(type);
          console.log(`[spectra-debug] first '${type}' event:`, JSON.stringify(evt).slice(0, 500));
        }

        if (type === 'stream' && typeof evt.message === 'string') {
          answer += evt.message;
        }
        const found = findConvId(evt);
        if (found) convId = found;
      } catch { /* heartbeat 等 */ }
    }
  }

  return { answer: answer.trim(), elapsedMs: Date.now() - t0, eventTypes: [...eventTypes], conversationId: convId };
}
