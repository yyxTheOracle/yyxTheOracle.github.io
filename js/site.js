(() => {
  'use strict';

  const root = document.documentElement;
  const header = document.querySelector('.site-header');
  // 窄屏换行和浏览器缩放会改变导航高度，锚点与目录共用实际尺寸。
  function updateHeaderHeight() {
    root.style.setProperty('--header-height', `${header.getBoundingClientRect().height}px`);
  }
  if (header) {
    updateHeaderHeight();
    if ('ResizeObserver' in window) new ResizeObserver(updateHeaderHeight).observe(header);
    else window.addEventListener('resize', updateHeaderHeight);
  }

  const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
  const themeOptions = [...document.querySelectorAll('input[name="theme-mode"]')];
  const diagrams = [...document.querySelectorAll('.mermaid')].map((element) => {
    // 构建时的占位文案不属于 Mermaid 源码；未收录尺寸的图仍读取原始元素。
    const source = (element.querySelector('.mermaid-source') || element).cloneNode(true);
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
      diagrams.forEach(({ element, source }) => {
        // CDN 不可用时撤掉占位，恢复源码，避免留下永远加载中的空框。
        if (!element.querySelector('svg')) element.textContent = source;
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
  const tocDialog = document.querySelector('#mobile-toc-dialog');
  let currentHeadingId;

  // 只滚动目录自己的容器，避免 scrollIntoView 连带移动正在阅读的正文。
  function revealTocLink(link, container) {
    if (!container) return;
    const bounds = container.getBoundingClientRect();
    if (!bounds.height) return;
    const item = link.getBoundingClientRect();
    if (item.top < bounds.top) container.scrollTop += item.top - bounds.top - 8;
    else if (item.bottom > bounds.bottom) container.scrollTop += item.bottom - bounds.bottom + 8;
  }

  // 桌面和手机目录共用当前章节，只在章节变化时更新高亮和目录位置。
  function setCurrentHeading(id) {
    if (currentHeadingId === id) return;
    currentHeadingId = id;
    tocLinks.forEach((link) => {
      let target;
      try { target = decodeURIComponent(link.hash.slice(1)); } catch { target = link.hash.slice(1); }
      if (target === id) {
        link.setAttribute('aria-current', 'location');
        revealTocLink(link, link.closest('.desktop-toc'));
      } else link.removeAttribute('aria-current');
    });
  }

  if (headings.length && tocLinks.length) {
    // 每帧最多计算一次；平滑滚动结束时即使没有新的交叉事件，也能准确选中章节。
    function updateCurrentHeading() {
      let current = headings[0];
      for (const heading of headings) {
        if (heading.getBoundingClientRect().top <= (header ? header.getBoundingClientRect().height + 72 : 120)) current = heading;
        else break;
      }
      setCurrentHeading(current.id);
    }
    let scheduled = false;
    function scheduleCurrentHeading() {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        updateCurrentHeading();
      });
    }
    window.addEventListener('scroll', scheduleCurrentHeading, { passive: true });
    window.addEventListener('resize', scheduleCurrentHeading);
    window.addEventListener('hashchange', scheduleCurrentHeading);
    if ('ResizeObserver' in window) new ResizeObserver(scheduleCurrentHeading).observe(article);
    updateCurrentHeading();
  }
  tocLinks.forEach((link) => link.addEventListener('click', () => {
    const mobileToc = link.closest('details.mobile-toc');
    if (mobileToc) mobileToc.open = false;
    if (tocDialog?.open && tocDialog.contains(link)) tocDialog.close();
  }));

  const mobileToc = document.querySelector('.mobile-toc');
  const tocTrigger = document.querySelector('.mobile-toc-trigger');
  if (mobileToc && tocTrigger && typeof tocDialog?.showModal === 'function') {
    const nav = mobileToc.querySelector('nav');
    const summary = mobileToc.querySelector('summary');
    let openedFrom;
    // 复用页首目录节点；无 dialog 支持或 JS 未加载时仍可展开原生 details。
    tocDialog.append(nav);
    root.classList.add('mobile-toc-ready');
    summary.setAttribute('aria-haspopup', 'dialog');
    summary.setAttribute('aria-controls', tocDialog.id);

    function openToc(event) {
      event.preventDefault();
      openedFrom = event.currentTarget;
      tocDialog.showModal();
      root.classList.add('toc-open');
      const current = nav.querySelector('[aria-current="location"]');
      if (current) revealTocLink(current, nav);
    }
    summary.addEventListener('click', openToc);
    tocTrigger.addEventListener('click', openToc);
    tocDialog.querySelector('[data-close-toc]').addEventListener('click', () => tocDialog.close());
    tocDialog.addEventListener('click', (event) => {
      const bounds = tocDialog.getBoundingClientRect();
      if (event.target === tocDialog && (event.clientX < bounds.left || event.clientX > bounds.right ||
          event.clientY < bounds.top || event.clientY > bounds.bottom)) tocDialog.close();
    });
    // Esc、关闭按钮和选章都走同一清理，恢复焦点时不改变原来的滚动位置。
    tocDialog.addEventListener('close', () => {
      root.classList.remove('toc-open');
      openedFrom?.focus({ preventScroll: true });
    });
  }

  if (headings.length) {
    const status = document.createElement('span');
    status.className = 'sr-only';
    status.setAttribute('role', 'status');
    article.append(status);
    let highlighted;
    let highlightTimer;
    let statusTimer;

    // 只提示锚点指向的正文标题，不改变目录导航或浏览器自己的滚动位置。
    function highlightChapter() {
      let id;
      try { id = decodeURIComponent(location.hash.slice(1)); } catch { return; }
      highlighted?.classList.remove('is-chapter-target');
      clearTimeout(highlightTimer);
      highlighted = headings.find((heading) => heading.id === id);
      if (!highlighted) return;
      highlighted.classList.add('is-chapter-target');
      highlightTimer = setTimeout(() => highlighted?.classList.remove('is-chapter-target'), 2000);
    }
    window.addEventListener('hashchange', highlightChapter);
    tocLinks.forEach((link) => link.addEventListener('click', () => {
      if (link.hash === location.hash) highlightChapter();
    }));
    highlightChapter();

    headings.forEach((heading) => {
      const link = heading.querySelector('a.headerlink');
      if (!link) return;
      const label = `复制章节链接：${heading.textContent.trim()}`;
      link.setAttribute('aria-label', label);
      link.title = '复制本节链接';
      let feedbackTimer;
      let copying = false;

      // 提示不占正文空间；读屏提示和可见反馈使用同一份文案。
      function showLinkFeedback(message) {
        clearTimeout(feedbackTimer);
        clearTimeout(statusTimer);
        link.dataset.feedback = message;
        status.textContent = message;
        feedbackTimer = setTimeout(() => { delete link.dataset.feedback; }, 3000);
        // 共享读屏提示只由最后一次操作清理，避免旧章节提前清掉新反馈。
        statusTimer = setTimeout(() => { status.textContent = ''; }, 3000);
      }
      link.addEventListener('click', async (event) => {
        // 修饰键仍能打开原生章节链接，无剪贴板权限时也保留地址栏复制的退路。
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        if (!navigator.clipboard?.writeText) {
          showLinkFeedback('请从地址栏复制本节链接');
          return;
        }
        event.preventDefault();
        if (copying) return;
        copying = true;
        try {
          await navigator.clipboard.writeText(link.href);
          showLinkFeedback('本节链接已复制');
        } catch {
          location.hash = link.hash;
          showLinkFeedback('复制失败，请从地址栏复制');
        } finally {
          copying = false;
        }
      });
    });
  }

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
    let copyFeedbackTimer;
    copy.addEventListener('click', async () => {
      clearTimeout(copyFeedbackTimer);
      copy.disabled = true;
      try {
        await navigator.clipboard.writeText(text);
        copy.textContent = '已复制';
      } catch {
        copy.textContent = '复制失败，请手动选择代码';
      } finally {
        copy.disabled = false;
        // 每次操作都有短暂反馈，再次复制时重新计时。
        copyFeedbackTimer = setTimeout(() => { copy.textContent = '复制代码'; }, 2500);
      }
    });
    toolbar.append(language, copy);
    const content = document.createElement('div');
    content.className = 'code-content';
    content.id = `code-content-${index}`;
    content.tabIndex = 0;
    content.setAttribute('role', 'region');
    content.setAttribute('aria-label', `${language.textContent} 代码内容`);
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
        const blockTop = figure.getBoundingClientRect().top;
        const collapsed = figure.classList.toggle('is-collapsed');
        toggle.setAttribute('aria-expanded', String(!collapsed));
        toggle.textContent = collapsed ? `展开全部 ${lines} 行` : '收起代码';
        // 从长代码末尾收起时回到代码块开头，避免落到后面不相关的正文。
        if (collapsed && blockTop < 0) figure.scrollIntoView({ behavior: 'instant', block: 'start' });
      });
      figure.append(toggle);
    }
  });

  article?.querySelectorAll(':scope > table').forEach((table, index) => {
    const group = document.createElement('div');
    group.className = 'article-table';
    const scroll = document.createElement('div');
    scroll.className = 'article-table-scroll';
    const hint = document.createElement('p');
    hint.className = 'article-table-hint';
    hint.id = `article-table-hint-${index}`;
    hint.textContent = '左右滑动查看完整表格';
    hint.hidden = true;
    table.replaceWith(group);
    scroll.append(table);
    group.append(hint, scroll);

    // 只有被裁切的表格需要提示和键盘停靠点，普通表格保持原来的阅读顺序。
    function updateTableOverflow() {
      const overflow = scroll.scrollWidth > scroll.clientWidth + 1;
      hint.hidden = !overflow;
      if (overflow) {
        scroll.tabIndex = 0;
        scroll.setAttribute('role', 'region');
        scroll.setAttribute('aria-label', table.caption?.textContent.trim() || '文章表格');
        scroll.setAttribute('aria-describedby', hint.id);
      } else {
        scroll.removeAttribute('tabindex');
        scroll.removeAttribute('role');
        scroll.removeAttribute('aria-label');
        scroll.removeAttribute('aria-describedby');
      }
    }
    if ('ResizeObserver' in window) {
      const observer = new ResizeObserver(updateTableOverflow);
      observer.observe(scroll);
      observer.observe(table);
    } else window.addEventListener('resize', updateTableOverflow);
    updateTableOverflow();
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
