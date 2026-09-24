(() => {
  const toast = document.querySelector('.toast');
  let timer;

  function notify(message) {
    toast.textContent = message;
    toast.classList.add('is-visible');
    clearTimeout(timer);
    timer = setTimeout(() => toast.classList.remove('is-visible'), 1800);
  }

  document.querySelectorAll('[data-copy]').forEach((frame) => {
    frame.querySelector('.copy-button')?.addEventListener('click', async () => {
      const command = frame.querySelector('code')?.textContent.trim();
      if (!command) return;
      try {
        await navigator.clipboard.writeText(command);
        notify('命令已复制');
      } catch {
        notify('复制失败，请手动选择命令');
      }
    });
  });
})();
