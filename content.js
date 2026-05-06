// content.js — 500px Auto Tag 内容脚本
// 注入 500px.com.cn 页面，提取图片、调用 Qwen3 AI、自动填入标题和关键词

(function () {
  'use strict';

  // ===== 配置 =====
  // 500px.com.cn 上传页面选择器（基于实际 DOM 结构）
  const SELECTORS_CN = {
    // 上传的图片 — 500px.com.cn 使用 img.thumbnail 缩略图
    image: [
      'img.thumbnail',                           // 500px.com.cn 缩略图
      'img[src*="img.500px.me"]',                 // CDN 图片
      'img[src*="cdn"]',
      'img[src*="500px"]',
    ],
    // 描述/故事 — textarea.ant-input
    description: [
      'textarea.ant-input',                      // 500px.com.cn 实际选择器
      'textarea[placeholder*="故事"]',
      'textarea[placeholder*="分享"]',
    ],
    // 关键词输入
    keywords: [
      'input.tagsInputWyr',                      // 500px.com.cn 实际选择器
      'input.tags',                              // 备选
      'textarea[placeholder*="关键词"]',
    ],
    // 地点
    location: [
      'input[placeholder*="地点"]',
      'input[placeholder*="拍摄地"]',
      'input[placeholder*="位置"]',
      'input[placeholder*="城市"]',
      '[class*="location"] input',
      '[class*="place"] input',
      '[class*="city"] input',
    ],
  };

  // 通用选择器（500px.com 国际站）
  const SELECTORS_INTL = {
    image: [
      'img[src*="drscn"]',
      'img[src*="500px"]',
      '.photo-edit img',
      '.upload-preview img',
      '[class*="photo"] img',
      'img[alt]',
    ],
    description: [
      'input[name="title"]',
      'textarea[name="title"]',
      'input[placeholder*="title" i]',
      '[class*="title"] input',
      '[class*="title"] textarea',
    ],
    keywords: [
      'input[name="keywords"]',
      'input[name="tags"]',
      'textarea[name="keywords"]',
      'input[placeholder*="keyword" i]',
      'input[placeholder*="tag" i]',
      '[class*="keyword"] input',
      '[class*="tag"] input',
    ],
    location: [
      'input[placeholder*="location" i]',
      'input[placeholder*="place" i]',
      'input[placeholder*="city" i]',
      '[class*="location"] input',
      '[class*="place"] input',
    ],
  };

  // CreatorStudio 选择器
  const SELECTORS_CS = {
    image: [
      'img.ant-image-img',                       // CreatorStudio 主图
      'img.lazy',                                // 缩略图
      'img[src*="contributor-center.oss"]',       // OSS CDN
      'img[src*="aliyuncs"]',
    ],
    description: [
      'input.right-form-title',                  // 标题输入框
      'input.ant-input-lg',                      // 大输入框
      'input[placeholder*="描述作品"]',
      'input[placeholder*="一句话"]',
    ],
    keywords: [
      'input.ant-input-borderless.full',         // 关键词输入
      'input[placeholder*="关键词"]',
      'input[placeholder*="关键词, 避免"]',
    ],
    location: [
      '.ant-cascader',                           // CreatorStudio 地点级联选择器
      '.ant-select.ant-cascader',
      '[class*="cascader"]',
    ],
  };

  // 判断用哪套选择器
  const isChina = location.hostname.includes('500px.com.cn');
  const isCreatorStudio = location.hostname.includes('creatorstudio');
  let SELECTORS;
  if (isCreatorStudio) {
    SELECTORS = SELECTORS_CS;
  } else if (isChina) {
    SELECTORS = SELECTORS_CN;
  } else {
    SELECTORS = SELECTORS_INTL;
  }

  // ===== UI 注入 =====
  let floatingBtn = null;
  let batchRunning = false;
  let batchAbort = false;

  function injectUI() {
    if (floatingBtn && document.body.contains(floatingBtn)) return;

    // 移除旧的
    if (floatingBtn) floatingBtn.remove();

    floatingBtn = document.createElement('div');
    floatingBtn.id = 'px-autotag-btn';
    floatingBtn.innerHTML = `
      <div class="px-autotag-drag-handle" title="拖拽移动">
        <span class="px-drag-dots">⋮⋮</span>
      </div>
      <div class="px-autotag-section">
        <div class="px-autotag-inner" title="分析当前选中的单张图片">
          <span class="px-autotag-icon">✨</span>
          <span class="px-autotag-text">AI Auto Tag</span>
          <span class="px-autotag-hint">单张</span>
        </div>
      </div>
      <div class="px-autotag-status" id="px-autotag-status"></div>
      <div class="px-autotag-divider"></div>
      <div class="px-autotag-section px-autotag-batch-section">
        <div class="px-batch-row">
          <button class="px-batch-btn" id="px-batch-start">⚡ 批量处理全部</button>
          <button class="px-batch-btn px-batch-stop" id="px-batch-stop" style="display:none;">⏹ 停止</button>
        </div>
        <div class="px-batch-progress" id="px-batch-progress"></div>
      </div>
    `;
    document.body.appendChild(floatingBtn);
    setupDrag(floatingBtn);
    floatingBtn.querySelector('.px-autotag-inner').addEventListener('click', runAutoTag);
    floatingBtn.querySelector('#px-batch-start')?.addEventListener('click', startBatchProcess);
    floatingBtn.querySelector('#px-batch-stop')?.addEventListener('click', () => { batchAbort = true; });
  }

  // 拖拽面板
  function setupDrag(panel) {
    const handle = panel.querySelector('.px-autotag-drag-handle');
    if (!handle) return;
    handle.style.cursor = 'grab';

    let dragging = false;
    let startX, startY, startLeft, startTop;

    function onMove(e) {
      if (!dragging) return;
      e.preventDefault();
      panel.style.setProperty('left', (startLeft + e.clientX - startX) + 'px', 'important');
      panel.style.setProperty('top', (startTop + e.clientY - startY) + 'px', 'important');
    }

    function onUp() {
      dragging = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      panel.style.cursor = '';
    }

    handle.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = panel.getBoundingClientRect();
      startLeft = rect.left;
      startTop = rect.top;
      panel.style.setProperty('bottom', 'auto', 'important');
      panel.style.setProperty('right', 'auto', 'important');
      panel.style.setProperty('left', startLeft + 'px', 'important');
      panel.style.setProperty('top', startTop + 'px', 'important');
      panel.style.cursor = 'grabbing';
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      e.preventDefault();
      e.stopPropagation();
    });
  }

  function setStatus(msg, type = 'info') {
    const el = document.getElementById('px-autotag-status');
    if (!el) return;
    el.textContent = msg;
    el.className = `px-autotag-status ${type}`;
    el.style.display = 'block';
    if (type !== 'loading') {
      setTimeout(() => { el.style.display = 'none'; }, 5000);
    }
  }

  function setBatchProgress(current, total, msg) {
    const el = document.getElementById('px-batch-progress');
    if (!el) return;
    el.innerHTML = `<span style="color:#ff6900">${current}/${total}</span> ${msg}`;
  }

  // ===== 批量处理 =====
  async function startBatchProcess() {
    if (batchRunning) return;
    batchRunning = true;
    batchAbort = false;

    const startBtn = document.getElementById('px-batch-start');
    const stopBtn = document.getElementById('px-batch-stop');
    if (startBtn) startBtn.style.display = 'none';
    if (stopBtn) stopBtn.style.display = 'inline-block';

    try {
      await batchProcessAll();
    } catch (err) {
      console.error('[Auto Tag] Batch error:', err);
      setStatus('❌ 批量处理出错: ' + err.message, 'error');
    } finally {
      batchRunning = false;
      if (startBtn) startBtn.style.display = 'inline-block';
      if (stopBtn) stopBtn.style.display = 'none';
    }
  }

  async function batchProcessAll() {
    // 获取所有卡片
    const grid = document.querySelector('.card_layout_gri, [class*="grid"]');
    let cards = document.querySelectorAll('.grid-item:not([class*="add"])');
    console.log('[Auto Tag] Batch 初始卡片数:', cards.length);

    // 滚动到底部确保虚拟列表全部渲染
    if (grid) {
      grid.scrollTop = grid.scrollHeight;
      await sleep(1500);
      cards = document.querySelectorAll('.grid-item:not([class*="add"])');
    }

    if (cards.length === 0) {
      // 尝试无 :not 选择器
      cards = document.querySelectorAll('.grid-item');
      console.log('[Auto Tag] Batch 回退卡片数:', cards.length);
    }
    if (cards.length === 0) {
      setStatus('❌ 未找到图片卡片', 'error');
      return;
    }

    console.log(`[Auto Tag] 批量处理: 共 ${cards.length} 张`);
    setStatus(`🚀 开始批量处理 ${cards.length} 张...`, 'loading');

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < cards.length; i++) {
      if (batchAbort) {
        setStatus(`⏹ 已停止，完成 ${successCount}/${i} 张`, 'info');
        break;
      }

      setBatchProgress(i + 1, cards.length, '选中卡片...');

      try {
        // 1. 滚动可见
        cards[i].scrollIntoView({ block: 'center', behavior: 'instant' });
        await sleep(400);

        // 2. 模拟完整点击序列，确保 React 捕获
        const card = cards[i];
        // 先点 card_item_hover_cover（React 的事件监听器可能在这里）
        const hoverCover = card.querySelector('[class*="hover_cover"]');
        if (hoverCover) {
          hoverCover.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
          hoverCover.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
          hoverCover.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
          hoverCover.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
          hoverCover.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        }
        // 再点 card-cover
        const cover = card.querySelector('[class*="cover"]');
        if (cover && cover !== hoverCover) {
          cover.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        }
        // 最后直接触发 card 上的 click
        card.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await sleep(1200);

        // 3. 等待 checked
        console.log(`[Auto Tag] Batch [${i+1}] 等待 checked...`);
        const isChecked = await waitForChecked(cards[i], 5000);
        console.log(`[Auto Tag] Batch [${i+1}] checked:`, isChecked);
        if (!isChecked) {
          failCount++;
          setBatchProgress(i + 1, cards.length, '⚠️ 选中超时，跳过');
          continue;
        }

        // 4. 检查 canSubmit 标记（500px 可提交状态）
        if (cards[i].querySelector('.canSubmit') || cards[i].classList.contains('canSubmit')) {
          console.log(`[Auto Tag] Batch [${i+1}] canSubmit，跳过`);
          successCount++;
          setBatchProgress(i + 1, cards.length, '⏭ 可提交，跳过');
          await sleep(300);
          continue;
        }

        // 4b. 检查是否已有标题 + >=5 关键词
        const descEl = findElement(SELECTORS.description);
        const kwEl = findElement(SELECTORS.keywords);
        const existingDesc = descEl?.value?.trim();
        const existingKw = kwEl?.value?.trim();
        const kwCount = existingKw ? existingKw.split(/[,，、;；]/).filter(k => k.trim()).length : 0;
        if (existingDesc && kwCount >= 5) {
          console.log(`[Auto Tag] Batch [${i+1}] 已有标题 + ${kwCount} 关键词，跳过`);
          successCount++;
          setBatchProgress(i + 1, cards.length, `⏭ 已有 ${kwCount} 个标签，跳过`);
          await sleep(300);
          continue;
        }
        if (existingDesc || existingKw) {
          console.log(`[Auto Tag] Batch [${i+1}] 内容不完整(标题:${!!existingDesc} 关键词:${kwCount})，重新生成`);
        }

        // 5. 获取图片 URL
        const cardImg = cards[i].querySelector('img');
        const imgUrl = cardImg?.src;
        console.log(`[Auto Tag] Batch [${i+1}] 图片:`, imgUrl);
        if (!imgUrl) {
          failCount++;
          setBatchProgress(i + 1, cards.length, '⚠️ 未找到图片，跳过');
          continue;
        }

        // 6. AI 分析
        setBatchProgress(i + 1, cards.length, 'AI 分析中...');
        let imgData;
        try {
          console.log(`[Auto Tag] Batch [${i+1}] fetchImage:`, imgUrl);
          const fetchResp = await sendMessageAsync({ action: 'fetchImage', url: imgUrl });
          imgData = fetchResp.base64;
        } catch (e) {
          if (cardImg) {
            try { imgData = await imageToBase64(cardImg); } catch {}
          }
        }
        if (!imgData) {
          failCount++;
          setBatchProgress(i + 1, cards.length, '⚠️ 图片提取失败');
          continue;
        }

        const config = await new Promise((resolve) => {
          chrome.storage.sync.get(['lang', 'keywordCount'], resolve);
        });

        const compressed = await compressImage(imgData, 1600, 0.8);

        const result = await sendMessageAsync({
          action: 'generateTags',
          imageData: compressed,
          lang: config.lang || 'zh',
          keywordCount: config.keywordCount || 35,
        });

        // 5. 填入结果
        setBatchProgress(i + 1, cards.length, '填入信息...');
        await fillFields(result);
        await sleep(500);

        successCount++;
        setBatchProgress(i + 1, cards.length, `✅ ${result.title || '完成'}`);
        console.log(`[Auto Tag] 卡片 ${i + 1}/${cards.length}: ${result.title}`);

        // 避免请求过快
        await sleep(500);

      } catch (err) {
        console.error(`[Auto Tag] 卡片 ${i + 1} 失败:`, err);
        failCount++;
        setBatchProgress(i + 1, cards.length, `❌ ${err.message}`);
      }
    }

    const msg = batchAbort
      ? `⏹ 已停止: 成功 ${successCount}, 失败 ${failCount}`
      : `🎉 批量完成: 成功 ${successCount}, 失败 ${failCount}, 共 ${cards.length} 张`;
    setStatus(msg, batchAbort ? 'info' : 'success');
    console.log(`[Auto Tag] ${msg}`);
  }

  // 等待元素获得 checked 类
  function waitForChecked(el, timeout) {
    return new Promise((resolve) => {
      if (el.classList.contains('checked')) { resolve(true); return; }
      const start = Date.now();
      const observer = new MutationObserver(() => {
        if (el.classList.contains('checked')) {
          observer.disconnect();
          resolve(true);
        } else if (Date.now() - start > timeout) {
          observer.disconnect();
          resolve(false);
        }
      });
      observer.observe(el, { attributes: true, attributeFilter: ['class'] });
      setTimeout(() => { observer.disconnect(); resolve(false); }, timeout);
    });
  }

  // 获取所有缩略图
  function getAllThumbnails() {
    const thumbs = [];
    const seen = new Set();

    // CreatorStudio: ant-image-img 缩略图（排除主图区域的大图）
    if (isCreatorStudio) {
      // 缩略图通常在左侧列表，主图在右侧预览
      const allImgs = document.querySelectorAll('img.ant-image-img');
      for (const img of allImgs) {
        const w = img.naturalWidth || img.offsetWidth || img.width || 0;
        const h = img.naturalHeight || img.offsetHeight || img.height || 0;
        // 缩略图通常较小（<500px 宽），主图较大
        if (w > 50 && w < 500 && h > 50 && h < 500) {
          const src = img.src || '';
          if (!seen.has(src)) {
            seen.add(src);
            thumbs.push(img);
          }
        }
      }

      // 如果上面没找到，尝试找列表容器里的图片
      if (thumbs.length === 0) {
        const listImgs = document.querySelectorAll('[class*="list"] img, [class*="thumb"] img, [class*="gallery"] img');
        for (const img of listImgs) {
          const w = img.naturalWidth || img.offsetWidth || img.width || 0;
          if (w > 30 && w < 400) {
            const src = img.src || '';
            if (!seen.has(src)) {
              seen.add(src);
              thumbs.push(img);
            }
          }
        }
      }
    }

    // 500px.com.cn: img.thumbnail
    if (thumbs.length === 0) {
      const cnThumbs = document.querySelectorAll('img.thumbnail');
      for (const img of cnThumbs) {
        const src = img.src || '';
        if (!seen.has(src)) {
          seen.add(src);
          thumbs.push(img);
        }
      }
    }

    // 通用回退：找所有合适大小的图片
    if (thumbs.length === 0) {
      const allImgs = document.querySelectorAll('img');
      for (const img of allImgs) {
        const w = img.naturalWidth || img.offsetWidth || img.width || 0;
        const h = img.naturalHeight || img.offsetHeight || img.height || 0;
        if (w > 80 && w < 500 && h > 80 && h < 500) {
          const src = img.src || '';
          if (!seen.has(src) && !src.includes('icon') && !src.includes('avatar') && !src.includes('logo')) {
            seen.add(src);
            thumbs.push(img);
          }
        }
      }
    }

    return thumbs;
  }

  // 点击选中缩略图
  async function selectThumbnail(thumb) {
    // 先清除之前的选中样式
    clearSelection();

    // 模拟真实点击
    thumb.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    thumb.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    thumb.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    // 如果缩略图是 img 标签，也尝试点击其父容器
    const parent = thumb.closest('[class*="item"], [class*="card"], [class*="thumb"], a, li') || thumb.parentElement;
    if (parent && parent !== thumb) {
      await sleep(100);
      parent.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    }

    // 记录 URL 并高亮
    if (thumb.src) currentImageUrl = thumb.src;
    highlightImage(thumb, '#ff6900');
  }

  // 验证是否选中成功（检查橙色区域）
  function verifySelection() {
    // 检查是否有“已选择N个作品” 的提示
    const bodyText = document.body.innerText || '';
    if (bodyText.includes('已选择') && bodyText.includes('个作品')) {
      return true;
    }

    // 检查是否有选中状态的元素
    const selectedEls = document.querySelectorAll('[class*="selected"], [class*="active"], [class*="checked"]');
    for (const el of selectedEls) {
      // 排除菜单等无关元素
      if (el.closest('[class*="photo"], [class*="image"], [class*="gallery"], [class*="list"]')) {
        return true;
      }
    }

    // 检查主图区域是否更新了
    const mainImg = document.querySelector('.ant-image-img[src*="data:image"], .ant-image-img[src*="contributor-center"]');
    if (mainImg && mainImg.naturalWidth > 200) {
      return true;
    }

    return false;
  }

  // 获取当前选中的图片（主图区域的大图）
  function getSelectedImage() {
    return getMainPreviewImage();
  }

  // 用"投票法"找当前主图：出现次数最多且不在缩略区的 src 就是当前预览图
  function getMainPreviewImage() {
    const srcCounts = new Map(); // src -> { count, bestImg, bestSize }
    const allImgs = document.querySelectorAll('img');

    for (const img of allImgs) {
      const w = img.naturalWidth || img.width || 0;
      const h = img.naturalHeight || img.height || 0;
      if (w < 100 || h < 100) continue;
      const src = img.src || '';
      if (!src || src.startsWith('data:')) continue;
      if (src.includes('icon') || src.includes('avatar') || src.includes('logo') || src.includes('favicon')) continue;

      const inThumbArea = img.closest('[class*="thumb"], [class*="list"], [class*="sidebar"], [class*="aside"], [class*="gallery"], [class*="upload-list"]');
      if (inThumbArea) continue;

      const size = w * h;
      const entry = srcCounts.get(src) || { count: 0, bestImg: null, bestSize: 0 };
      entry.count++;
      if (size > entry.bestSize) {
        entry.bestSize = size;
        entry.bestImg = img;
      }
      srcCounts.set(src, entry);
    }

    // 找出现次数最多的 src
    let best = null;
    for (const [src, entry] of srcCounts) {
      console.log('[Auto Tag] 候选:', entry.count, '次 |', entry.bestSize, 'px² |', src.substring(0, 60));
      if (!best || entry.count > best.count) {
        best = entry;
      }
    }

    if (best?.bestImg) {
      console.log('[Auto Tag] ✅ 主图:', best.bestImg.naturalWidth || best.bestImg.width, 'x', best.bestImg.naturalHeight || best.bestImg.height, '| 出现', best.count, '次');
      return best.bestImg;
    }
    return null;
  }

  // 包装 sendMessage，失败自动重试一次
  function sendMessageAsync(msg) {
    return new Promise((resolve, reject) => {
      const attempt = (retry) => {
        chrome.runtime.sendMessage(msg, (resp) => {
          if (chrome.runtime.lastError) {
            if (retry) {
              console.warn('[Auto Tag] sendMessage 失败，重试...', chrome.runtime.lastError.message);
              setTimeout(() => attempt(false), 500);
              return;
            }
            reject(new Error(chrome.runtime.lastError.message));
          } else if (resp && resp.error) {
            reject(new Error(resp.error));
          } else if (resp) {
            resolve(resp);
          } else {
            reject(new Error('无响应'));
          }
        });
      };
      attempt(true);
    });
  }

  // ===== 核心逻辑 =====
  let currentImageUrl = null; // 当前选中图片的 URL（字符串，不受 DOM 过期影响）
  let autoMode = false; // 关闭自动分析，需手动点 AI Auto Tag

  function setupImageSelection() {
    // 捕获阶段拦截缩略图点击，记录 URL（React 重绘前就拿到正确 URL）
    document.addEventListener('click', (e) => {
      if (!e.isTrusted) return; // 忽略代码触发的合成事件
      if (e.target.closest('#px-autotag-btn')) return;

      // 调试：打印 DOM 链
      let dbgChain = [];
      let dbgEl = e.target;
      while (dbgEl && dbgEl !== document.body && dbgChain.length < 6) {
        dbgChain.push(dbgEl.tagName + (dbgEl.className ? '.' + dbgEl.className.substring(0, 25) : ''));
        dbgEl = dbgEl.parentElement;
      }
      console.log('[Auto Tag] 🖱️ 点击 DOM链:', dbgChain.join(' > '));

      // 找准图片：可能点在 img 上，也可能点在覆盖层/卡片容器上
      let img = e.target.tagName === 'IMG' ? e.target : e.target.querySelector('img');
      if (!img) {
        // 卡片的覆盖层（card_item_hover_cover）：往上到父级找真正的卡片容器，再找 img
        const overlay = e.target.closest('[class*="hover_cover"], [class*="overlay"]');
        if (overlay && overlay.parentElement) {
          img = overlay.parentElement.querySelector('img');
          if (!img) {
            // 也可能 img 在隔壁兄弟元素
            const siblings = overlay.parentElement.children;
            for (const sib of siblings) {
              if (sib.tagName === 'IMG') { img = sib; break; }
              const sibImg = sib.querySelector?.('img');
              if (sibImg) { img = sibImg; break; }
            }
          }
        }
        if (!img) {
          // 通用回退：排除自身含 hover_cover/overlay 的容器
          const card = e.target.closest('[class*="card_item"]:not([class*="hover_cover"]), [class*="photo_item"], [class*="upload-item"], [class*="list-item"], li, a');
          if (card) img = card.querySelector('img');
        }
      }
      if (!img) {
        // 最后尝试：检查覆盖层父级的 background-image
        const overlay = e.target.closest('[class*="hover_cover"], [class*="overlay"]');
        const parent = overlay?.parentElement;
        if (parent) {
          // 检查 parent 的 background-image
          const bg = window.getComputedStyle(parent).backgroundImage;
          const urlMatch = bg?.match(/url\(["']?(.*?)["']?\)/);
          if (urlMatch) {
            console.log('[Auto Tag] 📌 选中(背景图):', urlMatch[1].substring(0, 80));
            currentImageUrl = urlMatch[1];
            if (autoMode) setTimeout(() => runAutoTag(), 500);
            return;
          }
          // 检查 parent 的子元素
          for (const child of parent.children) {
            const childBg = window.getComputedStyle(child).backgroundImage;
            const childMatch = childBg?.match(/url\(["']?(.*?)["']?\)/);
            if (childMatch && childMatch[1] && childMatch[1] !== 'none') {
              console.log('[Auto Tag] 📌 选中(子元素背景图):', childMatch[1].substring(0, 80));
              currentImageUrl = childMatch[1];
              if (autoMode) setTimeout(() => runAutoTag(), 500);
              return;
            }
          }
          // 打印完整父级链帮助调试
          let chain = [];
          let el = e.target;
          while (el && el !== document.body) {
            chain.push(el.tagName + (el.className ? '.' + el.className.substring(0, 30) : '') + (el.id ? '#' + el.id : ''));
            el = el.parentElement;
          }
          console.log('[Auto Tag] DOM链:', chain.join(' > '));
        }
        if (!img) {
          console.log('[Auto Tag] ⚠️ 未找到 img');
          return;
        }
      }

      const w = img.naturalWidth || img.offsetWidth || img.width || 0;
      if (w < 50) {
        console.log('[Auto Tag] ⚠️ 图片太小:', w, 'px, 跳过');
        return;
      }

      const url = img.src;
      if (url) {
        console.log('[Auto Tag] 📌 选中:', url.substring(0, 80));
        currentImageUrl = url;
        highlightImage(img, '#00d4aa');
      }

      // 自动模式：点击图片后自动触发分析
      if (autoMode) {
        setTimeout(() => runAutoTag(), 500);
      }
    }, true); // capture phase — 在 React 处理之前拦截

  }

  function clearSelection() {
    currentImageUrl = null;
  }

  // 高亮图片（闪烁边框标记找到的图片）
  function highlightImage(img, color) {
    const origOutline = img.style.outline;
    const origOutlineOffset = img.style.outlineOffset;
    img.style.outline = `4px dashed ${color}`;
    img.style.outlineOffset = '3px';
    img.style.zIndex = '9999';
    // 1.5秒后恢复
    setTimeout(() => {
      img.style.outline = origOutline;
      img.style.outlineOffset = origOutlineOffset;
      img.style.zIndex = '';
    }, 1500);
  }

  async function runAutoTag() {
    try {
      // 找选中卡片（checked class）→ 点击拦截 → 自动定位
      let imgUrl = null;

      // 方式1：找 checked / selected 状态的卡片
      const checkedCard = document.querySelector('.grid-item.checked, [class*="grid-item"][class*="checked"], [class*="card"][class*="checked"], [class*="card"][class*="selected"], [class*="card"][class*="active"]');
      if (checkedCard) {
        const cardImg = checkedCard.querySelector('img');
        if (cardImg?.src) {
          imgUrl = cardImg.src;
          highlightImage(cardImg, '#ff6900');
          console.log('[Auto Tag] 🎯 选中卡片:', imgUrl.substring(0, 80));
        }
      }

      // 方式2：点击拦截
      if (!imgUrl && currentImageUrl) {
        imgUrl = currentImageUrl;
        console.log('[Auto Tag] 🎯 点击拦截:', imgUrl.substring(0, 80));
      }

      // 方式3：自动定位
      if (!imgUrl) {
        setStatus('🔍 自动定位图片...', 'loading');
        imgUrl = await findImageUrl();
        console.log('[Auto Tag] 🎯 自动定位:', imgUrl?.substring(0, 80));
      }

      if (!imgUrl) {
        setStatus('❌ 未找到图片，请点击一张缩略图', 'error');
        return;
      }

      setStatus('🔍 获取图片...', 'loading');

      // 通过 background 获取图片（有 CORS 权限，且每次都拉最新图）
      let imgData;
      try {
        const fetchResp = await sendMessageAsync({ action: 'fetchImage', url: imgUrl });
        imgData = fetchResp.base64;
      } catch (e) {
        console.warn('[Auto Tag] Background fetch failed, trying direct:', e.message);
        const mainImg = getMainPreviewImage();
        if (mainImg) {
          imgData = await imageToBase64(mainImg);
        }
      }

      if (!imgData) {
        setStatus('❌ 无法获取图片数据', 'error');
        return;
      }

      // 2. 读取设置
      const config = await new Promise((resolve) => {
        chrome.storage.sync.get(['lang', 'keywordCount'], resolve);
      });

      setStatus('🤖 Qwen3 AI 分析中...', 'loading');

      // 压缩图片
      imgData = await compressImage(imgData, 1600, 0.8);

      // 3. 调用 AI
      const result = await sendMessageAsync({
        action: 'generateTags',
        imageData: imgData,
        lang: config.lang || 'zh',
        keywordCount: config.keywordCount || 35,
      });

      // 4. 填入结果
      fillFields(result);
      setStatus('✅ 已生成！标题: ' + (result.title || ''), 'success');

    } catch (err) {
      console.error('[500px Auto Tag] Error:', err);
      setStatus('❌ ' + err.message, 'error');
    }
  }

  // ===== 图片 URL 提取 =====
  async function findImageUrl() {
    // CreatorStudio: 先点击第一张缩略图激活预览
    if (isCreatorStudio) {
      const thumbs = getAllThumbnails();
      if (thumbs.length > 0) {
        console.log('[Auto Tag] 自动点击第一张缩略图激活预览');
        await selectThumbnail(thumbs[0]);
        await sleep(1000); // 等待主图加载
      }

      // 获取主预览区的大图 URL
      const mainImg = getMainPreviewImage();
      if (mainImg && mainImg.src) {
        highlightImage(mainImg, '#ff6900');
        return mainImg.src;
      }

      // 回退：用缩略图 URL
      if (thumbs.length > 0 && thumbs[0].src) {
        return thumbs[0].src;
      }
    }

    // 500px.com.cn: img.thumbnail
    const cnThumbs = document.querySelectorAll('img.thumbnail');
    if (cnThumbs.length > 0) {
      return cnThumbs[0].src;
    }

    // 通用回退：找第一个大图的 src
    for (const sel of SELECTORS.image) {
      const el = document.querySelector(sel);
      if (el && el.tagName === 'IMG' && el.naturalWidth > 100) {
        return el.src;
      }
    }

    return null;
  }

  // 500px CDN 缩略图 URL 转高清
  function get500pxHdUrl(thumbUrl) {
    if (!thumbUrl) return thumbUrl;
    // 500px CDN 通常支持 ?w= 参数或路径中的尺寸后缀
    // 尝试几种常见模式
    let url = thumbUrl;
    // 移除可能的尺寸限制参数
    url = url.replace(/[?&](w|width|size|h|height)=[^&]*/gi, '');
    // 添加请求高清的参数
    const sep = url.includes('?') ? '&' : '?';
    url = `${url}${sep}w=2000`;
    return url;
  }

  async function imageToBase64(imgEl) {
    const src = imgEl.src || imgEl.getAttribute('data-src');

    // data: URL 直接提取
    if (src && src.startsWith('data:image')) {
      return src.split(',')[1];
    }

    // 统一用 background fetch（有 CORS 权限，不受 tainted canvas 影响）
    if (src) {
      try {
        const resp = await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage(
            { action: 'fetchImage', url: src },
            (r) => {
              if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
              else if (r && r.error) reject(new Error(r.error));
              else if (r && r.base64) resolve(r.base64);
              else reject(new Error('empty response'));
            }
          );
        });
        return resp;
      } catch (e) {
        console.warn('[Auto Tag] background fetch failed:', e.message);
      }
    }

    // 最后回退：canvas（仅同源图片有效）
    try {
      const canvas = document.createElement('canvas');
      canvas.width = imgEl.naturalWidth || imgEl.width;
      canvas.height = imgEl.naturalHeight || imgEl.height;
      if (canvas.width > 0 && canvas.height > 0) {
        const ctx = canvas.getContext('2d');
        ctx.drawImage(imgEl, 0, 0);
        const data = canvas.toDataURL('image/jpeg', 0.85);
        if (data && data.length > 100) return data.split(',')[1];
      }
    } catch (e) {
      console.warn('[Auto Tag] canvas also failed:', e.message);
    }

    return null;
  }

  function canvasToBase64(canvas) {
    try {
      return canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
    } catch (e) {
      console.warn('[Auto Tag] canvas export failed:', e);
      return null;
    }
  }

  async function urlToBase64(url) {
    const resp = await fetch(url, { credentials: 'include' });
    const blob = await resp.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  // ===== 填充字段 =====
  async function fillFields(result) {
    // 填标题/描述
    const descEl = findElement(SELECTORS.description);
    if (descEl) {
      let descText = '';
      if (isCreatorStudio) {
        descText = (result.title || '').substring(0, 50);
      } else if (result.title && result.description) {
        descText = `${result.title} - ${result.description}`;
      } else if (result.title) {
        descText = result.title;
      } else if (result.description) {
        descText = result.description;
      }
      if (descText) {
        setNativeValue(descEl, descText);
      }
    }

    // 填关键词
    if (result.keywords) {
      const kwEl = findElement(SELECTORS.keywords);
      if (kwEl) {
        const keywords = Array.isArray(result.keywords)
          ? result.keywords.map(k => String(k).trim()).filter(Boolean)
          : String(result.keywords).split(/[,，、;；]+/).map(k => k.trim()).filter(Boolean);
        if (isCreatorStudio) {
          await fillKeywordsSequentially(kwEl, keywords.slice(0, 35));
        } else {
          await fillKeywordsSequentially(kwEl, keywords);
        }
      }
    }

    // 填默认地点（Cascader 级联选择器）
    const config = await new Promise((resolve) => {
      chrome.storage.sync.get(['defaultLocation'], resolve);
    });
    if (config.defaultLocation) {
      await fillCascaderLocation(config.defaultLocation);
    }
  }

  // 逐个填入关键词并触发回车（500px 标签输入需要回车确认）
  async function fillKeywordsSequentially(el, keywords) {
    // 先清除已有关键词
    clearExistingKeywords();
    await sleep(300);

    for (const kw of keywords) {
      setNativeValue(el, kw);
      await sleep(200);
      // 触发回车确认标签
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
      await sleep(150);
    }
  }

  // 清除已有关键词标签
  function clearExistingKeywords() {
    // 500px.com.cn: 点击每个标签的删除按钮
    const closeBtns = document.querySelectorAll(
      '.ant-tag .anticon-close, .ant-tag-close-icon, [class*="tag"] .close, [class*="tag"] [class*="close"], .tags .close'
    );
    closeBtns.forEach(btn => btn.click());

    // CreatorStudio: 删除已有标签
    const csCloseBtns = document.querySelectorAll(
      '.ant-tag .anticon-close-circle, .ant-tag .anticon-close, [class*="keyword"] [class*="close"], [class*="tag-item"] [class*="close"]'
    );
    csCloseBtns.forEach(btn => btn.click());

    // 通用：找所有小 X 按钮
    document.querySelectorAll('[class*="tag"] [class*="close"], [class*="tag"] svg').forEach(el => {
      try { el.click(); } catch {}
    });
  }

  // 压缩图片（限制最大尺寸和质量）
  function compressImage(base64, maxSide, quality) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        let w = img.width;
        let h = img.height;
        if (w > maxSide || h > maxSide) {
          const ratio = Math.min(maxSide / w, maxSide / h);
          w = Math.round(w * ratio);
          h = Math.round(h * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        const compressed = canvas.toDataURL('image/jpeg', quality).split(',')[1];
        console.log('[Auto Tag] 压缩:', img.width, 'x', img.height, '->', w, 'x', h, '|', Math.round(base64.length/1024), 'KB ->', Math.round(compressed.length/1024), 'KB');
        resolve(compressed);
      };
      img.onerror = () => resolve(base64); // 压缩失败就用原图
      img.src = 'data:image/jpeg;base64,' + base64;
    });
  }

  // 地点配置映射（省/市 -> [国家, 省/市]）
  const LOCATION_MAP = {
    '北京': ['中国', '北京'],
    '上海': ['中国', '上海'],
    '天津': ['中国', '天津市'],
    '重庆': ['中国', '重庆'],
    '香港': ['中国', '香港'],
    '澳门': ['中国', '澳门'],
    '广东省': ['中国', '广东省'],
    '浙江省': ['中国', '浙江省'],
    '江苏省': ['中国', '江苏省'],
    '四川省': ['中国', '四川省'],
    '云南省': ['中国', '云南省'],
    '山东省': ['中国', '山东省'],
    '河南省': ['中国', '河南省'],
    '河北省': ['中国', '河北省'],
    '湖南省': ['中国', '湖南省'],
    '湖北省': ['中国', '湖北省'],
    '安徽省': ['中国', '安徽省'],
    '福建省': ['中国', '福建省'],
    '江西省': ['中国', '江西省'],
    '陕西省': ['中国', '陕西省'],
    '山西省': ['中国', '山西省'],
    '辽宁省': ['中国', '辽宁省'],
    '吉林省': ['中国', '吉林省'],
    '黑龙江省': ['中国', '黑龙江省'],
    '贵州省': ['中国', '贵州省'],
    '甘肃省': ['中国', '甘肃省'],
    '海南省': ['中国', '海南省'],
    '青海省': ['中国', '青海省'],
    '广西壮族自治区': ['中国', '广西壮族自治区'],
    '西藏自治区': ['中国', '西藏自治区'],
    '宁夏回族自治区': ['中国', '宁夏回族自治区'],
    '新疆维吾尔自治区': ['中国', '新疆维吾尔自治区'],
    '内蒙古自治区': ['中国', '内蒙古自治区'],
  };

  // 填 Cascader 地点（级联选择器，纯点击方式）
  async function fillCascaderLocation(place) {
    const cascader = document.querySelector('.ant-cascader, .ant-select.ant-cascader, [class*="cascader"]');
    if (!cascader) {
      console.warn('[Auto Tag] 未找到地点选择器');
      return;
    }

    // 查找地点路径
    let path = LOCATION_MAP[place];
    if (!path) {
      // 尝试模糊匹配
      for (const [key, val] of Object.entries(LOCATION_MAP)) {
        if (key.includes(place) || place.includes(key)) {
          path = val;
          break;
        }
      }
    }
    if (!path) {
      // 默认当作中国下的城市
      path = ['中国', place];
    }

    console.log('[Auto Tag] 地点路径:', path);

    // 打开下拉：focus 搜索输入框
    const searchInput = cascader.querySelector('.ant-select-selection-search-input');
    if (searchInput) {
      searchInput.focus();
      searchInput.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    } else {
      const selector = cascader.querySelector('.ant-select-selector') || cascader;
      selector.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    }
    await sleep(800);

    // 检查下拉是否打开
    const dropdownOpen = document.querySelector('.ant-cascader-dropdown:not(.ant-select-dropdown-hidden)');
    console.log('[Auto Tag] 下拉已打开:', !!dropdownOpen);

    // 逐级点击
    for (let level = 0; level < path.length; level++) {
      const target = path[level];
      const clicked = await clickCascaderOption(target);
      if (!clicked) {
        console.warn('[Auto Tag] 未找到地点选项:', target);
        break;
      }
      await sleep(400);
    }

    // 关闭下拉（点其他地方）
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await sleep(200);
    console.log('[Auto Tag] 地点已填入:', place);
  }

  // 点击级联菜单中指定文字的选项
  async function clickCascaderOption(text) {
    const allItems = document.querySelectorAll('.ant-cascader-menu-item');
    for (const item of allItems) {
      const t = item.textContent?.trim();
      if (t === text) {
        console.log('[Auto Tag] 点击:', text);
        item.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        item.click();
        return true;
      }
    }
    console.warn('[Auto Tag] 未找到选项:', text);
    return false;
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // 等待图片加载完成
  function waitForImages(selector, timeout = 5000) {
    return new Promise((resolve) => {
      const start = Date.now();
      function check() {
        const imgs = document.querySelectorAll(selector);
        for (const img of imgs) {
          if (img.complete && img.naturalWidth > 0) {
            resolve(true);
            return;
          }
          if (img.offsetWidth > 0 || img.width > 0) {
            resolve(true);
            return;
          }
        }
        if (Date.now() - start > timeout) {
          resolve(false);
          return;
        }
        setTimeout(check, 300);
      }
      check();
    });
  }

  // 触发 React/Vue/Ant Design 的响应式更新
  function setNativeValue(el, value) {
    // React 16+ 的 value setter
    const proto = el.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;

    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;

    if (setter) {
      setter.call(el, value);
    } else {
      el.value = value;
    }

    // 触发各种事件确保框架能捕获
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));

    // Ant Design 有时需要 focus + blur
    el.focus();
    el.dispatchEvent(new Event('focus', { bubbles: true }));
    el.blur();
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  // ===== DOM 查找 =====
  function findElement(selectorList) {
    for (const sel of selectorList) {
      const el = document.querySelector(sel);
      if (el && isVisible(el)) return el;
    }
    return null;
  }

  function isVisible(el) {
    const style = window.getComputedStyle(el);
    return style.display !== 'none' &&
           style.visibility !== 'hidden' &&
           style.opacity !== '0' &&
           el.offsetParent !== null;
  }

  // ===== 初始化 =====
  // 长连接防止 Service Worker 在 AI 推理期间被 Chrome 回收
  let keepAlivePort;
  let keepAliveTimer;
  function connectKeepAlive() {
    keepAlivePort = chrome.runtime.connect({ name: 'keepalive' });
    keepAlivePort.onDisconnect.addListener(() => {
      clearInterval(keepAliveTimer);
      setTimeout(connectKeepAlive, 500);
    });
    // 每 20 秒发一次心跳，保持连接活跃
    keepAliveTimer = setInterval(() => {
      try { keepAlivePort.postMessage({ ping: true }); } catch {}
    }, 20000);
  }

  function init() {
    connectKeepAlive();
    injectUI();
    setupImageSelection();
    // 延迟再注入一次，确保 SPA 动态内容加载后按钮还在
    setTimeout(injectUI, 2000);
    setTimeout(injectUI, 5000);
    console.log('[500px Auto Tag] ✨ 已注入 (域:', location.hostname, '| 类型:', isCreatorStudio ? '创作者工作室' : isChina ? '中国站' : '国际站', ')');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // 500px 是 SPA，监听 DOM 变化
  let lastUrl = location.href;
  const observer = new MutationObserver(() => {
    // URL 变化时重新初始化
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(init, 1500);
      return;
    }
    // 按钮被移除时自动补回
    if (floatingBtn && !document.body.contains(floatingBtn)) {
      floatingBtn = null;
      injectUI();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

})();
