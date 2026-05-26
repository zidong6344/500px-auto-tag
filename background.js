// background.js — 500px Auto Tag 后台服务
// 支持火山引擎豆包视觉模型 + 本地 Ollama

const OLLAMA_URL = 'http://localhost:11434';
const VOLCENGINE_URL = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';

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
    console.log('[BG] generateTags 收到请求, lang:', request.lang, 'keywordCount:', request.keywordCount, 'imageData长度:', request.imageData?.length);
    handleGenerateTags(request.imageData, request.lang, request.keywordCount)
      .then((result) => {
        console.log('[BG] generateTags 成功, title:', result.title?.substring(0, 40), 'keywords:', result.keywords?.substring(0, 60));
        sendResponse(result);
      })
      .catch((err) => {
        console.log('[BG] generateTags 失败:', err.message);
        sendResponse({ error: err.message });
      });
    return true;
  }
  if (request.action === 'fetchImage') {
    console.log('[BG] fetchImage 请求, url:', request.url?.substring(0, 80));
    fetch(request.url, { credentials: 'include' })
      .then(r => {
        console.log('[BG] fetchImage HTTP状态:', r.status);
        return r.blob();
      })
      .then(blob => {
        console.log('[BG] fetchImage blob大小:', blob.size);
        const reader = new FileReader();
        reader.onloadend = () => {
          const b64 = reader.result.split(',')[1];
          console.log('[BG] fetchImage base64长度:', b64?.length);
          sendResponse({ base64: b64 });
        };
        reader.onerror = () => sendResponse({ error: 'FileReader failed' });
        reader.readAsDataURL(blob);
      })
      .catch(err => {
        console.log('[BG] fetchImage 失败:', err.message);
        sendResponse({ error: err.message });
      });
    return true;
  }
});

async function handleGenerateTags(imageBase64, lang, keywordCount) {
  const config = await getConfig();
  console.log('[BG] 配置:', JSON.stringify({ provider: config.provider, apiKey: config.apiKey ? '已配置(' + config.apiKey.length + '字)' : '未配置', volcModel: config.volcModel || '未配置', model: config.model || '未配置' }));
  const provider = config.provider || 'volcengine';

  if (provider === 'volcengine') {
    return callVolcengine(imageBase64, lang, keywordCount, config);
  }
  return callOllama(imageBase64, lang, keywordCount, config);
}

async function callVolcengine(imageBase64, lang, keywordCount, config) {
  const apiKey = config.apiKey;
  if (!apiKey) {
    throw new Error('未配置火山引擎 API Key，请在扩展设置中填写');
  }

  const model = config.volcModel;
  if (!model) {
    throw new Error('未配置模型 Endpoint ID，请在扩展设置中填写方舟平台的接入点 ID（格式如 ep-xxxxxxxxx-xxxxx），不是模型显示名');
  }
  const prompt = buildPrompt(lang, keywordCount);
  console.log('[BG] callVolcengine 开始, model:', model, 'apiKey长度:', apiKey.length, 'imageData长度:', imageBase64?.length);

  const resp = await fetch(VOLCENGINE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url: { url: `data:image/jpeg;base64,${imageBase64}` },
            },
          ],
        },
      ],
      stream: false,
    }),
  });

  console.log('[BG] callVolcengine HTTP状态:', resp.status, resp.ok ? 'OK' : 'FAIL');

  const rawText = await resp.text();
  console.log('[BG] callVolcengine 原始响应长度:', rawText.length, '前200字:', rawText.substring(0, 200));

  if (!resp.ok) {
    let msg = rawText;
    try { msg = JSON.parse(rawText).error?.message || JSON.parse(rawText).message || rawText; } catch {}
    throw new Error(`火山引擎 API 错误 (${resp.status}): ${msg}`);
  }

  let data;
  try {
    data = JSON.parse(rawText);
  } catch {
    throw new Error('火山引擎返回非 JSON: ' + rawText.substring(0, 200));
  }

  let content = data.choices?.[0]?.message?.content || '';
  console.log('[BG] callVolcengine choices内容长度:', content.length, '前300字:', content.substring(0, 300));
  if (!content || content.trim() === '') {
    throw new Error('火山引擎返回为空，请检查：\n1. API Key 是否有效\n2. 模型 Endpoint ID 是否正确\n3. 额度是否用完');
  }

  content = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  console.log('[BG] callVolcengine 去思考后长度:', content.length, '前300字:', content.substring(0, 300));
  if (!content) {
    throw new Error('火山引擎返回内容仅含思考标签，无有效 JSON');
  }

  const parsed = parseAIResponse(content);
  console.log('[BG] parseAIResponse 结果:', JSON.stringify({ title: parsed.title?.substring(0, 30), description: parsed.description?.substring(0, 30), keywords: parsed.keywords?.substring(0, 60) }));
  return parsed;
}

async function callOllama(imageBase64, lang, keywordCount, config) {
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
        { role: 'user', content: prompt, images: [imageBase64] },
      ],
      stream: false,
      options: { think: false },
    }),
  });

  const rawText = await resp.text();

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

  const content = data.message?.content || data.message?.thinking || '';
  if (!content || content.trim() === '') {
    throw new Error('Ollama 返回为空，请检查模型 ' + model + ' 是否可用');
  }

  return parseAIResponse(content);
}

