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
  const previous = dialog.querySelector('[data-media-step="-1"]');
  const next = dialog.querySelector('[data-media-step="1"]');
  const navigation = dialog.querySelector('.media-viewer-navigation');
  const counter = dialog.querySelector('.media-viewer-counter');
  // 先收集正文原图，再生成缩略图；缩略图不会重复进入整篇图库。
  const images = [...article.querySelectorAll('img')].filter(image => !image.closest('a, pre, code, .mermaid'));
  let origin;
  let picture;
  let objectURL;
  let width;
  let height;
  let index = -1;
  let scale = 1;
  let mode = 'fit';
  let drag;

  /** 图注说明图片与正文的关系；没有图注时沿用图片的替代文字。 */
  function description(image) {
    return image.closest('figure')?.querySelector('figcaption')?.textContent.trim() || image.dataset.caption || image.alt || '文章图片';
  }

  /** 仅增强显式图组，原始 figure 保留在 DOM 中作为无脚本回退和图库来源。 */
  article.querySelectorAll('.article-gallery').forEach((gallery) => {
    const figures = [...gallery.children].filter(child => child.matches('figure.article-image') && child.querySelector('img'));
    if (figures.length < 2) return;
    const heading = document.createElement('div');
    heading.className = 'article-gallery-heading';
    const title = document.createElement('strong');
    title.textContent = gallery.getAttribute('aria-label') || '文章图组';
    const status = document.createElement('span');
    status.className = 'article-gallery-status';
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('aria-atomic', 'true');
    status.textContent = `1 / ${figures.length} · 长图可在阅读区内滚动`;
    heading.append(title, status);
    const thumbnails = document.createElement('div');
    thumbnails.className = 'article-gallery-thumbnails';
    thumbnails.setAttribute('role', 'group');
    thumbnails.setAttribute('aria-label', '选择图组图片');
    const buttons = figures.map((figure, position) => {
      const source = figure.querySelector('img');
      const reader = document.createElement('div');
      reader.className = 'article-gallery-scroll';
      reader.tabIndex = 0;
      reader.setAttribute('role', 'region');
      reader.setAttribute('aria-label', `${description(source)}，可上下滚动阅读`);
      // 移动完整媒体结构，保留 picture 的 source、原始链接及其点击行为。
      reader.append(...[...figure.childNodes].filter(node => node.nodeName !== 'FIGCAPTION'));
      figure.prepend(reader);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'article-gallery-thumbnail';
      button.setAttribute('aria-pressed', String(position === 0));
      const thumbnail = document.createElement('img');
      thumbnail.src = source.currentSrc || source.src;
      if (source.srcset) {
        thumbnail.srcset = source.srcset;
        thumbnail.sizes = '124px';
      }
      thumbnail.alt = '';
      thumbnail.loading = 'lazy';
      thumbnail.decoding = 'async';
      const label = document.createElement('span');
      label.textContent = description(source);
      if (!/^图\s*\d/.test(label.textContent)) label.textContent = `图 ${position + 1}：${label.textContent}`;
      button.append(thumbnail, label);
      button.addEventListener('click', () => {
        figures.forEach((item, itemIndex) => { item.hidden = itemIndex !== position; });
        buttons.forEach((item, itemIndex) => item.setAttribute('aria-pressed', String(itemIndex === position)));
        // 只重置当前阅读区；保留选图焦点，让连续切换不再带动整篇文章。
        reader.scrollTop = 0;
        status.textContent = `${position + 1} / ${figures.length} · 长图可在阅读区内滚动`;
        button.focus({ preventScroll: true });
      });
      figure.hidden = position !== 0;
      return button;
    });
    thumbnails.append(...buttons);
    // DOM 顺序与手机布局一致：先选图，再通过 Tab 进入可见阅读区。
    gallery.prepend(heading, thumbnails);
    gallery.classList.add('is-enhanced');
  });

  /** 按视口适配后缩放，保留观察中心；超长原图也能放到原始像素尺寸。 */
  function resizePicture(nextScale, fromTop = false) {
    if (!picture || !width || !height) return;
    const centerX = (viewport.scrollLeft + viewport.clientWidth / 2) / (viewport.scrollWidth || 1);
    const centerY = (viewport.scrollTop + viewport.clientHeight / 2) / (viewport.scrollHeight || 1);
    const fit = Math.min(1, Math.max(1, viewport.clientWidth - 32) / width, Math.max(1, viewport.clientHeight - 32) / height);
    const maximum = Math.max(4, 1 / fit);
    const widthScale = Math.min(1, Math.max(1, viewport.clientWidth - 32) / width) / fit;
    scale = Math.max(1, Math.min(maximum, mode === 'width' ? widthScale : nextScale));
    picture.style.width = `${Math.max(1, width * fit * scale)}px`;
    picture.style.height = `${Math.max(1, height * fit * scale)}px`;
    viewport.scrollLeft = fromTop ? 0 : Math.max(0, centerX * viewport.scrollWidth - viewport.clientWidth / 2);
    viewport.scrollTop = fromTop ? 0 : Math.max(0, centerY * viewport.scrollHeight - viewport.clientHeight / 2);
    viewport.dataset.fitted = String(scale === 1);
    zoomIn.disabled = scale >= maximum;
    zoomOut.disabled = scale === 1;
  }

  /** 渲染当前图片，切换时丢弃旧加载回调并重置缩放，不移动正文。 */
  function showPicture(target) {
    const svg = target.matches('.mermaid') ? target.querySelector('svg') : null;
    if (target.matches('.mermaid') && !svg) return false;
    if (objectURL) URL.revokeObjectURL(objectURL);
    objectURL = null;
    index = images.indexOf(target);
    picture = document.createElement('img');
    picture.draggable = false;
    picture.decoding = 'async';
    picture.alt = svg ? '文章图表' : target.alt || '文章图片';
    if (svg) {
      const box = svg.getAttribute('viewBox').split(/[ ,]+/).map(Number);
      [width, height] = box.slice(2);
      const copy = svg.cloneNode(true);
      copy.setAttribute('width', width);
      copy.setAttribute('height', height);
      copy.style.maxWidth = 'none';
      // 独立 SVG 带上正文最终配色，同时避免 id 与正文箭头引用冲突。
      const shapes = '.node>rect,.node>polygon,.node>circle,.node>ellipse,.cluster rect';
      const originals = svg.querySelectorAll(shapes);
      copy.querySelectorAll(shapes).forEach((shape, shapeIndex) => {
        const style = getComputedStyle(originals[shapeIndex]);
        shape.style.setProperty('fill', style.fill, 'important');
        shape.style.setProperty('stroke', style.stroke, 'important');
      });
      objectURL = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)], { type: 'image/svg+xml' }));
      picture.src = objectURL;
    } else {
      width = Number(target.dataset.originalWidth) || target.naturalWidth || Number(target.getAttribute('width'));
      height = Number(target.dataset.originalHeight) || target.naturalHeight || Number(target.getAttribute('height'));
      // 动画的正文资源就是原始字节副本，无需再请求外部图床。
      picture.src = target.dataset.mediaAnimated === 'true' ? target.src : target.dataset.originalSrc || target.currentSrc || target.src;
    }
    const current = picture;
    picture.addEventListener('load', () => {
      if (picture !== current || !dialog.open) return;
      width = current.naturalWidth;
      height = current.naturalHeight;
      resizePicture(scale);
    });
    picture.addEventListener('error', () => {
      if (picture === current && dialog.open) caption.textContent = '图片暂时无法加载，可以切换其他图片或关闭后重试。';
    });
    canvas.replaceChildren(picture);
    caption.textContent = `${svg ? picture.alt : description(target)} · 放大后可拖动或滚动查看`;
    navigation.hidden = index < 0 || images.length < 2;
    counter.textContent = index < 0 ? '' : `${index + 1} / ${images.length}`;
    previous.disabled = index <= 0;
    next.disabled = index < 0 || index === images.length - 1;
    mode = 'fit';
    scale = 1;
    drag = null;
    resizePicture(1, true);
    return true;
  }

  /** 每次打开只记住最初触发点，跨图浏览后关闭仍回到原阅读位置。 */
  function openPicture(target) {
    if (!showPicture(target)) return;
    origin = target;
    document.documentElement.classList.add('media-viewer-open');
    dialog.showModal();
    resizePicture(1, true);
  }

  /** 整篇按正文顺序浏览，首尾停止；图表没有普通图片索引。 */
  function changePicture(step) {
    if (index < 0 || index + step < 0 || index + step >= images.length) return;
    showPicture(images[index + step]);
  }

  [...images, ...article.querySelectorAll('.mermaid')].forEach((target) => {
    if (target.closest('a')) return;
    target.classList.add('media-zoomable');
    target.tabIndex = 0;
    target.setAttribute('role', 'button');
    target.setAttribute('aria-haspopup', 'dialog');
    target.setAttribute('aria-label', `放大查看：${target.matches('.mermaid') ? '图表' : description(target)}`);
    target.addEventListener('click', () => openPicture(target));
    target.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      openPicture(target);
    });
  });
  previous.addEventListener('click', () => changePicture(-1));
  next.addEventListener('click', () => changePicture(1));
  zoomIn.addEventListener('click', () => { mode = 'zoom'; resizePicture(scale * 1.5); });
  zoomOut.addEventListener('click', () => { mode = 'zoom'; resizePicture(scale / 1.5); });
  dialog.querySelector('[data-media-zoom="fit"]').addEventListener('click', () => { mode = 'fit'; resizePicture(1, true); });
  dialog.querySelector('[data-media-zoom="width"]').addEventListener('click', () => { mode = 'width'; resizePicture(scale, true); });
  dialog.querySelector('[data-media-close]').addEventListener('click', () => dialog.close());
  // 只有从外部遮罩按下并松手时才关闭；放大拖图或点到边框不触发误关。
  let pressedInsideDialog = false;
  const isBackdropEvent = (event) => {
    if (event.target !== dialog) return false;
    const bounds = dialog.getBoundingClientRect();
    return event.clientX < bounds.left || event.clientX > bounds.right ||
      event.clientY < bounds.top || event.clientY > bounds.bottom;
  };
  dialog.addEventListener('pointerdown', (event) => {
    pressedInsideDialog = !isBackdropEvent(event);
  });
  dialog.addEventListener('click', (event) => {
    const shouldClose = !pressedInsideDialog && isBackdropEvent(event);
    pressedInsideDialog = false;
    if (shouldClose) dialog.close();
  });
  dialog.addEventListener('keydown', (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    const horizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight';
    const step = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
    if (scale === 1 && horizontal && index >= 0) {
      event.preventDefault();
      changePicture(step);
    } else if (scale > 1) {
      event.preventDefault();
      if (horizontal) viewport.scrollLeft += step * 80;
      else viewport.scrollTop += step * 80;
    }
  });
  dialog.addEventListener('close', () => {
    document.documentElement.classList.remove('media-viewer-open');
    canvas.replaceChildren();
    picture = null;
    drag = null;
    pressedInsideDialog = false;
    if (objectURL) URL.revokeObjectURL(objectURL);
    objectURL = null;
    origin?.focus({ preventScroll: true });
  });
  window.addEventListener('resize', () => { if (dialog.open) resizePicture(scale); });

  // 仅在适应窗口时识别单指横滑；放大后保留原生触摸滚动、双指缩放。
  viewport.addEventListener('pointerdown', (event) => {
    if (event.isPrimary === false) { drag = null; return; }
    if (event.pointerType === 'touch') {
      if (scale === 1) drag = { type: 'touch', x: event.clientX, y: event.clientY };
      return;
    }
    if (event.pointerType !== 'mouse' || event.button !== 0 || scale === 1) return;
    drag = { type: 'mouse', x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
    viewport.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  viewport.addEventListener('pointermove', (event) => {
    if (drag?.type !== 'mouse') return;
    viewport.scrollLeft = drag.left + drag.x - event.clientX;
    viewport.scrollTop = drag.top + drag.y - event.clientY;
  });
  viewport.addEventListener('pointerup', (event) => {
    if (drag?.type === 'touch' && scale === 1) {
      const distance = event.clientX - drag.x;
      if (Math.abs(distance) >= 48 && Math.abs(distance) > Math.abs(event.clientY - drag.y) * 1.5) changePicture(distance < 0 ? 1 : -1);
    }
    drag = null;
  });
  viewport.addEventListener('pointercancel', () => { drag = null; });
  viewport.addEventListener('lostpointercapture', () => { drag = null; });
})();
