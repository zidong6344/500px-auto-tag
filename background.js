// background.js — 500px Auto Tag 后台服务
// 支持火山引擎方舟 Coding Plan 视觉模型 + 本地 Ollama

const OLLAMA_URL = 'http://localhost:11434';
const VOLCENGINE_URL = 'https://ark.cn-beijing.volces.com/api/coding/v3/chat/completions';

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
    console.log('[BG] generateTags 收到请求, lang:', request.lang, 'keywordCount:', request.keywordCount, 'imageData长度:', request.imageData?.length, 'imageUrl:', request.imageUrl?.substring(0, 80));
    handleGenerateTags(request.imageData, request.imageUrl, request.lang, request.keywordCount, request.location, request.locationHint)
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

async function handleGenerateTags(imageBase64, imageUrl, lang, keywordCount, location, locationHint) {
  const config = await getConfig();
  const loc = location || '';
  const locHint = locationHint || '';
  console.log('[BG] 配置:', JSON.stringify({ provider: config.provider, apiKey: config.apiKey ? '已配置(' + config.apiKey.length + '字)' : '未配置', volcModel: config.volcModel || '未配置', model: config.model || '未配置', location: loc || '未设置', locationHint: locHint || '未设置' }));
  const provider = config.provider || 'volcengine';

  if (provider === 'volcengine') {
    return callVolcengine(imageBase64, lang, keywordCount, loc, config, locHint);
  }
  return callOllama(imageBase64, lang, keywordCount, loc, config, locHint);
}

async function callVolcengine(imageBase64, lang, keywordCount, location, config, locationHint) {
  const apiKey = config.apiKey;
  if (!apiKey) {
    throw new Error('未配置火山引擎 API Key，请在扩展设置中填写');
  }

  const model = config.volcModel;
  if (!model) {
    throw new Error('未配置模型，请在扩展设置中选择 Coding Plan 模型（如 doubao-seed-2.1-pro）');
  }
  const prompt = buildPrompt(lang, keywordCount, location, locationHint);
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
              image_url: { url: `data:image/jpeg;base64,${imageBase64}`, detail: 'auto' },
            },
          ],
        },
      ],
      stream: false,
      max_tokens: 700,
      // 关闭深度思考：思考token会占用max_tokens且拖慢响应（实测96s→6s）
      thinking: { type: 'disabled' },
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
  chrome.storage.local.set({ __lastResult: { raw: content.slice(0, 2000), parsed, rawLen: content.length } }); // 调试用（持久，SW重启不丢）
  console.log('[BG] parseAIResponse 结果:', JSON.stringify({ title: parsed.title?.substring(0, 30), description: parsed.description?.substring(0, 30), keywords: parsed.keywords?.substring(0, 60) }));
  return parsed;
}

async function callOllama(imageBase64, lang, keywordCount, location, config, locationHint) {
  const model = config.model || 'qwen3-vl:4b';
  const prompt = buildPrompt(lang, keywordCount, location, locationHint);

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
    chrome.storage.sync.get(['provider', 'model', 'apiKey', 'lang', 'keywordCount', 'volcModel'], resolve);
  });
}

function buildPrompt(lang, keywordCount, location, locationHint) {
  const count = keywordCount || 35;
  const kwHint = location
    ? `\n## 指定关键词\n请在标题中自然融入以下关键词：**${location}**。标题中必须包含这些词（如"${location}的..."或"...的${location}"），并在关键词列表中也包含这些词。\n`
    : '';
  if (lang === 'zh') {
    return `你是视觉中国图库编辑，为照片写标题和关键词。
${kwHint}
标题规则：15-30字长句，包含主体+场景+光线/氛围，具体不空洞，陈述句，不用"美丽""漂亮"等词。
示例："黄昏时分航拍上海陆家嘴天际线 落日余晖映照在玻璃幕墙上"

分析照片生成：
1. title：15-30字标题
2. keywords：${count}个精准中文关键词，逗号分隔，必须是照片中看得见的具体事物（物体名称、部件、材质、颜色、数量、位置），禁止抽象泛词（如：风景、自然、旅行、风光、美景、氛围、光影、天空之美、度假、美丽）
3. location：推断拍摄地，格式"省份 地级行政区"，如"青海省 海西"、"甘肃省 酒泉"。第二部分必须是地级行政区（地级市/自治州/地区/盟），禁止县级市、县、区、景区名（例如格尔木是县级市，应写其上级"海西"州；茶卡盐湖是景区，应写"海西"）${locationHint ? `。参考范围：照片拍摄于【${locationHint}】一带，location 必须从该区域的行政区划中选择，若画面明显不属于该区域或无法判断，返回""` : '，无法判断返回""'}

只返回JSON（location必须在keywords之前，不要description）：{"title":"...","location":"省份 城市","keywords":"..."}`;
  }
  const kwHintEn = location
    ? `\n## Required Keywords\nThe following keywords MUST appear in the title: **${location}**. Naturally weave them into the title (e.g. "${location} ..." or "... of ${location}"), and also include them in the keywords list.\n`
    : '';
  return `You are a stock photo editor writing titles and keywords.
${kwHintEn}
Title: 10-20 words, include subject+scene+lighting, specific not vague.

Analyze and return JSON only:
1. title: 10-20 word descriptive title
2. keywords: ${count} specific visible keywords, comma-separated, name concrete objects/parts/materials/colors/positions; BAN abstract words (e.g. landscape, nature, travel, beauty, mood, vacation)
3. location: administrative divisions only, format "Province Prefecture-level division" (e.g. "Qinghai Haixi", "Gansu Jiuquan"). The second part MUST be a prefecture-level division (prefecture-level city / autonomous prefecture); NO county-level cities, counties, districts or scenic spots (e.g. Golmud is a county-level city, use its parent "Haixi"; Chaka Salt Lake is a scenic spot, use "Haixi")${locationHint ? `; Reference area: photos were taken around [${locationHint}], location MUST be an administrative division within that area, return "" if the scene clearly does not belong there or is unidentifiable` : '; empty string if unsure'}

{"title":"...","location":"Province City","keywords":"..."}`;
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