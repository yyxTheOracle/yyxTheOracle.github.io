(() => {
  'use strict';

  const article = document.querySelector('#article-content');
  const dialog = document.querySelector('#media-viewer');
  if (!article || !dialog || typeof dialog.showModal !== 'function') return;
  const viewport = dialog.querySelector('.media-viewer-viewport');
  const canvas = dialog.querySelector('.media-viewer-canvas');
  const caption = dialog.querySelector('.media-viewer-caption');
  const zoomIn = dialog.querySelector('[data-media-zoom="in"]');
  const zoomOut = dialog.querySelector('[data-media-zoom="out"]');
  let origin;
  let picture;
  let objectURL;
  let width;
  let height;
  let scale = 1;
  let drag;

  // 按视口适配后再缩放，保留当前观察中心；不修改正文中媒体的大小或位置。
  function resizePicture(nextScale) {
    if (!picture || !width || !height) return;
    const centerX = (viewport.scrollLeft + viewport.clientWidth / 2) / (viewport.scrollWidth || 1);
    const centerY = (viewport.scrollTop + viewport.clientHeight / 2) / (viewport.scrollHeight || 1);
    scale = Math.max(1, Math.min(4, nextScale));
    const fit = Math.min(1, (viewport.clientWidth - 32) / width, (viewport.clientHeight - 32) / height);
    picture.style.width = `${Math.max(1, width * fit * scale)}px`;
    picture.style.height = `${Math.max(1, height * fit * scale)}px`;
    viewport.scrollLeft = Math.max(0, centerX * viewport.scrollWidth - viewport.clientWidth / 2);
    viewport.scrollTop = Math.max(0, centerY * viewport.scrollHeight - viewport.clientHeight / 2);
    zoomIn.disabled = scale === 4;
    zoomOut.disabled = scale === 1;
  }

  // 图表转为独立 SVG 图片，避免复制的 SVG id 与正文箭头、样式引用相互干扰。
  function openPicture(target) {
    const svg = target.matches('.mermaid') ? target.querySelector('svg') : null;
    if (target.matches('.mermaid') && !svg) return;
    origin = target;
    picture = document.createElement('img');
    picture.draggable = false;
    picture.alt = svg ? '文章图表' : target.alt || '文章图片';
    if (svg) {
      const box = svg.getAttribute('viewBox').split(/[ ,]+/).map(Number);
      [width, height] = box.slice(2);
      const copy = svg.cloneNode(true);
      copy.setAttribute('width', width);
      copy.setAttribute('height', height);
      copy.style.maxWidth = 'none';
      // 正文会覆盖旧图写死的浅色节点；独立 SVG 图片也要带上最终配色。
      const shapes = '.node>rect,.node>polygon,.node>circle,.node>ellipse,.cluster rect';
      const originals = svg.querySelectorAll(shapes);
      copy.querySelectorAll(shapes).forEach((shape, index) => {
        const style = getComputedStyle(originals[index]);
        shape.style.setProperty('fill', style.fill, 'important');
        shape.style.setProperty('stroke', style.stroke, 'important');
      });
      objectURL = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)], { type: 'image/svg+xml' }));
      picture.src = objectURL;
    } else {
      width = target.naturalWidth || Number(target.getAttribute('width'));
      height = target.naturalHeight || Number(target.getAttribute('height'));
      picture.src = target.currentSrc || target.src;
    }
    const current = picture;
    picture.addEventListener('load', () => {
      if (picture !== current || !dialog.open) return;
      width = current.naturalWidth;
      height = current.naturalHeight;
      resizePicture(scale);
    });
    picture.addEventListener('error', () => {
      if (picture === current && dialog.open) caption.textContent = '图片暂时无法加载，请关闭后重试。';
    });
    canvas.replaceChildren(picture);
    caption.textContent = `${picture.alt} · 放大后可拖动或滚动查看`;
    document.documentElement.classList.add('media-viewer-open');
    dialog.showModal();
    resizePicture(1);
    viewport.scrollTop = viewport.scrollLeft = 0;
  }

  // 保留图片原有链接行为；其余图片及图表可通过点击、Enter 或空格打开。
  article.querySelectorAll('img, .mermaid').forEach((target) => {
    if (target.closest('a')) return;
    target.classList.add('media-zoomable');
    target.tabIndex = 0;
    target.setAttribute('role', 'button');
    target.setAttribute('aria-haspopup', 'dialog');
    target.setAttribute('aria-label', `放大查看${target.alt ? `：${target.alt}` : target.matches('.mermaid') ? '图表' : '图片'}`);
    target.addEventListener('click', () => openPicture(target));
    target.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      openPicture(target);
    });
  });
  zoomIn.addEventListener('click', () => resizePicture(scale * 1.5));
  zoomOut.addEventListener('click', () => resizePicture(scale / 1.5));
  dialog.querySelector('[data-media-zoom="fit"]').addEventListener('click', () => resizePicture(1));
  dialog.querySelector('[data-media-close]').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => {
    document.documentElement.classList.remove('media-viewer-open');
    canvas.replaceChildren();
    picture = null;
    drag = null;
    if (objectURL) URL.revokeObjectURL(objectURL);
    objectURL = null;
    origin?.focus({ preventScroll: true });
  });
  window.addEventListener('resize', () => { if (dialog.open) resizePicture(scale); });

  // 鼠标按住拖动；触屏沿用浏览器原生滑动和页面缩放，不拦截触控手势。
  viewport.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    drag = { x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
    viewport.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  viewport.addEventListener('pointermove', (event) => {
    if (!drag) return;
    viewport.scrollLeft = drag.left + drag.x - event.clientX;
    viewport.scrollTop = drag.top + drag.y - event.clientY;
  });
  viewport.addEventListener('lostpointercapture', () => { drag = null; });
})();
