(() => {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const toast = document.querySelector('.toast');
  let timer;

  function notify(message) {
    if (!toast) return;
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

  // Keep overflowed terminal commands reachable with a keyboard, including at zoom.
  document.querySelectorAll('pre').forEach((block) => {
    block.tabIndex = 0;
    block.setAttribute('role', 'region');
    block.setAttribute('aria-label', '终端命令，可横向滚动');
  });

  const menu = document.querySelector('.mobile-menu');
  const menuToggle = menu?.querySelector('summary');
  menu?.addEventListener('click', (event) => {
    if (event.target.closest('a')) menu.open = false;
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && menu?.open) {
      menu.open = false;
      menuToggle.focus();
    }
  });
  document.addEventListener('click', (event) => {
    if (menu?.open && !menu.contains(event.target)) menu.open = false;
  });
  window.matchMedia('(min-width: 601px)').addEventListener('change', (event) => {
    if (event.matches && menu) menu.open = false;
  });

  const reveals = new Map();
  const observer = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      observer.unobserve(entry.target);
      reveals.get(entry.target)?.();
      reveals.delete(entry.target);
    });
  }, { threshold: .25 }) : null;

  function whenVisible(element, start) {
    if (!observer) return start();
    reveals.set(element, start);
    observer.observe(element);
  }

  const writers = [];
  if (!reducedMotion.matches) document.querySelectorAll('[data-typewriter]').forEach((element) => {
    // The original text remains available as one readable passage to assistive tech.
    // Visible glyphs occupy their final line boxes before typing starts: no layout shift.
    const source = document.createElement('span');
    source.className = 'sr-only';
    source.append(...element.childNodes);
    const visual = document.createElement('span');
    visual.className = 'type-visual';
    visual.setAttribute('aria-hidden', 'true');
    visual.append(...Array.from(source.childNodes, (node) => node.cloneNode(true)));

    const walker = document.createTreeWalker(visual, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    const characters = [];
    nodes.forEach((node) => {
      const fragment = document.createDocumentFragment();
      Array.from(node.textContent).forEach((text) => {
        const character = document.createElement('span');
        character.className = 'type-char';
        character.textContent = text;
        characters.push(character);
        fragment.append(character);
      });
      node.replaceWith(fragment);
    });
    element.append(source, visual);
    element.dataset.typing = 'pending';
    let cursor = 0;
    let tick;

    function finish() {
      clearTimeout(tick);
      characters.forEach((character) => {
        character.classList.add('is-typed');
        character.classList.remove('is-cursor');
      });
      element.dataset.typing = 'done';
    }

    function advance() {
      if (reducedMotion.matches || document.hidden || cursor >= characters.length) return finish();
      characters[cursor - 1]?.classList.remove('is-cursor');
      const character = characters[cursor++];
      character.classList.add('is-typed', 'is-cursor');
      const isStatement = element.dataset.typewriter === 'statement';
      const pause = /[。！？]/u.test(character.textContent) ? 180
        : /[，、]/u.test(character.textContent) ? 85
        : /[\x00-\x7F]/u.test(character.textContent) ? 17 : isStatement ? 55 : 34;
      tick = setTimeout(advance, pause);
    }

    writers.push({ element, finish });
    whenVisible(element, () => {
      if (element.dataset.typing === 'done') return;
      element.dataset.typing = 'running';
      tick = setTimeout(advance, element.dataset.typewriter === 'intro' ? 450 : 180);
    });
  });

  const logo = document.querySelector('[data-logo-intro]');
  const poster = logo?.querySelector('img');
  const replay = logo?.querySelector('.motion-replay');
  let logoTimer;
  let logoFrame;

  function settleLogo() {
    clearTimeout(logoTimer);
    cancelAnimationFrame(logoFrame);
    logo?.classList.remove('is-introducing', 'logo-pending');
  }

  function playLogo() {
    settleLogo();
    if (!logo || reducedMotion.matches || document.hidden) return;
    logo.classList.add('logo-pending');
    // A separate frame restarts the finite sequence when the replay control is used.
    logoFrame = requestAnimationFrame(() => {
      logoFrame = requestAnimationFrame(() => {
        logo.classList.remove('logo-pending');
        logo.classList.add('is-introducing');
        logoTimer = setTimeout(settleLogo, 2150);
      });
    });
  }

  if (logo && poster && !reducedMotion.matches) {
    logo.classList.add('logo-pending');
    const prepareLogo = () => {
      if (reducedMotion.matches || !poster.naturalWidth) return settleLogo();
      replay.hidden = false;
      whenVisible(logo, playLogo);
    };
    if (poster.complete) prepareLogo();
    else {
      poster.addEventListener('load', prepareLogo, { once: true });
      poster.addEventListener('error', settleLogo, { once: true });
    }
  }
  replay?.addEventListener('click', playLogo);

  reducedMotion.addEventListener('change', (event) => {
    if (replay) replay.hidden = event.matches || !poster?.naturalWidth;
    if (!event.matches) return;
    writers.forEach(({ finish }) => finish());
    settleLogo();
    observer?.disconnect();
    reveals.clear();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) return;
    writers.forEach(({ element, finish }) => {
      if (element.dataset.typing === 'running') finish();
    });
    if (logo?.classList.contains('is-introducing')) settleLogo();
  });
})();
