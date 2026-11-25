(() => {
  'use strict';

  const article = document.querySelector('#article-content');
  const dialog = document.querySelector('#media-viewer');
  if (!article || !dialog || typeof dialog.showModal !== 'function') return;
  const viewport = dialog.querySelector('.media-viewer-viewport');
  const canvas = dialog.querySelector('.media-viewer-canvas');
  const frame = dialog.querySelector('.media-viewer-frame');
  const caption = dialog.querySelector('.media-viewer-caption');
  const statusToast = dialog.querySelector('.media-viewer-status');
  const previous = dialog.querySelector('[data-media-step="-1"]');
  const next = dialog.querySelector('[data-media-step="1"]');
  const counter = dialog.querySelector('.media-viewer-counter');
  const filmstrip = dialog.querySelector('.media-viewer-filmstrip');
  const closeButton = dialog.querySelector('[data-media-close]');
  // 先收集正文原图，再生成缩略图；缩略图不会重复进入整篇图库。
  const images = [...article.querySelectorAll('img')].filter(image => !image.closest('a, pre, code, .mermaid'));
  const reducedMotion = typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : { matches: false };

  let origin;
  let picture;
  let objectURL;
  let width;
  let height;
  let index = -1;
  let scale = 1;
  let mode = 'fit';
  let drag;
  let moved = false;
  let thumbButtons = [];
  let filmstripBuilt = false;
  let toastTimer;

  /** 图注说明图片与正文的关系；没有图注时沿用图片的替代文字。 */
  function description(image) {
    return image.closest('figure')?.querySelector('figcaption')?.textContent.trim() || image.dataset.caption || image.alt || '文章图片';
  }

  /** 仅增强显式图组，原始 figure 保留在 DOM 中作为无脚本回退和图库来源。 */
  article.querySelectorAll('.article-gallery').forEach((gallery) => {
    const figures = [...gallery.children].filter(child => child.matches('figure.article-image') && child.querySelector('img'));
    if (figures.length < 2) return;
    const sources = figures.map(figure => figure.querySelector('img'));
    let currentIndex = 0;
    const heading = document.createElement('div');
    heading.className = 'article-gallery-heading';
    const title = document.createElement('strong');
    title.textContent = gallery.getAttribute('aria-label') || '文章图组';
    const status = document.createElement('span');
    status.className = 'article-gallery-status';
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('aria-atomic', 'true');
    const openButton = document.createElement('button');
    openButton.type = 'button';
    openButton.className = 'article-gallery-open';
    openButton.setAttribute('aria-haspopup', 'dialog');
    openButton.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M7 3H3v4m10-4h4v4M3 13v4h4m10-4v4h-4"/></svg>放大阅读';
    openButton.addEventListener('click', () => openPicture(sources[currentIndex], openButton));
    heading.append(title, status, openButton);
    const hint = document.createElement('span');
    hint.className = 'article-gallery-hint';
    hint.textContent = '向下滚动读长图 ↓';
    hint.setAttribute('aria-hidden', 'true');
    // 箭头放在滚动区外，阅读长图时始终留在图片两侧。
    const stage = document.createElement('div');
    stage.className = 'article-gallery-stage';
    const previousStep = createStepButton(-1, previous);
    const nextStep = createStepButton(1, next);
    stage.append(...figures, previousStep, nextStep);
    const thumbnails = document.createElement('div');
    thumbnails.className = 'article-gallery-thumbnails';
    thumbnails.setAttribute('role', 'group');
    thumbnails.setAttribute('aria-label', '选择图组图片');
    const buttons = figures.map((figure, position) => {
      const source = sources[position];
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
        thumbnail.sizes = '57px';
      }
      thumbnail.alt = '';
      thumbnail.loading = 'lazy';
      thumbnail.decoding = 'async';
      const label = document.createElement('span');
      label.textContent = description(source);
      if (!/^图\s*\d/.test(label.textContent)) label.textContent = `图 ${position + 1}：${label.textContent}`;
      // 图注可以只写图号；辅助技术仍可通过替代文字了解图片的具体内容。
      if (/^图\s*\d+$/.test(label.textContent) && source.alt) {
        button.setAttribute('aria-description', source.alt);
        source.setAttribute('aria-description', source.alt);
      }
      button.append(thumbnail, label);
      button.addEventListener('click', () => {
        if (position !== currentIndex) selectImage(position);
        button.focus({ preventScroll: true });
      });
      reader.addEventListener('scroll', updateHint, { passive: true });
      source.addEventListener('load', updateHint);
      return button;
    });
    thumbnails.append(...buttons);
    gallery.prepend(heading);
    gallery.append(stage, thumbnails);
    gallery.classList.add('is-enhanced');

    /** 复用大图查看器的图标，点击只切换当前图组。 */
    function createStepButton(step, viewerButton) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'article-gallery-step ' + (step < 0 ? 'prev' : 'next');
      button.setAttribute('aria-label', step < 0 ? '上一张' : '下一张');
      button.append(viewerButton.querySelector('svg').cloneNode(true));
      button.addEventListener('click', () => {
        const hadFocus = document.activeElement === button;
        selectImage(currentIndex + step);
        // 到达首尾时，把焦点留给仍可操作的方向，方便键盘用户原路返回。
        if (hadFocus && button.disabled) {
          (step < 0 ? nextStep : previousStep).focus({ preventScroll: true });
        }
      });
      return button;
    }

    /** 只重置新图的阅读区；保留图组高度和选图焦点，避免整篇文章跳动。 */
    function selectImage(position) {
      currentIndex = position;
      figures.forEach((item, index) => { item.hidden = index !== position; });
      buttons.forEach((button, index) => button.setAttribute('aria-pressed', String(index === position)));
      const figure = figures[position];
      figure.append(hint);
      figure.querySelector('.article-gallery-scroll').scrollTop = 0;
      status.textContent = `${position + 1} / ${figures.length}`;
      previousStep.disabled = position === 0;
      nextStep.disabled = position === figures.length - 1;
      // 带链接的图片保留作者指定的目标，组内查看按钮只作用于可放大的图片。
      openButton.hidden = !images.includes(sources[position]);
      updateHint();
    }

    /** 提示只出现在明显超出阅读区的长图顶部；滚动、切图和尺寸变化时重算。 */
    function updateHint() {
      const reader = figures[currentIndex].querySelector('.article-gallery-scroll');
      hint.hidden = !reader.clientHeight || reader.scrollTop > 20 || reader.scrollHeight < reader.clientHeight * 1.35;
    }

    selectImage(0);
    if (window.ResizeObserver) new ResizeObserver(updateHint).observe(gallery);
  });

  const zoomControls = dialog.querySelector('.media-viewer-zoom');
  const fitWidthButton = zoomControls.querySelector('[data-zoom="width"]');
  const actualSizeButton = zoomControls.querySelector('[data-zoom="actual"]');

  function showToast(text) {
    if (!statusToast || !text) return;
    statusToast.textContent = text;
    statusToast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => statusToast.classList.remove('is-visible'), 1600);
  }

  function clearToast() {
    clearTimeout(toastTimer);
    if (statusToast) {
      statusToast.classList.remove('is-visible');
      statusToast.textContent = '';
    }
  }

  function buildFilmstrip() {
    if (filmstripBuilt || images.length < 2) return;
    filmstripBuilt = true;
    thumbButtons = images.map((item, position) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'media-viewer-thumb';
      button.setAttribute('aria-label', `切换到第 ${position + 1} 张：${description(item)}`);
      const thumb = document.createElement('img');
      thumb.src = item.currentSrc || item.src;
      if (item.srcset) {
        thumb.srcset = item.srcset;
        thumb.sizes = '64px';
      }
      thumb.alt = '';
      thumb.loading = 'lazy';
      thumb.decoding = 'async';
      button.append(thumb);
      button.addEventListener('click', () => showPicture(item));
      return button;
    });
    filmstrip.replaceChildren(...thumbButtons);
  }

  function canvasMetrics() {
    const cs = getComputedStyle(canvas);
    const padX = (parseFloat(cs.paddingLeft) || 16) + (parseFloat(cs.paddingRight) || 16);
    const padY = (parseFloat(cs.paddingTop) || 16) + (parseFloat(cs.paddingBottom) || 16);
    const isDiagram = frame.classList.contains('is-diagram');
    const plateX = isDiagram ? 72 : 0;
    const plateY = isDiagram ? 56 : 0;
    const rawAvailW = Math.max(1, viewport.clientWidth - padX);
    const availW = Math.min(1120, rawAvailW);
    const availH = Math.max(1, viewport.clientHeight - padY);
    const fit = width && height
      ? Math.min(1, Math.max(1, availW - plateX) / width, Math.max(1, availH - plateY) / height)
      : 1;
    const maximum = Math.max(4, 1 / fit);
    const widthScale = width
      ? Math.min(1, Math.max(1, availW - plateX) / width) / fit
      : 1;
    return { rawAvailW, availW, availH, plateX, plateY, fit, maximum, widthScale };
  }

  /** 按居中舞台适配后缩放，保留观察中心；超长原图自动适宽顶对齐。 */
  function resizePicture(nextScale, fromTop = false, focusPoint = null) {
    if (!picture || !width || !height) return;
    const centerX = (viewport.scrollLeft + viewport.clientWidth / 2) / (viewport.scrollWidth || 1);
    const centerY = (viewport.scrollTop + viewport.clientHeight / 2) / (viewport.scrollHeight || 1);
    const { rawAvailW, availH, plateX, plateY, fit, maximum, widthScale } = canvasMetrics();
    // 旋转屏幕或载入新尺寸的原图后，两档仍分别对应阅读区宽度和真实像素。
    if (mode === 'width') nextScale = widthScale;
    if (mode === 'actual') nextScale = 1 / fit;
    scale = Math.max(1, Math.min(maximum, nextScale));
    const drawW = Math.max(1, width * fit * scale);
    const drawH = Math.max(1, height * fit * scale);
    picture.style.width = `${drawW}px`;
    picture.style.height = `${drawH}px`;
    if (!zoomControls.hidden) {
      fitWidthButton.setAttribute('aria-pressed', String(Math.abs(scale / widthScale - 1) < 0.001));
      actualSizeButton.setAttribute('aria-pressed', String(Math.abs(fit * scale - 1) < 0.001));
    }
    const isOverflowX = drawW + plateX > rawAvailW + 2;
    const isOverflowY = drawH + plateY > availH + 2;
    viewport.dataset.fitted = String(mode === 'fit' && scale <= 1.001);
    viewport.dataset.overflowX = String(isOverflowX);
    viewport.dataset.pannable = String(isOverflowX || isOverflowY);
    viewport.dataset.alignTop = String(mode === 'width' || isOverflowY);
    if (fromTop) {
      viewport.scrollLeft = 0;
      viewport.scrollTop = 0;
    } else if (focusPoint) {
      viewport.scrollLeft = Math.max(0, focusPoint.rx * viewport.scrollWidth - focusPoint.cx);
      viewport.scrollTop = Math.max(0, focusPoint.ry * viewport.scrollHeight - focusPoint.cy);
    } else {
      viewport.scrollLeft = Math.max(0, centerX * viewport.scrollWidth - viewport.clientWidth / 2);
      viewport.scrollTop = Math.max(0, centerY * viewport.scrollHeight - viewport.clientHeight / 2);
    }
  }

  function isTallImage() {
    return Boolean(width && height && height / width >= 2.5);
  }

  /** 按钮缩放时，视口中央的表格行和列应尽可能停在原位。 */
  function selectZoomMode(selectedMode) {
    if (zoomControls.hidden || !picture || !width || !height) return;
    const before = picture.getBoundingClientRect();
    const view = viewport.getBoundingClientRect();
    const centerX = view.left + viewport.clientWidth / 2;
    const centerY = view.top + viewport.clientHeight / 2;
    // 即时应用目标尺寸，让下面测得的是缩放后的坐标，而非动画的中间帧。
    picture.style.transition = 'none';
    mode = selectedMode;
    resizePicture(scale);
    const after = picture.getBoundingClientRect();
    if (before.width && before.height) {
      const relativeX = Math.max(0, Math.min(1, (centerX - before.left) / before.width));
      const relativeY = Math.max(0, Math.min(1, (centerY - before.top) / before.height));
      viewport.scrollLeft += after.left + relativeX * after.width - centerX;
      viewport.scrollTop += after.top + relativeY * after.height - centerY;
    }
    picture.style.removeProperty('transition');
  }

  function toggleZoom(clientX, clientY) {
    if (!picture || !width || !height) return;
    const isTall = isTallImage();
    if (mode === 'fit') {
      const { fit, maximum } = canvasMetrics();
      mode = isTall ? 'width' : 'zoom';
      const targetScale = isTall ? 1 : Math.min(maximum, Math.max(1.5, 1 / fit));
      let focusPoint = null;
      if (!isTall && clientX != null && clientY != null) {
        const rect = viewport.getBoundingClientRect();
        focusPoint = {
          rx: (viewport.scrollLeft + (clientX - rect.left)) / (viewport.scrollWidth || 1),
          ry: (viewport.scrollTop + (clientY - rect.top)) / (viewport.scrollHeight || 1),
          cx: clientX - rect.left,
          cy: clientY - rect.top
        };
      }
      resizePicture(targetScale, isTall, focusPoint);
      showToast(isTall ? '按宽度阅读' : `放大 ${Math.round(fit * scale * 100)}%`);
    } else {
      mode = 'fit';
      scale = 1;
      resizePicture(1, true);
      showToast('已适应窗口');
    }
  }

  /** 渲染当前图片，切换时丢弃旧加载回调并重置缩放，不移动正文。 */
  function showPicture(target) {
    const svg = target.matches('.mermaid') ? target.querySelector('svg') : null;
    if (target.matches('.mermaid') && !svg) return false;
    if (objectURL) URL.revokeObjectURL(objectURL);
    objectURL = null;
    clearToast();
    index = images.indexOf(target);
    const groupedImage = !svg && target.closest('.article-gallery');
    if (!groupedImage && zoomControls.contains(document.activeElement)) viewport.focus({ preventScroll: true });
    zoomControls.hidden = !groupedImage;
    frame.classList.toggle('is-diagram', Boolean(svg));
    picture = document.createElement('img');
    picture.draggable = false;
    picture.decoding = 'async';
    picture.alt = svg ? '文章图表' : target.alt || '文章图片';
    let upgradeSrc;
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
      const previewSrc = target.currentSrc || target.src;
      const originalSrc = target.dataset.originalSrc;
      // 动画的正文资源就是原始字节副本，无需再请求外部图床。
      if (target.dataset.mediaAnimated === 'true') {
        picture.src = target.src;
      } else if (target.complete && target.naturalWidth && originalSrc && originalSrc !== previewSrc &&
        (previewSrc !== target.src || originalSrc !== target.getAttribute('src'))) {
        picture.src = previewSrc;
        upgradeSrc = originalSrc;
      } else {
        picture.src = originalSrc || previewSrc;
      }
    }
    const current = picture;
    picture.addEventListener('load', () => {
      // 适配图的像素尺寸小于原图，沿用原尺寸才能在替换前后保持缩放。
      if (upgradeSrc || picture !== current || !dialog.open) return;
      width = current.naturalWidth || width;
      height = current.naturalHeight || height;
      if (mode === 'fit' && scale === 1 && isTallImage()) {
        mode = 'width';
        resizePicture(1, true);
        showToast('长图已按宽度对齐顶部');
      } else {
        resizePicture(scale, mode === 'width' && viewport.scrollTop === 0);
      }
    });
    picture.addEventListener('error', () => {
      if (picture === current && dialog.open) caption.textContent = '图片暂时无法加载，可以切换其他图片或关闭后重试。';
    });
    frame.replaceChildren(picture);
    const captionText = svg ? picture.alt : description(target);
    caption.textContent = captionText;

    const hasGallery = index >= 0 && images.length >= 2;
    if (hasGallery) buildFilmstrip();
    counter.hidden = !hasGallery;
    counter.textContent = hasGallery
      ? `${String(index + 1).padStart(2, '0')} / ${String(images.length).padStart(2, '0')}`
      : '';
    previous.hidden = !hasGallery;
    next.hidden = !hasGallery;
    previous.disabled = index <= 0;
    next.disabled = index < 0 || index === images.length - 1;
    filmstrip.hidden = !hasGallery;
    thumbButtons.forEach((btn, pos) => {
      const active = pos === index;
      btn.setAttribute('aria-current', String(active));
      if (active) btn.scrollIntoView?.({ behavior: reducedMotion.matches ? 'instant' : 'smooth', block: 'nearest', inline: 'center' });
    });

    const isTall = isTallImage();
    mode = isTall ? 'width' : 'fit';
    scale = 1;
    drag = null;
    resizePicture(1, true);
    if (isTall) showToast('长图已按宽度对齐顶部');

    if (upgradeSrc) {
      const original = document.createElement('img');
      original.draggable = false;
      original.alt = current.alt;
      original.src = upgradeSrc;
      // 原图解码前保留适配图。原图失败时也继续显示适配图。
      original.decode().then(() => {
        if (picture !== current || !dialog.open) return;
        original.style.width = current.style.width;
        original.style.height = current.style.height;
        const previewRatio = width / height;
        width = original.naturalWidth || width;
        height = original.naturalHeight || height;
        picture = original;
        frame.replaceChildren(original);
        // 比例改变要重新排版；100% 还需按解码后的真实尺寸校准。
        if (width / height !== previewRatio || mode === 'actual') resizePicture(scale);
        if (caption.textContent !== captionText) caption.textContent = captionText;
      }, () => {});
    }
    return true;
  }

  /** 每次打开只记住最初触发点，跨图浏览后关闭仍回到原阅读位置。 */
  function openPicture(target, trigger = target) {
    if (!showPicture(target)) return;
    origin = trigger;
    document.documentElement.classList.add('media-viewer-open');
    dialog.showModal();
    viewport.focus({ preventScroll: true });
    resizePicture(1, mode === 'width');
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
  closeButton.addEventListener('click', () => dialog.close());
  fitWidthButton.addEventListener('click', () => selectZoomMode('width'));
  actualSizeButton.addEventListener('click', () => selectZoomMode('actual'));

  frame.addEventListener('dblclick', (event) => {
    event.preventDefault();
    toggleZoom(event.clientX, event.clientY);
  });

  viewport.addEventListener('wheel', (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    if (!picture || !width || !height) return;
    const { maximum } = canvasMetrics();
    const factor = event.deltaY < 0 ? 1.15 : 0.87;
    const nextScale = Math.max(1, Math.min(maximum, scale * factor));
    if (nextScale <= 1.02) {
      mode = 'fit';
      scale = 1;
      resizePicture(1, true);
    } else {
      mode = 'zoom';
      resizePicture(nextScale);
    }
  }, { passive: false });

  dialog.addEventListener('keydown', (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'z' || event.key === 'Z') {
      event.preventDefault();
      toggleZoom();
      return;
    }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    const horizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight';
    const step = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
    const overflowX = viewport.dataset.overflowX === 'true';
    if (!overflowX && horizontal && index >= 0) {
      event.preventDefault();
      changePicture(step);
    } else if (viewport.dataset.pannable === 'true') {
      event.preventDefault();
      if (horizontal) viewport.scrollLeft += step * 80;
      else viewport.scrollTop += step * 80;
    }
  });

  dialog.addEventListener('close', () => {
    document.documentElement.classList.remove('media-viewer-open');
    zoomControls.hidden = true;
    clearToast();
    frame.replaceChildren();
    frame.classList.remove('is-diagram');
    picture = null;
    drag = null;
    moved = false;
    if (objectURL) URL.revokeObjectURL(objectURL);
    objectURL = null;
    origin?.focus({ preventScroll: true });
  });

  window.addEventListener('resize', () => { if (dialog.open) resizePicture(scale); });

  // 仅在无横向溢出时识别单指横滑；放大后保留原生触摸滚动、双指缩放。
  viewport.addEventListener('pointerdown', (event) => {
    moved = false;
    if (event.isPrimary === false) { drag = null; return; }
    if (event.pointerType === 'touch') {
      if (viewport.dataset.overflowX !== 'true') drag = { type: 'touch', x: event.clientX, y: event.clientY };
      return;
    }
    if (event.pointerType !== 'mouse' || event.button !== 0 || viewport.dataset.pannable !== 'true') return;
    drag = { type: 'mouse', x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
    viewport.dataset.dragging = 'true';
    viewport.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  });
  viewport.addEventListener('pointermove', (event) => {
    if (!drag) return;
    if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 5) moved = true;
    if (drag.type !== 'mouse') return;
    viewport.scrollLeft = drag.left + drag.x - event.clientX;
    viewport.scrollTop = drag.top + drag.y - event.clientY;
  });
  viewport.addEventListener('pointerup', (event) => {
    if (drag?.type === 'touch' && viewport.dataset.overflowX !== 'true') {
      const distance = event.clientX - drag.x;
      if (Math.abs(distance) >= 48 && Math.abs(distance) > Math.abs(event.clientY - drag.y) * 1.5) changePicture(distance < 0 ? 1 : -1);
    }
    drag = null;
    delete viewport.dataset.dragging;
  });
  viewport.addEventListener('pointercancel', () => {
    drag = null;
    delete viewport.dataset.dragging;
  });
  viewport.addEventListener('lostpointercapture', () => {
    drag = null;
    delete viewport.dataset.dragging;
  });
  // 点击图片外画布留白处关闭（排除拖拽松手）。
  viewport.addEventListener('click', (event) => {
    if (moved) {
      moved = false;
      return;
    }
    if (!event.target.closest('.media-viewer-frame')) dialog.close();
  });
})();
