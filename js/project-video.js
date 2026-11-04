(() => {
  'use strict';

  const video = document.querySelector('#project-demo');
  const toggle = document.querySelector('#project-demo-toggle');
  if (!video || !toggle || !('IntersectionObserver' in window)) return;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let visible = false;
  let visibleRatio = 0;
  let intent = 'auto';
  let blocked = false;
  let pendingPlay = false;
  let request = 0;

  video.muted = true;
  video.controls = false;
  toggle.hidden = false;

  // 主动播放代表用户同意观看；主动暂停则必须由用户再次点击才能恢复。
  function canPlay() {
    return visible && !document.hidden && intent !== 'pause' && !blocked &&
      (intent === 'play' || (!reducedMotion.matches && visibleRatio >= 0.25));
  }

  // 未完成的播放请求也能被按钮取消，文案始终描述下一次点击的动作。
  function updateButton() {
    const label = pendingPlay || !video.paused ? '暂停演示' : '播放演示';
    toggle.textContent = label;
    toggle.setAttribute('aria-label', label);
  }

  // 请求序号使较晚完成的 play Promise 不能推翻用户暂停或页面离屏状态。
  function pause() {
    request++;
    pendingPlay = false;
    video.pause();
    updateButton();
  }

  // 自动播放被浏览器拒绝后保留手动入口，不随滚动反复重试。
  async function play() {
    if (pendingPlay || !video.paused) return;
    const currentRequest = ++request;
    pendingPlay = true;
    updateButton();
    try {
      await video.play();
      if (currentRequest !== request) {
        if (!canPlay()) video.pause();
        return;
      }
      pendingPlay = false;
    } catch {
      if (currentRequest !== request) return;
      pendingPlay = false;
      blocked = true;
      video.pause();
    }
    updateButton();
  }

  // 暂停离屏和后台视频，回到可见区域时按保留的用户意图决定是否续播。
  function syncPlayback() {
    if (canPlay()) play();
    else pause();
  }

  toggle.addEventListener('click', () => {
    if (pendingPlay || !video.paused) {
      intent = 'pause';
      pause();
    } else {
      intent = 'play';
      blocked = false;
      syncPlayback();
    }
  });
  video.addEventListener('play', () => {
    if (!canPlay()) pause();
    else updateButton();
  });
  video.addEventListener('pause', updateButton);
  document.addEventListener('visibilitychange', syncPlayback);
  reducedMotion.addEventListener('change', syncPlayback);
  const observer = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    visibleRatio = entry.intersectionRatio;
    syncPlayback();
  }, { threshold: [0, 0.25] });
  observer.observe(video);
  updateButton();
})();
