(() => {
  'use strict';

  const figure = document.querySelector('[data-avatar-dive]');
  if (!figure) return;
  const trigger = figure.querySelector('[data-avatar-dive-trigger]');
  const photo = figure.querySelector('[data-avatar-photo]');
  const seabed = figure.querySelector('[data-avatar-seabed]');
  if (!trigger || !photo || !seabed || !figure.dataset.diverSrc) return;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const header = document.querySelector('.site-header');
  const diver = document.createElement('div');
  diver.className = 'avatar-dive-float';
  diver.hidden = true;
  diver.setAttribute('aria-hidden', 'true');
  const cutout = new Image();
  cutout.src = figure.dataset.diverSrc;
  cutout.alt = '';
  cutout.draggable = false;
  diver.append(cutout);
  const bubbleLayer = document.createElement('div');
  bubbleLayer.className = 'avatar-dive-bubbles';
  bubbleLayer.setAttribute('aria-hidden', 'true');
  const bubbles = new Map();
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  let ready = false;
  let active = false;
  let pointer = null;
  let frame = 0;
  let feedback = null;
  let suppressClick = false;
  let lastBubble = -Infinity;
  let x = 0;
  let y = 0;
  let speed = 0;

  // 同一标签页返回首页或刷新也不重复引导；存储受限时仍可正常拖动。
  try {
    if (sessionStorage.getItem('avatar-dive-hint-dismissed') === '1') figure.classList.add('has-dived');
  } catch (_) {}

  // 固定人物使用视口坐标；原照的位置每次现算，读者滚页后仍能找回相框。
  function home() {
    const rect = photo.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  function paint() {
    diver.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%) rotate(3deg)`;
  }

  function stopFrame() {
    cancelAnimationFrame(frame);
    frame = 0;
  }

  // 气泡不复用常驻循环，动画自己结束并移除；快速拖动也最多保留 32 个。
  function emitBubble(size, offset = 0) {
    if (bubbles.size >= 32) return;
    const bubble = document.createElement('i');
    bubble.className = 'avatar-dive-bubble';
    bubble.style.cssText = `left:${x - photo.offsetWidth * 0.12 + offset}px;top:${y - photo.offsetHeight * 0.04 + offset}px;width:${size}px;height:${size}px`;
    bubbleLayer.append(bubble);
    const drift = (Math.random() - 0.5) * 56;
    const animation = bubble.animate([
      { transform: 'translate(-50%, -50%) scale(.65)', opacity: 0 },
      { opacity: 0.8, offset: 0.12 },
      { transform: `translate(calc(-50% + ${drift}px), calc(-50% - 140px)) scale(1.18)`, opacity: 0 },
    ], { duration: 1100 + size * 55, easing: 'cubic-bezier(.2,.55,.4,1)' });
    bubbles.set(bubble, animation);
    animation.onfinish = () => {
      bubbles.delete(bubble);
      bubble.remove();
    };
  }

  // 引导与气泡共用出框距离，轻微手抖不算完成拖动。
  function hasLeftFrame() {
    const origin = home();
    const threshold = Math.min(55, Math.max(24, photo.offsetWidth * 0.23));
    return Math.hypot(x - origin.x, y - origin.y) > threshold;
  }

  function trail(now) {
    if (reducedMotion.matches || !hasLeftFrame()) return;
    if (now - lastBubble < clamp(180 - speed * 11, 48, 180)) return;
    lastBubble = now;
    emitBubble(5 + Math.random() * 7);
    if (speed > 6) emitBubble(4 + Math.random() * 4, 8);
  }

  // 静止时由原照片接管画面，清理所有帧和动画，不改变读者当前的滚动位置。
  function rest() {
    stopFrame();
    if (feedback) {
      feedback.onfinish = null;
      feedback.cancel();
      feedback = null;
    }
    active = false;
    diver.hidden = true;
    figure.classList.remove('is-diving');
    for (const [bubble, animation] of bubbles) {
      animation.onfinish = null;
      animation.cancel();
      bubble.remove();
    }
    bubbles.clear();
    lastBubble = -Infinity;
  }

  function reset() {
    if (pointer) {
      const id = pointer.id;
      pointer = null;
      if (trigger.hasPointerCapture(id)) trigger.releasePointerCapture(id);
      suppressClick = true;
    }
    rest();
  }

  function begin() {
    if (!ready) return false;
    reset();
    const origin = home();
    x = origin.x;
    y = origin.y;
    speed = 0;
    active = true;
    diver.style.width = `${photo.offsetWidth}px`;
    diver.style.height = `${photo.offsetHeight}px`;
    diver.style.padding = getComputedStyle(photo).borderLeftWidth;
    diver.hidden = false;
    figure.classList.add('is-diving');
    paint();
    return true;
  }

  // 只有实际拖动后才沿屏幕边缘滚页，按住照片不动不会带着页面走。
  function dragFrame(now) {
    if (!pointer) return;
    const step = Math.min((now - pointer.frameTime) / (1000 / 60), 2);
    pointer.frameTime = now;
    if (pointer.moved) {
      const ceiling = Math.max(0, header?.getBoundingClientRect().bottom || 0) + 36;
      const floor = window.innerHeight - 48;
      const scrollStep = pointer.clientY < ceiling ? -clamp((ceiling - pointer.clientY) / 5, 0, 10)
        : pointer.clientY > floor ? clamp((pointer.clientY - floor) / 5, 0, 10) : 0;
      if (scrollStep) window.scrollBy({ top: scrollStep * step, behavior: 'instant' });
      speed *= 0.86 ** step;
      trail(now);
    }
    frame = requestAnimationFrame(dragFrame);
  }

  // 返航不恢复拖动前的 scrollY；每一帧追踪相框，返航期间继续滚页也不会落错位置。
  function returnHome() {
    stopFrame();
    if (reducedMotion.matches) { rest(); return; }
    const from = { x, y };
    const started = performance.now();
    function swim(now) {
      const progress = clamp((now - started) / 680, 0, 1);
      const eased = 1 - (1 - progress) ** 3;
      const origin = home();
      x = from.x + (origin.x - from.x) * eased;
      y = from.y + (origin.y - from.y) * eased - Math.sin(progress * Math.PI) * 32;
      paint();
      if (progress < 1) frame = requestAnimationFrame(swim);
      else rest();
    }
    frame = requestAnimationFrame(swim);
  }

  // 点击和键盘共用一次短示范；减少动态效果时只给透明度反馈，不自动飞行。
  function demo() {
    if (!begin()) return;
    if (reducedMotion.matches) {
      feedback = diver.animate([{ opacity: 0.55 }, { opacity: 1 }], { duration: 180 });
      feedback.onfinish = rest;
      return;
    }
    const from = { x, y };
    const direction = from.x > window.innerWidth / 2 ? -1 : 1;
    const target = {
      x: clamp(from.x + direction * Math.min(180, window.innerWidth * 0.3), 24, window.innerWidth - 24),
      y: clamp(from.y + 48, 24, window.innerHeight - 48),
    };
    const started = performance.now();
    function travel(now) {
      const progress = clamp((now - started) / 560, 0, 1);
      const eased = progress * progress * (3 - 2 * progress);
      x = from.x + (target.x - from.x) * eased;
      y = from.y + (target.y - from.y) * eased;
      speed = 8;
      paint();
      trail(now);
      if (progress < 1) frame = requestAnimationFrame(travel);
      else returnHome();
    }
    frame = requestAnimationFrame(travel);
  }

  trigger.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.isPrimary === false || pointer || !begin()) return;
    suppressClick = false;
    const now = performance.now();
    pointer = {
      id: event.pointerId, offsetX: event.clientX - x, offsetY: event.clientY - y,
      startX: event.clientX, startY: event.clientY, clientY: event.clientY,
      moved: false, moveTime: now, frameTime: now,
    };
    trigger.setPointerCapture(event.pointerId);
    frame = requestAnimationFrame(dragFrame);
  });

  trigger.addEventListener('pointermove', event => {
    if (!pointer || pointer.id !== event.pointerId) return;
    const nextX = clamp(event.clientX - pointer.offsetX, 24, window.innerWidth - 24);
    const nextY = clamp(event.clientY - pointer.offsetY, 24, window.innerHeight - 24);
    const now = performance.now();
    speed = Math.min(Math.hypot(nextX - x, nextY - y) * 16.67 / Math.max(now - pointer.moveTime, 8), 35);
    pointer.moveTime = now;
    pointer.clientY = event.clientY;
    pointer.moved ||= Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY) > 5;
    x = nextX;
    y = nextY;
    paint();
    // 只认亲手拖出，点按示范不会提前收走提示；减少动态效果时同样适用。
    if (pointer.moved && !figure.classList.contains('has-dived') && hasLeftFrame()) {
      figure.classList.add('has-dived');
      try { sessionStorage.setItem('avatar-dive-hint-dismissed', '1'); } catch (_) {}
    }
  });

  function releasePointer(event, cancelled = false) {
    if (!pointer || pointer.id !== event.pointerId) return;
    const moved = pointer.moved;
    pointer = null;
    if (trigger.hasPointerCapture(event.pointerId)) trigger.releasePointerCapture(event.pointerId);
    suppressClick = moved || cancelled;
    if (moved && !cancelled) returnHome();
    else rest();
  }

  trigger.addEventListener('pointerup', event => releasePointer(event));
  trigger.addEventListener('pointercancel', event => releasePointer(event, true));
  trigger.addEventListener('lostpointercapture', event => releasePointer(event, true));
  trigger.addEventListener('click', event => {
    event.preventDefault();
    // 手势取消不一定产生 click；键盘 click 的 detail 为 0，不能被上次拖动误吞。
    if (suppressClick && event.detail !== 0) { suppressClick = false; return; }
    suppressClick = false;
    demo();
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && active) reset(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) reset(); });
  window.addEventListener('blur', reset);
  reducedMotion.addEventListener('change', reset);
  // 保留监听和已解码素材，浏览器从 BFcache 恢复后可以直接再次拖动。
  window.addEventListener('pagehide', reset);

  // 两层素材都可显示后才开放互动；下载或解码失败时保持原有静态照片。
  Promise.all([cutout.decode(), seabed.decode()]).then(() => {
    if (!cutout.naturalWidth || !seabed.naturalWidth) return;
    document.body.append(bubbleLayer, diver);
    ready = true;
    trigger.disabled = false;
    figure.classList.add('is-ready');
  }).catch(() => {});
})();
