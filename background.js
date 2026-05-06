// background.js — 500px Auto Tag 后台服务
// 使用本地 Ollama Qwen3-VL 识别图片并生成标题/关键词

const OLLAMA_URL = 'http://localhost:11434';

// 长连接保活，防止 Service Worker 被回收
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'keepalive') {
    port.onMessage.addListener((msg) => {
      if (msg.ping) port.postMessage({ pong: true });
    });
    port.onDisconnect.addListener(() => {});
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'generateTags') {
    handleGenerateTags(request.imageData, request.lang, request.keywordCount)
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));
    return true; // 异步响应
  }
  if (request.action === 'fetchImage') {
    // 内容脚本 CORS 失败时，由 background 代为 fetch
    fetch(request.url, { credentials: 'include' })
      .then(r => r.blob())
      .then(blob => {
        const reader = new FileReader();
        reader.onloadend = () => sendResponse({ base64: reader.result.split(',')[1] });
        reader.onerror = () => sendResponse({ error: 'FileReader failed' });
        reader.readAsDataURL(blob);
      })
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }
});

async function handleGenerateTags(imageBase64, lang, keywordCount) {
  const config = await getConfig();

  if (!config.apiKey && !OLLAMA_URL.includes('localhost')) {
    throw new Error('未配置 API Key，请在扩展设置中填写');
  }

  const model = config.model || 'qwen3-vl:4b';
  const prompt = buildPrompt(lang, keywordCount);

  const resp = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.apiKey ? { 'Authorization': `Bearer ${config.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'user',
          content: prompt,
          images: [imageBase64],
        },
      ],
      stream: false,
      options: {
        think: false,
      },
    }),
  });

  const rawText = await resp.text();
  console.log('[Ollama] Status:', resp.status);
  console.log('[Ollama] Response:', rawText.substring(0, 1000));

  if (!resp.ok) {
    let msg = rawText;
    try { msg = JSON.parse(rawText).error?.message || rawText; } catch {}
    throw new Error(`Ollama API 错误 (${resp.status}): ${msg}`);
  }

  let data;
  try {
    data = JSON.parse(rawText);
  } catch {
    throw new Error('Ollama 返回非 JSON: ' + rawText.substring(0, 200));
  }

  const content = data.message?.content || '';
  console.log('[Ollama] Content:', content?.substring(0, 200));

  if (!content || content.trim() === '') {
    console.error('[Ollama] Full response:', JSON.stringify(data, null, 2));
    throw new Error('Ollama 返回为空，请检查：\n1. API Key 是否有效\n2. 模型 ' + model + ' 是否可用\n3. 额度是否用完');
  }

  return parseAIResponse(content);
}

function getConfig() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['model', 'apiKey', 'lang', 'keywordCount'], resolve);
  });
}

function buildPrompt(lang, keywordCount) {
  const count = keywordCount || 35;
  if (lang === 'zh') {
    return `你是视觉中国（VCG）的资深图库编辑，专门为商业摄影作品撰写图库级标题和关键词。

## 视觉中国标题规则

**必须是长句，15-30字**，结构通常为：[主体] + [动作/状态] + [场景/环境] + [光线/氛围/季节]

**常见格式参考：**
- 主体 + 动作 + 场景 + 光影："一只白鹭在夕阳下的湿地浅滩中低头觅食 金色水面波光粼粼"
- 季节 + 地点 + 主体 + 氛围："初冬清晨的杭州西湖断桥残雪 晨雾中游人撑着红伞漫步"
- 主体 + 近景 + 远景 + 光线："盛开的粉色荷花特写 背景是雨后朦胧的荷塘与穿透云层的柔光"
- 俯拍/仰拍 + 城市 + 时间 + 特点："黄昏时分航拍上海陆家嘴天际线 落日余晖映照在玻璃幕墙上的金色反光"
- 时间 + 主体 + 环境 + 情绪："深夜雨后的城市街道 霓虹灯倒映在湿润的柏油路面上 一名行人撑伞匆匆走过"

**标题写作要点：**
1. 必须具体到能脑补出画面，不能泛泛而谈（不能说"风景"，要说"秋季喀纳斯的金色白桦林"）
2. 必须包含光线/天气/时间中的至少一项（清晨、黄昏、雨后、雾天、逆光、剪影、星空等）
3. 有人物时必须描述动作和神态
4. 使用图库专业词汇：光影、倒影、剪影、特写、全景、俯拍、仰拍、微距、慢门、长曝光
5. 不要用"美丽""漂亮""好看"等空洞形容词
6. 标题是陈述句，不加引号不感叹

请仔细分析这张照片的每个细节（主体、构图、光线、色彩、环境、情绪），然后生成：

1. **title**：严格按照上述规则的视觉中国风格标题，15-30字
2. **description**：一句话概括画面，30字以内
3. **keywords**：${count}个精准中文关键词，逗号分隔。覆盖维度：主体、场景、光影、构图、色彩、情绪、风格、季节/天气

只返回 JSON，不要任何额外文字：
{"title": "...", "description": "...", "keywords": "..., ..."}`;
  }
  return `You are a professional stock photography editor specializing in metadata for platforms like 500px and Visual China Group (VCG).

VCG-style titles are:
- Descriptive and specific, typically 10-20 words
- Include subject, action, scene, lighting, mood
- Example: "Golden reeds swaying by the lake at sunset with warm light" or "Busy neon-lit intersection in a modern city at night"

Analyze this photo carefully and generate:

1. **Title**: A VCG-style descriptive English title (10-20 words) covering subject, scene, lighting, and atmosphere
2. **Description**: A brief English description (under 150 characters) with additional context
3. **Keywords**: ${count} precise English keywords, comma-separated. Cover: subject, scene, mood, style, colors, composition, concepts

Return ONLY valid JSON, no other text:
{"title": "Title here", "description": "Description here", "keywords": "keyword1,keyword2,keyword3"}`;
}

// ===== 解析 AI 返回的 JSON =====
function parseAIResponse(text) {
  // 尝试直接解析
  try {
    return JSON.parse(text);
  } catch {}

  // 尝试从 markdown code block 中提取
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[1].trim());
    } catch {}
  }

  // 尝试找到第一个 { 到最后一个 }
  const braceMatch = text.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    try {
      return JSON.parse(braceMatch[0]);
    } catch {}
  }

  // 解析 markdown 格式：**标题**...**描述**...**关键词**...
  const mdTitle = text.match(/\*\*标题\*\*[：:]?\s*(.+?)(?:\n|$|\*\*描述|\*\*关键词)/);
  const mdDesc = text.match(/\*\*描述\*\*[：:]?\s*(.+?)(?:\n|$|\*\*关键词)/);
  const mdKw = text.match(/\*\*关键词\*\*[：:]?\s*([\s\S]+?)$/);
  if (mdTitle) {
    return {
      title: (mdTitle[1] || '').trim(),
      description: (mdDesc?.[1] || '').trim(),
      keywords: (mdKw?.[1] || '').trim().replace(/\s+/g, ''),
    };
  }

  // 英文 markdown
  const enTitle = text.match(/\*\*Title\*\*[：:]?\s*(.+?)(?:\n|$|\*\*Description|\*\*Keywords)/i);
  const enDesc = text.match(/\*\*Description\*\*[：:]?\s*(.+?)(?:\n|$|\*\*Keywords)/i);
  const enKw = text.match(/\*\*Keywords\*\*[：:]?\s*([\s\S]+?)$/i);
  if (enTitle) {
    return {
      title: (enTitle[1] || '').trim(),
      description: (enDesc?.[1] || '').trim(),
      keywords: (enKw?.[1] || '').trim().replace(/\s+/g, ''),
    };
  }

  throw new Error('AI 返回格式无法解析: ' + text.substring(0, 200));
}
