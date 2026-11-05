(() => {
  'use strict';

  // 首页和浏览页复用同一种阅读反馈，不预选文章，也不拦截原生链接。
  document.querySelectorAll('.cursor-list,.browse-list').forEach(list => {
    const rows = [...list.querySelectorAll('.cursor-row,[data-browse-row]')];
    let active;

    // 标题换行、字体加载或窗口缩放后，底色仍对齐实际行高。
    function align() {
      list.style.setProperty('--marker-opacity', active ? '1' : '0');
      if (!active) return;
      list.style.setProperty('--marker-y', active.offsetTop + 'px');
      list.style.setProperty('--marker-height', active.offsetHeight + 'px');
    }

    // 空值意味着离开目录，清掉所有高亮以免普通点击焦点留下 hover。
    function highlight(row) {
      active = row;
      rows.forEach(item => item.classList.toggle('is-active', item === row));
      align();
    }

    // 键盘焦点可保留提示；鼠标点击留下的普通 focus 不算悬停。
    function restore() {
      highlight(rows.find(row => row.matches(':hover')) || rows.find(row => row.matches(':focus-visible')));
    }

    rows.forEach(row => {
      row.addEventListener('pointerenter', event => { if (event.pointerType !== 'touch') highlight(row); });
      row.addEventListener('pointerleave', restore);
      row.addEventListener('focus', restore);
      row.addEventListener('blur', restore);
    });
    new ResizeObserver(align).observe(list);
    document.fonts.ready.then(align);
  });
})();
