// 凭证 + 模型配置集中放这里
// 敏感凭证一律从环境变量 (process.env) 读取，不要硬编码后提交到 git

function need(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`\n[config] 缺少环境变量 ${name}`);
    console.error(`         请把 .env.example 复制成 .env 后填好真实凭证再启动。\n`);
    process.exit(1);
  }
  return v;
}

// ────── 豆包端到端实时语音 ──────
export const DOUBAO = {
  WS_URL       : 'wss://openspeech.bytedance.com/api/v3/realtime/dialogue',
  APP_ID       : need('DOUBAO_APP_ID'),
  ACCESS_TOKEN : need('DOUBAO_ACCESS_TOKEN'),
  // APP_KEY 是官方文档明示的公开固定值，不是私钥
  APP_KEY      : 'PlgvMymc7f3tQnJ6',
  RESOURCE_ID  : 'volc.speech.dialog',
};

// ────── Spectra (文字版知识库 agent) ──────
export const SPECTRA = {
  URL      : process.env.SPECTRA_URL || 'https://api-spectra.duplik.cn/v1/conversations',
  TOKEN    : need('SPECTRA_TOKEN'),
  AGENT_ID : need('SPECTRA_AGENT_ID'),
};

// ────── 会话默认配置（非敏感，可以提交）──────
export const SESSION_CONFIG = {
  asr: {
    audio_info: { format: 'pcm', sample_rate: 16000, channel: 1 },
    extra: { end_smooth_window_ms: 1200 },
  },
  tts: {
    audio_config: { format: 'pcm_s16le', sample_rate: 24000, channel: 1 },
    speaker: process.env.DOUBAO_SPEAKER || 'zh_female_xiaohe_jupiter_bigtts',
  },
  dialog: {
    bot_name: process.env.BOT_NAME || '黄老师课程助教',
    system_role: [
      '你是黄老师课程的语音助教。',
      '',
      '【最高优先级的硬规则，违反就算彻底失败】',
      '1. 你完全不懂这门课的内容。你绝对不能凭自己的知识回答用户任何关于课程的问题。',
      '2. 用户问你问题后，你第一次开口只能说一句不超过 10 个字的搭话，例如：',
      '   "好的，我帮你查一下"、"嗯，让我翻翻课程笔记哈"、"稍等我看下黄老师怎么讲的"。',
      '   说完这一句就立刻停下，绝对不能继续讲任何具体内容。',
      '3. 然后等待。系统会通过 ChatRAGText 给你课程知识库的检索答案。',
      '4. 拿到检索答案后，你用自然口语把那段内容讲给学员听，一次只讲一层意思。',
      '',
      '【再次强调】没收到 ChatRAGText 之前，你只能说搭话，不能给任何具体答案。哪怕用户问的是"1+1等于几"也一样。',
    ].join('\n'),
    speaking_style: '语气自然亲切，短句口语，像朋友聊天，不要打官腔，不要长篇大论，一次讲一层意思。',
    extra: {
      input_mod: 'audio',
      model: '1.2.1.1',   // O2.0 版本
      strict_audit: false,
    },
  },
};
