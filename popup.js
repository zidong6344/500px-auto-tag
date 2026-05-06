// popup.js — 500px Auto Tag 设置面板
const $ = (sel) => document.querySelector(sel);

const modelEl = $('#model');
const apiKeyEl = $('#apiKey');
const keywordCountEl = $('#keywordCount');
const defaultLocationEl = $('#defaultLocation');
const saveBtn = $('#save');
const statusEl = $('#status');
const modelInfoEl = $('#modelInfo');

const OLLAMA_URL = 'http://localhost:11434';
const FALLBACK_MODELS = [
  { value: 'qwen3-vl:4b', label: 'Qwen3-VL 4B（推荐·快）' },
  { value: 'qwen3-vl:8b', label: 'Qwen3-VL 8B（更准·慢）' },
  { value: 'qwen3-vl:2b', label: 'Qwen3-VL 2B（极速）' },
];

// 从 Ollama 获取本地模型列表
async function fetchModels() {
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
    // 回退
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

// 加载已保存设置
function loadSettings() {
  try {
    chrome.storage.sync.get(
      ['model', 'apiKey', 'lang', 'keywordCount', 'defaultLocation'],
      (data) => {
        if (chrome.runtime.lastError) return;
        if (data.model && modelEl.querySelector(`option[value="${data.model}"]`)) {
          modelEl.value = data.model;
        }
        if (data.apiKey) apiKeyEl.value = data.apiKey;
        if (data.keywordCount) keywordCountEl.value = data.keywordCount;
        if (data.defaultLocation) defaultLocationEl.value = data.defaultLocation;
        if (data.lang) {
          const radio = document.querySelector(`input[name="lang"][value="${data.lang}"]`);
          if (radio) radio.checked = true;
        }
      }
    );
  } catch {}
}

// 初始化
fetchModels().then(loadSettings).catch(loadSettings);

// 保存
saveBtn.addEventListener('click', () => {
  const lang = document.querySelector('input[name="lang"]:checked').value;
  const config = {
    model: modelEl.value,
    apiKey: apiKeyEl.value.trim(),
    lang,
    keywordCount: keywordCountEl.value,
    defaultLocation: defaultLocationEl.value.trim(),
  };

  chrome.storage.sync.set(config, () => {
    showStatus('✅ 设置已保存', 'success');
  });
});

function showStatus(msg, type) {
  statusEl.textContent = msg;
  statusEl.className = `status ${type}`;
  setTimeout(() => { statusEl.className = 'status'; }, 2500);
}
