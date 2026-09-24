(() => {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const toast = document.querySelector('.toast');
  let toastTimer;

  function notify(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 1800);
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

  document.querySelectorAll('pre').forEach((block) => {
    block.tabIndex = 0;
    block.setAttribute('role', 'region');
    block.setAttribute('aria-label', '终端命令，可横向滚动');
  });

  const menu = document.querySelector('.mobile-nav');
  menu?.addEventListener('click', (event) => {
    if (event.target.closest('a')) menu.open = false;
  });
  document.addEventListener('click', (event) => {
    if (menu?.open && !menu.contains(event.target)) menu.open = false;
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && menu?.open) menu.open = false;
  });

  const agentNodes = [...document.querySelectorAll('.agent-node')];
  if (agentNodes.length && !reducedMotion.matches) {
    let featured = 0;
    const rotateAgents = () => {
      agentNodes.forEach((node) => node.classList.remove('is-featured'));
      agentNodes[featured % agentNodes.length]?.classList.add('is-featured');
      featured += 1;
    };
    rotateAgents();
    setInterval(rotateAgents, 1900);
  }

  const canvas = document.querySelector('#starfield');
  if (!canvas || reducedMotion.matches) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const pointer = { x: -1000, y: -1000, active: false };
  const shape = [
    [0, -62], [46, -28], [46, 28], [0, 62], [-46, 28], [-46, -28],
    [0, -28], [24, 0], [0, 28], [-24, 0]
  ];
  let particles = [];
  let width = 0;
  let height = 0;
  let density = 0;

  function random(min, max) {
    return Math.random() * (max - min) + min;
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    density = Math.min(210, Math.max(82, Math.floor((width * height) / 8800)));
    particles = Array.from({ length: density }, (_, index) => {
      const x = random(0, width);
      const y = random(0, height);
      return { x, y, baseX: x, baseY: y, vx: random(-.08, .08), vy: random(-.08, .08), radius: random(.45, 1.45), alpha: random(.26, .82), slot: index };
    });
  }

  function draw(time) {
    ctx.clearRect(0, 0, width, height);
    const seconds = time * .001;
    particles.forEach((particle) => {
      particle.baseX += particle.vx;
      particle.baseY += particle.vy;
      if (particle.baseX < -20) particle.baseX = width + 20;
      if (particle.baseX > width + 20) particle.baseX = -20;
      if (particle.baseY < -20) particle.baseY = height + 20;
      if (particle.baseY > height + 20) particle.baseY = -20;

      let targetX = particle.baseX + Math.sin(seconds * .17 + particle.slot) * 1.8;
      let targetY = particle.baseY + Math.cos(seconds * .13 + particle.slot) * 1.8;
      const distance = Math.hypot(particle.x - pointer.x, particle.y - pointer.y);
      if (pointer.active && distance < 245) {
        const slot = shape[particle.slot % shape.length];
        const pulse = Math.sin(seconds * 1.5 + particle.slot) * 5;
        targetX = pointer.x + slot[0] + pulse;
        targetY = pointer.y + slot[1] + pulse * .4;
      }
      particle.x += (targetX - particle.x) * .035;
      particle.y += (targetY - particle.y) * .035;
    });

    for (let i = 0; i < particles.length; i += 1) {
      const particle = particles[i];
      const activeDistance = Math.hypot(particle.x - pointer.x, particle.y - pointer.y);
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.radius + (activeDistance < 245 ? .5 : 0), 0, Math.PI * 2);
      ctx.fillStyle = activeDistance < 245 ? `rgba(185,255,216,${Math.min(.96, particle.alpha + .28)})` : `rgba(185,205,255,${particle.alpha})`;
      ctx.fill();
      for (let j = i + 1; j < particles.length; j += 1) {
        const other = particles[j];
        const dx = particle.x - other.x;
        const dy = particle.y - other.y;
        const distance = Math.hypot(dx, dy);
        if (distance > 86) continue;
        const nearPointer = pointer.active && (Math.hypot(particle.x - pointer.x, particle.y - pointer.y) < 250 || Math.hypot(other.x - pointer.x, other.y - pointer.y) < 250);
        if (!nearPointer && distance > 57) continue;
        ctx.beginPath();
        ctx.moveTo(particle.x, particle.y);
        ctx.lineTo(other.x, other.y);
        ctx.strokeStyle = nearPointer ? `rgba(185,255,216,${(1 - distance / 86) * .34})` : `rgba(158,180,235,${(1 - distance / 86) * .08})`;
        ctx.lineWidth = nearPointer ? 1 : .6;
        ctx.stroke();
      }
    }

    if (pointer.active) {
      ctx.beginPath();
      ctx.arc(pointer.x, pointer.y, 9 + Math.sin(seconds * 2) * 2, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(185,255,216,.42)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    requestAnimationFrame(draw);
  }

  window.addEventListener('resize', resize, { passive: true });
  window.addEventListener('pointermove', (event) => {
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    pointer.active = true;
  }, { passive: true });
  window.addEventListener('pointerleave', () => { pointer.active = false; }, { passive: true });
  resize();
  requestAnimationFrame(draw);
})();
