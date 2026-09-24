(() => {
  const toast = document.querySelector('.toast');
  let timer;
  const showToast = () => {
    toast.classList.add('show');
    clearTimeout(timer);
    timer = setTimeout(() => toast.classList.remove('show'), 1500);
  };
  document.querySelectorAll('[data-copy]').forEach((block) => {
    const button = block.querySelector('.copy-button');
    if (!button) return;
    button.addEventListener('click', async () => {
      await navigator.clipboard.writeText(block.dataset.copy);
      showToast();
    });
  });
})();