function getConfig() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['provider', 'model', 'apiKey', 'lang', 'keywordCount', 'volcModel', 'defaultLocation'], resolve);
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
3. **keywords**：${count}个精准中文关键词，逗号分隔。必须来自照片中的具体内容，禁止使用任何泛词（如：光线、光影、情绪、氛围、构图、色彩、美感、自然、风景等空洞概念词）。每个关键词都要是照片里看得见的具体事物或特征

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
3. **Keywords**: ${count} precise English keywords, comma-separated. Must be specific visible content from this photo. Forbidden: generic words like lighting, mood, atmosphere, composition, color, beauty, nature, landscape, texture, tone, contrast

Return ONLY valid JSON, no other text:
{"title": "Title here", "description": "Description here", "keywords": "keyword1,keyword2,keyword3"}`;
}

function cleanKeywords(kw) {
  return kw
    .replace(/[\s\n]+/g, '')
    .replace(/\*\*注\*\*[：:].*$/, '')
    .replace(/注[：:].*$/, '')
    .replace(/\(.*?\)/g, '')
    .trim();
}

function parseAIResponse(text) {
  console.log('[BG] parseAIResponse 输入长度:', text.length, '前200字:', text.substring(0, 200));

  try {
    const result = JSON.parse(text);
    console.log('[BG] parseAIResponse JSON直接解析成功, keys:', Object.keys(result));
    return result;
  } catch (e) {
    console.log('[BG] parseAIResponse JSON直接解析失败:', e.message);
  }

  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    console.log('[BG] parseAIResponse 发现markdown代码块');
    try { const r = JSON.parse(jsonMatch[1].trim()); console.log('[BG] parseAIResponse 代码块解析成功'); return r; } catch (e) { console.log('[BG] parseAIResponse 代码块解析失败:', e.message); }
  }

  const braceMatch = text.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    console.log('[BG] parseAIResponse 发现花括号匹配, 长度:', braceMatch[0].length);
    try { const r = JSON.parse(braceMatch[0]); console.log('[BG] parseAIResponse 花括号解析成功'); return r; } catch (e) { console.log('[BG] parseAIResponse 花括号解析失败:', e.message); }
  }

  const enTextTitle = text.match(/title[：:]\s*(.+?)(?:\n|。|\.|$|description|keywords)/i);
  const enTextDesc = text.match(/description[：:]\s*(.+?)(?:。|\.|$|keywords)/i);
  const enTextKw = text.match(/keywords[：:]\s*([\s\S]+)$/i);
  if (enTextTitle) {
    console.log('[BG] parseAIResponse 英文文本格式匹配成功');
    return {
      title: (enTextTitle[1] || '').trim(),
      description: (enTextDesc?.[1] || '').trim(),
      keywords: cleanKeywords(enTextKw?.[1] || ''),
    };
  }

  const textTitle = text.match(/标题[：:]\s*(.+?)(?:\n|。|\.|$|描述|关键词)/);
  const textDesc = text.match(/描述[：:]\s*(.+?)(?:。|\.|$|关键词)/);
  const textKw = text.match(/关键词[：:]\s*([\s\S]+)$/);
  if (textTitle) {
    console.log('[BG] parseAIResponse 中文文本格式匹配成功');
    return {
      title: (textTitle[1] || '').trim(),
      description: (textDesc?.[1] || '').trim(),
      keywords: cleanKeywords(textKw?.[1] || ''),
    };
  }

  const mdTitle = text.match(/\*\*标题\*\*[：:]?\s*(.+?)(?:\n|$|\*\*描述|\*\*关键词)/);
  const mdDesc = text.match(/\*\*描述\*\*[：:]?\s*(.+?)(?:\n|$|\*\*关键词)/);
  const mdKw = text.match(/\*\*关键词\*\*[：:]?\s*([\s\S]+)$/);
  if (mdTitle) {
    console.log('[BG] parseAIResponse 中文MD格式匹配成功');
    return {
      title: (mdTitle[1] || '').trim(),
      description: (mdDesc?.[1] || '').trim(),
      keywords: cleanKeywords(mdKw?.[1] || ''),
    };
  }

  const enTitle = text.match(/\*\*Title\*\*[：:]?\s*(.+?)(?:\n|$|\*\*Description|\*\*Keywords)/i);
  const enDesc = text.match(/\*\*Description\*\*[：:]?\s*(.+?)(?:\n|$|\*\*Keywords)/i);
  const enKw = text.match(/\*\*Keywords\*\*[：:]?\s*([\s\S]+)$/i);
  if (enTitle) {
    console.log('[BG] parseAIResponse 英文MD格式匹配成功');
    return {
      title: (enTitle[1] || '').trim(),
      description: (enDesc?.[1] || '').trim(),
      keywords: cleanKeywords(enKw?.[1] || ''),
    };
  }

  console.log('[BG] parseAIResponse 所有格式均未匹配，尝试纯词汇提取');
  const words = text.split(/[，,、\s\n]+/).filter(w => /[一-鿿]/.test(w));
  if (words.length >= 5) {
    console.log('[BG] parseAIResponse 纯词汇提取:', words.length, '个');
    return {
      title: words.slice(0, 4).join(''),
      description: '',
      keywords: cleanKeywords(words.join(',')),
    };
  }

  console.log('[BG] parseAIResponse 完全失败，原始文本:', text.substring(0, 200));
  throw new Error('AI 返回格式无法解析: ' + text.substring(0, 200));
}