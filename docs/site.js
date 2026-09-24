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

  const writers = [];
  if (!reducedMotion.matches) document.querySelectorAll('[data-typewriter]').forEach((element) => {
    // Keep the original sentence intact for assistive technology and preallocate its line boxes.
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
      Array.from(node.textContent).forEach((letter) => {
        const character = document.createElement('span');
        character.className = 'type-char';
        character.textContent = letter;
        characters.push(character);
        fragment.append(character);
      });
      node.replaceWith(fragment);
    });
    element.append(source, visual);
    let position = 0;
    let tick;
    function finish() {
      clearTimeout(tick);
      characters.forEach((character) => character.classList.add('is-typed'));
      characters.forEach((character) => character.classList.remove('is-cursor'));
    }
    function advance() {
      if (reducedMotion.matches || document.hidden || position >= characters.length) return finish();
      characters[position - 1]?.classList.remove('is-cursor');
      const character = characters[position++];
      character.classList.add('is-typed', 'is-cursor');
      const pause = /[。！？]/u.test(character.textContent) ? 180
        : /[，、]/u.test(character.textContent) ? 85
          : /[\x00-\x7F]/u.test(character.textContent) ? 17 : 34;
      tick = setTimeout(advance, pause);
    }
    writers.push(finish);
    tick = setTimeout(advance, 450);
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
      if (!poster.naturalWidth) return settleLogo();
      replay.hidden = false;
      playLogo();
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
    writers.forEach((finish) => finish());
    settleLogo();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      writers.forEach((finish) => finish());
      settleLogo();
    }
  });

  const agentTrack = document.querySelector('.agent-track');
  const agentGroup = agentTrack?.querySelector('.agent-group');
  if (agentTrack && agentGroup) {
    const agents = [...agentGroup.querySelectorAll('.agent-node')];
    if (!reducedMotion.matches) {
      const duplicate = agentGroup.cloneNode(true);
      duplicate.setAttribute('aria-hidden', 'true');
      agentTrack.append(duplicate);
      agentTrack.classList.add('is-ready');
      let featured = 0;
      const rotateAgents = () => {
        agents.forEach((node, index) => {
          const active = index === featured;
          node.classList.toggle('is-featured', active);
          duplicate.children[index]?.classList.toggle('is-featured', active);
        });
        featured = (featured + 1) % agents.length;
      };
      rotateAgents();
      setInterval(rotateAgents, 1900);
    }
  }

  const canvas = document.querySelector('#starfield');
  if (!canvas || reducedMotion.matches) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const pointer = { x: -1000, y: -1000, active: false };
  const interactionRadius = 145;
  const maximumOffset = 30;
  let particles = [];
  let width = 0;
  let height = 0;

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
    const density = Math.min(210, Math.max(82, Math.floor((width * height) / 8800)));
    particles = Array.from({ length: density }, (_, index) => {
      const x = random(0, width);
      const y = random(0, height);
      return { x, y, baseX: x, baseY: y, vx: 0, vy: 0, driftX: random(-.045, .045), driftY: random(-.045, .045), radius: random(.55, 1.5), alpha: random(.3, .86), influence: 0, slot: index };
    });
  }

  function draw(time) {
    ctx.clearRect(0, 0, width, height);
    const seconds = time * .001;
    particles.forEach((particle) => {
      particle.baseX += particle.driftX;
      particle.baseY += particle.driftY;
      if (particle.baseX < -20 || particle.baseX > width + 20) {
        particle.baseX = particle.baseX < -20 ? width + 20 : -20;
        particle.x = particle.baseX;
        particle.vx = 0;
      }
      if (particle.baseY < -20 || particle.baseY > height + 20) {
        particle.baseY = particle.baseY < -20 ? height + 20 : -20;
        particle.y = particle.baseY;
        particle.vy = 0;
      }

      // Influence is measured from the star's own resting position. Once the
      // pointer leaves this radius, attraction stops and the spring restores it.
      const dx = pointer.x - particle.baseX;
      const dy = pointer.y - particle.baseY;
      const distance = pointer.active ? Math.hypot(dx, dy) : Infinity;
      particle.influence = distance < interactionRadius
        ? Math.pow(1 - distance / interactionRadius, 2) : 0;
      const force = particle.influence * 1.05 / (distance || 1);
      particle.vx = (particle.vx + (particle.baseX - particle.x) * .028 + dx * force) * .86;
      particle.vy = (particle.vy + (particle.baseY - particle.y) * .028 + dy * force) * .86;
      particle.x += particle.vx;
      particle.y += particle.vy;
      const offsetX = particle.x - particle.baseX;
      const offsetY = particle.y - particle.baseY;
      const offset = Math.hypot(offsetX, offsetY);
      if (offset > maximumOffset) {
        particle.x = particle.baseX + offsetX / offset * maximumOffset;
        particle.y = particle.baseY + offsetY / offset * maximumOffset;
        particle.vx *= .5;
        particle.vy *= .5;
      }
    });

    for (let i = 0; i < particles.length; i += 1) {
      const particle = particles[i];
      const shimmer = .85 + Math.sin(seconds * .7 + particle.slot * 1.7) * .15;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.radius + particle.influence * .8, 0, Math.PI * 2);
      ctx.fillStyle = particle.influence > 0
        ? `rgba(185,255,216,${Math.min(.96, particle.alpha * shimmer + particle.influence * .45)})`
        : `rgba(185,205,255,${particle.alpha * shimmer})`;
      ctx.fill();
      for (let j = i + 1; j < particles.length; j += 1) {
        const other = particles[j];
        const dx = particle.x - other.x;
        const dy = particle.y - other.y;
        const distanceSquared = dx * dx + dy * dy;
        const localInfluence = Math.max(particle.influence, other.influence);
        const connectionRange = localInfluence > 0 ? 88 : 56;
        if (distanceSquared > connectionRange * connectionRange) continue;
        const distance = Math.sqrt(distanceSquared);
        ctx.beginPath();
        ctx.moveTo(particle.x, particle.y);
        ctx.lineTo(other.x, other.y);
        ctx.strokeStyle = localInfluence > 0
          ? `rgba(185,255,216,${(1 - distance / connectionRange) * (.1 + localInfluence * .38)})`
          : `rgba(158,180,235,${(1 - distance / connectionRange) * .08})`;
        ctx.lineWidth = localInfluence > 0 ? .9 : .6;
        ctx.stroke();
      }
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
