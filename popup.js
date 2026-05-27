// popup.js — 500px Auto Tag 设置面板
const $ = (sel) => document.querySelector(sel);

const providerGroup = document.querySelectorAll('input[name="provider"]');
const volcSection = $('#volcSection');
const mimoSection = $('#mimoSection');
const ollamaSection = $('#ollamaSection');
const modelEl = $('#model');
const apiKeyEl = $('#apiKey');
const ollamaApiKeyEl = $('#ollamaApiKey');
const volcModelEl = $('#volcModel');
const mimoApiKeyEl = $('#mimoApiKey');
const mimoModelEl = $('#mimoModel');
const keywordCountEl = $('#keywordCount');
const defaultLocationEl = $('#defaultLocation');
const defaultKeywordsEl = $('#defaultKeywords');
const saveBtn = $('#save');
const statusEl = $('#status');
const modelInfoEl = $('#modelInfo');

const OLLAMA_URL = 'http://localhost:11434';
const FALLBACK_MODELS = [
  { value: 'qwen3-vl:4b', label: 'Qwen3-VL 4B（推荐·快）' },
  { value: 'qwen3-vl:8b', label: 'Qwen3-VL 8B（更准·慢）' },
  { value: 'qwen3-vl:2b', label: 'Qwen3-VL 2B（极速）' },
];

const VOLC_MODELS = [];

function switchProvider(provider) {
  volcSection.classList.toggle('section-visible', provider === 'volcengine');
  mimoSection.classList.toggle('section-visible', provider === 'mimo');
  ollamaSection.classList.toggle('section-visible', provider === 'ollama');
  if (provider === 'ollama') fetchModels();
}

providerGroup.forEach(radio => {
  radio.addEventListener('change', () => switchProvider(radio.value));
});

// 火山引擎模型下拉
function initVolcModelSelect() {
  const saved = volcModelEl.value;
  volcModelEl.innerHTML = '<option value="">请填入你在方舟平台创建的 Endpoint ID</option>';
  if (saved) {
    const opt = document.createElement('option');
    opt.value = saved;
    opt.textContent = saved;
    volcModelEl.insertBefore(opt, volcModelEl.firstChild);
    volcModelEl.value = saved;
  }
}

async function fetchModels() {
  if (ollamaSection.style.display === 'none' && !ollamaSection.classList.contains('section-visible')) return;
  try {
    const resp = await fetch(`${OLLAMA_URL}/api/tags`);
    if (!resp.ok) throw new Error('Ollama 未响应');
    const data = await resp.json();
    const models = data.models || [];
    if (models.length === 0) throw new Error('无模型');

    modelEl.innerHTML = models.map(m =>
      `<option value="${m.name}">${m.name} (${formatSize(m.size)})</option>`
    ).join('');
    modelInfoEl.innerHTML = `已连接 Ollama，共 <strong>${models.length}</strong> 个模型`;
  } catch {
    modelEl.innerHTML = FALLBACK_MODELS.map(m =>
      `<option value="${m.value}">${m.label}</option>`
    ).join('');
    modelInfoEl.innerHTML = '⚠️ 无法连接 Ollama，显示默认列表';
  }
}

function formatSize(bytes) {
  if (!bytes) return '';
  const gb = bytes / 1024 / 1024 / 1024;
  return gb >= 1 ? gb.toFixed(1) + 'GB' : (bytes / 1024 / 1024).toFixed(0) + 'MB';
}

function loadSettings() {
  try {
    chrome.storage.sync.get(
      ['provider', 'model', 'apiKey', 'lang', 'keywordCount', 'defaultLocation', 'volcModel', 'defaultKeywords', 'mimoApiKey', 'mimoModel'],
      (data) => {
        if (chrome.runtime.lastError) return;
        const provider = data.provider || 'volcengine';
        const radio = document.querySelector(`input[name="provider"][value="${provider}"]`);
        if (radio) radio.checked = true;
        switchProvider(provider);

        if (data.apiKey) apiKeyEl.value = data.apiKey;
        if (data.ollamaApiKey) ollamaApiKeyEl.value = data.ollamaApiKey;
        if (data.volcModel) {
          const opt = document.createElement('option');
          opt.value = data.volcModel;
          opt.textContent = data.volcModel;
          volcModelEl.insertBefore(opt, volcModelEl.firstChild);
          volcModelEl.value = data.volcModel;
        }
        if (data.model && modelEl.querySelector(`option[value="${data.model}"]`)) {
          modelEl.value = data.model;
        }
        if (data.keywordCount) keywordCountEl.value = data.keywordCount;
        if (data.defaultLocation) defaultLocationEl.value = data.defaultLocation;
        if (data.defaultKeywords) defaultKeywordsEl.value = data.defaultKeywords;
        if (data.mimoApiKey) mimoApiKeyEl.value = data.mimoApiKey;
        if (data.mimoModel) mimoModelEl.value = data.mimoModel;
        if (data.lang) {
          const langRadio = document.querySelector(`input[name="lang"][value="${data.lang}"]`);
          if (langRadio) langRadio.checked = true;
        }
      }
    );
  } catch {}
}

initVolcModelSelect();
loadSettings();

saveBtn.addEventListener('click', () => {
  const provider = document.querySelector('input[name="provider"]:checked').value;
  const lang = document.querySelector('input[name="lang"]:checked').value;
  const config = {
    provider,
    apiKey: apiKeyEl.value.trim(),
    volcModel: volcModelEl.value === 'custom' ? '' : volcModelEl.value,
    model: modelEl.value,
    ollamaApiKey: ollamaApiKeyEl.value.trim(),
    mimoApiKey: mimoApiKeyEl.value.trim(),
    mimoModel: mimoModelEl.value,
    lang,
    keywordCount: keywordCountEl.value,
    defaultLocation: defaultLocationEl.value.trim(),
    defaultKeywords: defaultKeywordsEl.value.trim(),
  };

  if (provider === 'volcengine' && !config.apiKey) {
    showStatus('❌ 请填写火山引擎 API Key', 'error');
    return;
  }

  if (provider === 'mimo' && !config.mimoApiKey) {
    showStatus('❌ 请填写 Mimo API Key', 'error');
    return;
  }

  chrome.storage.sync.set(config, () => {
    showStatus('✅ 设置已保存', 'success');
  });
});

function showStatus(msg, type) {
  statusEl.textContent = msg;
  statusEl.className = `status ${type}`;
  setTimeout(() => { statusEl.className = 'status'; }, 2500);
}