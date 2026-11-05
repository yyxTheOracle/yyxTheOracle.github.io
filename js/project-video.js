(() => {
  'use strict';

  const video = document.querySelector('#project-demo');
  if (!video || !('IntersectionObserver' in window)) return;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let visible = false;
  let blocked = false;
  let pendingPlay = false;
  let request = 0;

  video.muted = true;

  // 请求序号使较晚完成的播放请求不能推翻离屏、后台或减少动态效果状态。
  function pause() {
    request++;
    pendingPlay = false;
    video.pause();
  }

  // 自动播放被拒后保留原生控件，不随滚动反复重试。
  async function play() {
    if (pendingPlay || !video.paused) return;
    const currentRequest = ++request;
    pendingPlay = true;
    try {
      await video.play();
      if (currentRequest !== request) {
        if (!visible || document.hidden || reducedMotion.matches) video.pause();
        return;
      }
      pendingPlay = false;
    } catch {
      if (currentRequest !== request) return;
      pendingPlay = false;
      blocked = true;
      video.controls = true;
      video.pause();
    }
  }

  // 只在前台可见时自动播放；兜底状态交给原生控件，不干扰用户主动播放。
  function syncPlayback() {
    video.controls = reducedMotion.matches || blocked;
    if (!visible || document.hidden) pause();
    else if (!reducedMotion.matches && !blocked) play();
  }

  video.addEventListener('play', () => {
    if (!visible || document.hidden) pause();
  });
  document.addEventListener('visibilitychange', syncPlayback);
  reducedMotion.addEventListener('change', () => {
    if (reducedMotion.matches) pause();
    syncPlayback();
  });
  const observer = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    syncPlayback();
  });
  observer.observe(video);
  syncPlayback();
})();
