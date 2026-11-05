(() => {
  'use strict';

  const root = document.documentElement;
  const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
  const themeOptions = [...document.querySelectorAll('input[name="theme-mode"]')];
  const diagrams = [...document.querySelectorAll('.mermaid')].map((element) => {
    const source = element.cloneNode(true);
    source.querySelectorAll('br').forEach((br) => br.replaceWith('<br/>'));
    return { element, source: source.textContent };
  });
  let themeMode = 'system';
  let mermaidLoader;
  let diagramQueue = Promise.resolve();
  let diagramRevision = 0;

  // 禁用存储的浏览器仍可在当前页面切换主题。
  try {
    const saved = localStorage.getItem('victor-theme');
    if (['system', 'light', 'dark'].includes(saved)) themeMode = saved;
  } catch {}

  // 只在含图表的页面加载 Mermaid，失败时保留可读的原始图表内容。
  function loadMermaid() {
    if (window.mermaid) return Promise.resolve(window.mermaid);
    if (!mermaidLoader) {
      mermaidLoader = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://unpkg.com/mermaid@10.6.1/dist/mermaid.min.js';
        script.onload = () => {
          if (window.mermaid) {
            window.mermaid.initialize({ startOnLoad: false });
            resolve(window.mermaid);
          } else reject(new Error('Mermaid unavailable'));
        };
        script.onerror = () => {
          script.remove();
          reject(new Error('Mermaid unavailable'));
        };
        document.head.append(script);
      }).catch((error) => {
        mermaidLoader = undefined;
        throw error;
      });
    }
    return mermaidLoader;
  }

  // 串行绘图并丢弃过时结果，快速切换主题时不会被旧的异步结果覆盖。
  function renderDiagrams() {
    if (!diagrams.length) return;
    const revision = ++diagramRevision;
    diagramQueue = diagramQueue.then(async () => {
      if (revision !== diagramRevision) return;
      const mermaid = await loadMermaid();
      if (revision !== diagramRevision) return;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: root.dataset.theme === 'dark' ? 'dark' : 'default',
      });
      for (const [index, diagram] of diagrams.entries()) {
        if (revision !== diagramRevision) return;
        try {
          const { svg, bindFunctions } = await mermaid.render(`diagram-${revision}-${index}`, diagram.source);
          if (revision !== diagramRevision) return;
          diagram.element.innerHTML = svg;
          diagram.element.removeAttribute('data-render-error');
          if (bindFunctions) bindFunctions(diagram.element);
        } catch {
          if (revision !== diagramRevision) return;
          diagram.element.textContent = diagram.source;
          diagram.element.dataset.renderError = '图表暂时无法显示，以下为原始内容';
        }
      }
    }).catch(() => {
      if (revision !== diagramRevision) return;
      diagrams.forEach(({ element }) => {
        element.dataset.renderError = '图表加载失败，以下为原始内容';
      });
    });
  }

  // data-theme 保存实际配色；system 偏好继续跟随系统变化。
  function applyTheme() {
    const theme = themeMode === 'system' ? (systemTheme.matches ? 'dark' : 'light') : themeMode;
    const changed = root.dataset.theme !== theme;
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    themeOptions.forEach((option) => { option.checked = option.value === themeMode; });
    if (changed) renderDiagrams();
  }

  applyTheme();
  if (!diagramRevision) renderDiagrams();
  themeOptions.forEach((option) => option.addEventListener('change', () => {
    if (!option.checked) return;
    themeMode = option.value;
    try { localStorage.setItem('victor-theme', themeMode); } catch {}
    applyTheme();
  }));
  systemTheme.addEventListener('change', () => {
    if (themeMode === 'system') applyTheme();
  });

  // 标题只轮换可视词语，读屏标题保持完整；离屏、后台和减少动态效果时停用计时器。
  function initHeroWordFlip() {
    const word = document.querySelector('#hero-word');
    if (!word || !('IntersectionObserver' in window)) return;
    const current = word.querySelector('.hero-word-current');
    const next = word.querySelector('.hero-word-next');
    const words = word.dataset.words.split(',');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let visible = false;
    let index = 0;
    let timer;

    // 每次恢复都先完整停留 1.2 秒，避免回到页面时立即翻字。
    function scheduleFlip() {
      clearTimeout(timer);
      word.classList.remove('is-flipping');
      if (visible && !document.hidden && !reducedMotion.matches) timer = setTimeout(flip, 1200);
    }

    // CSS 完成一次 400ms 翻转后，再把新词变为静态层，下一轮只更新隐藏层。
    function flip() {
      next.textContent = words[(index + 1) % words.length];
      word.classList.add('is-flipping');
      timer = setTimeout(() => {
        index = (index + 1) % words.length;
        current.textContent = words[index];
        scheduleFlip();
      }, 400);
    }

    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      scheduleFlip();
    });
    observer.observe(word);
    document.addEventListener('visibilitychange', scheduleFlip);
    reducedMotion.addEventListener('change', scheduleFlip);
  }
  initHeroWordFlip();

  const dialog = document.querySelector('#search-dialog');
  const searchInput = document.querySelector('#site-search');
  const results = document.querySelector('#search-results');
  let indexPromise;
  let searchRevision = 0;
  let searchTrigger;

  // 搜索文件也按外部输入处理：过滤异常记录和站外/脚本 URL。
  async function loadSearchIndex() {
    if (!indexPromise) {
      indexPromise = fetch('/search-index.json').then(async (response) => {
        if (!response.ok) throw new Error('Search unavailable');
        const data = await response.json();
        if (!Array.isArray(data)) throw new Error('Invalid search index');
        return data.filter((item) => {
          if (!item || !['title', 'heading', 'url', 'text'].every((key) => typeof item[key] === 'string')) return false;
          try {
            const url = new URL(item.url, location.href);
            return url.origin === location.origin && ['http:', 'https:'].includes(url.protocol);
          } catch { return false; }
        });
      }).catch((error) => {
        indexPromise = undefined;
        throw error;
      });
    }
    return indexPromise;
  }

  // 只创建文本节点和 mark，正文里的 HTML 不会成为搜索结果中的可执行内容。
  function appendHighlighted(element, text, terms) {
    const escaped = terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const pattern = new RegExp(escaped.join('|'), 'gi');
    let offset = 0;
    for (const match of text.matchAll(pattern)) {
      element.append(document.createTextNode(text.slice(offset, match.index)));
      const mark = document.createElement('mark');
      mark.textContent = match[0];
      element.append(mark);
      offset = match.index + match[0].length;
    }
    element.append(document.createTextNode(text.slice(offset)));
  }

  // 摘要围绕正文中的首次命中展开，读者能在跳转前判断章节是否相关。
  function excerpt(text, terms) {
    const normalized = text.replace(/\s+/g, ' ');
    const positions = terms.map((term) => normalized.toLowerCase().indexOf(term)).filter((index) => index >= 0);
    const start = Math.max(0, (positions.length ? Math.min(...positions) : 0) - 28);
    const end = start + 140;
    return `${start ? '…' : ''}${normalized.slice(start, end)}${end < normalized.length ? '…' : ''}`;
  }

  // 每次输入使用独立序号，较慢的索引请求不会把旧查询写回界面。
  async function search() {
    const revision = ++searchRevision;
    const terms = [...new Set(searchInput.value.trim().toLowerCase().split(/\s+/).filter(Boolean))];
    if (!terms.length) {
      results.textContent = '输入关键词，搜索文章标题、章节和正文。';
      return;
    }
    results.textContent = '正在搜索…';
    try {
      const index = await loadSearchIndex();
      if (revision !== searchRevision) return;
      const matches = index.filter((item) => {
        const text = `${item.title} ${item.heading} ${item.text}`.toLowerCase();
        return terms.every((term) => text.includes(term));
      });
      results.replaceChildren();
      const summary = document.createElement('p');
      summary.className = 'search-summary';
      summary.textContent = matches.length ? `找到 ${matches.length} 处匹配${matches.length > 20 ? '，显示前 20 项' : ''}` : '没有找到匹配内容，试试更短的关键词。';
      results.append(summary);
      const list = document.createElement('ul');
      list.className = 'search-result-list';
      for (const item of matches.slice(0, 20)) {
        const result = document.createElement('li');
        const link = document.createElement('a');
        link.className = 'search-result-link';
        link.href = item.url;
        appendHighlighted(link, item.heading ? `${item.title} · ${item.heading}` : item.title, terms);
        const description = document.createElement('p');
        appendHighlighted(description, excerpt(item.text, terms), terms);
        result.append(link, description);
        list.append(result);
      }
      results.append(list);
    } catch {
      if (revision === searchRevision) results.textContent = '暂时无法加载搜索内容，请检查网络后重新输入。';
    }
  }

  // 原生 dialog 管理焦点限制与 Escape；关闭后回到打开它的控件。
  function openSearch(trigger) {
    if (dialog.open) return;
    searchTrigger = trigger || document.activeElement;
    dialog.showModal();
    searchInput.focus();
    searchInput.select();
    search();
  }

  if (dialog && searchInput && results) {
    document.querySelectorAll('[data-open-search]').forEach((button) => {
      button.addEventListener('click', () => openSearch(button));
    });
    document.querySelectorAll('[data-close-search]').forEach((button) => {
      button.addEventListener('click', () => dialog.close());
    });
    dialog.addEventListener('close', () => searchTrigger?.focus());
    // 同一篇文章的章节跳转也要关闭弹窗，否则目标仍被遮挡。
    results.addEventListener('click', (event) => {
      if (event.target.closest('a')) dialog.close();
    });
    searchInput.addEventListener('input', search);
    document.addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        openSearch();
      }
    });
  }

  const article = document.querySelector('#article-content');
  const backTop = document.querySelector('.back-top');
  if (backTop && article) {
    // 只计算正文：底部进入视口即读完，标题、相邻文章和评论不拉长进度。
    function updateBackTop() {
      const { top, height, bottom } = article.getBoundingClientRect();
      const viewport = window.innerHeight;
      const progress = height > viewport
        ? Math.max(0, Math.min(1, -top / (height - viewport)))
        : Number(bottom <= viewport);
      backTop.style.setProperty('--reading-progress', `${progress * 100}%`);
      backTop.setAttribute('aria-label', `回到顶部（已阅读 ${Math.round(progress * 100)}%）`);
    }

    // 回到整页顶部；减少动态效果时直接定位，不沿用全局平滑滚动。
    backTop.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    });
    window.addEventListener('scroll', updateBackTop, { passive: true });
    window.addEventListener('resize', updateBackTop);
    // 图片、图表和代码折叠改变正文高度时，静止中的进度环也要同步。
    if ('ResizeObserver' in window) new ResizeObserver(updateBackTop).observe(article);
    updateBackTop();
  }
  const tocLinks = [...document.querySelectorAll('.toc-link')];
  const headings = article ? [...article.querySelectorAll('h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]')] : [];

  // 桌面和手机目录同步标记当前位置，不改变浏览器原生锚点跳转。
  function setCurrentHeading(id) {
    tocLinks.forEach((link) => {
      let target;
      try { target = decodeURIComponent(link.hash.slice(1)); } catch { target = link.hash.slice(1); }
      if (target === id) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
  }

  if (headings.length && 'IntersectionObserver' in window) {
    const observer = new IntersectionObserver(() => {
      let current = headings[0];
      for (const heading of headings) {
        if (heading.getBoundingClientRect().top <= 120) current = heading;
        else break;
      }
      setCurrentHeading(current.id);
    }, { rootMargin: '-96px 0px -60% 0px' });
    headings.forEach((heading) => observer.observe(heading));
  }
  tocLinks.forEach((link) => link.addEventListener('click', () => {
    const mobileToc = link.closest('details.mobile-toc');
    if (mobileToc) mobileToc.open = false;
  }));

  // Hexo 用 br 保存换行，克隆后转成文本，避免复制时把代码行粘在一起。
  function codeText(code) {
    const clone = code.cloneNode(true);
    clone.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
    return clone.textContent.replace(/\n$/, '');
  }

  article?.querySelectorAll('figure.highlight').forEach((figure, index) => {
    const code = figure.querySelector('td.code');
    const table = figure.querySelector('table');
    if (!code || !table) return;
    const text = codeText(code);
    const lines = text.split('\n').length;
    const toolbar = document.createElement('div');
    toolbar.className = 'code-toolbar';
    const language = document.createElement('span');
    language.className = 'code-language';
    language.textContent = [...figure.classList].find((name) => name !== 'highlight') || 'code';
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'code-copy';
    copy.textContent = '复制代码';
    copy.setAttribute('aria-live', 'polite');
    copy.addEventListener('click', async () => {
      copy.disabled = true;
      try {
        await navigator.clipboard.writeText(text);
        copy.textContent = '已复制';
      } catch {
        copy.textContent = '复制失败，请手动选择代码';
      } finally {
        copy.disabled = false;
      }
    });
    toolbar.append(language, copy);
    const content = document.createElement('div');
    content.className = 'code-content';
    content.id = `code-content-${index}`;
    table.replaceWith(content);
    content.append(table);
    figure.prepend(toolbar);
    if (lines > 16) {
      figure.classList.add('is-collapsed');
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'code-toggle';
      toggle.setAttribute('aria-controls', content.id);
      toggle.setAttribute('aria-expanded', 'false');
      toggle.textContent = `展开全部 ${lines} 行`;
      toggle.addEventListener('click', () => {
        const collapsed = figure.classList.toggle('is-collapsed');
        toggle.setAttribute('aria-expanded', String(!collapsed));
        toggle.textContent = collapsed ? `展开全部 ${lines} 行` : '收起代码';
      });
      figure.append(toggle);
    }
  });

  // 首次异步绘图/代码折叠可能移动 hash 目标；仅在用户尚未操作时校准一次。
  function alignInitialAnchor() {
    const initialHash = location.hash;
    if (!article || !initialHash || (!diagrams.length && !article.querySelector('.code-toggle'))) return;
    let target;
    try { target = document.getElementById(decodeURIComponent(initialHash.slice(1))); } catch { return; }
    // 留言位于正文之后，同样会被前面的异步图表和代码折叠推移。
    if (!target || !(article.closest('.reading-article') || article).contains(target)) return;
    let pending = true;
    const interactions = ['wheel', 'touchstart', 'pointerdown', 'keydown', 'hashchange'];
    // 主动滚动、点击或新的锚点导航优先，取消后不再调整阅读位置。
    function cancel() {
      pending = false;
      interactions.forEach((type) => window.removeEventListener(type, cancel, true));
    }
    interactions.forEach((type) => window.addEventListener(type, cancel, { capture: true, passive: true }));
    const loaded = document.readyState === 'complete' ? Promise.resolve() : new Promise((resolve) => {
      window.addEventListener('load', resolve, { once: true });
    });
    Promise.all([loaded, diagramQueue]).then(() => {
      if (!pending) return;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const shouldAlign = pending && location.hash === initialHash;
        cancel();
        // 校准不是导航动画，instant 同时避免 reduced-motion 下的额外移动过程。
        if (shouldAlign) target.scrollIntoView({ behavior: 'instant', block: 'start' });
      }));
    });
  }
  alignInitialAnchor();
})();
