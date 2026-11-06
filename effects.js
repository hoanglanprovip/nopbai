(() => {
  'use strict';

  const canvas = document.getElementById('silkCanvas');
  const glitterCanvas = document.getElementById('glitterCanvas');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const motionToggle = document.getElementById('motionToggle');
  const MOTION_KEY = 'nopbai_motion_v1';
  const MAX_TILT = 9;
  const WAKE_COUNT = 6;
  const SETTLE_MS = 2600;
  const wakes = new Float32Array(WAKE_COUNT * 3).fill(-100);
  const pointer = { x: 0, y: 0, strength: 0, targetX: 0, targetY: 0, targetStrength: 0 };
  let activeCard = null, cardBounds = null, cardX = .5, cardY = .5;
  let frame = 0, lastFrame = 0, lastDraw = 0, activeUntil = 0, time = 0;
  let wakeIndex = 0, lastWake = 0;
  let renderer = null;
  let particles = null;
  let preference = null;
  try { preference = localStorage.getItem(MOTION_KEY); } catch {}
  let mode = 'full';
  let tiltX = 0, tiltY = 0;
  const canMove = () => mode !== 'off' && !document.hidden;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function createRenderer() {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, powerPreference: 'low-power' });
    if (!gl) return null;
    const shaders = [];
    const program = gl.createProgram();
    function compile(type, source) {
      const shader = gl.createShader(type);
      shaders.push(shader);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
      gl.attachShader(program, shader);
    }
    try {
      compile(gl.VERTEX_SHADER, `#version 300 es
        void main() {
          vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
          gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
        }
      `);
      compile(gl.FRAGMENT_SHADER, `#version 300 es
        precision highp float;
        uniform vec2 u_resolution;
        uniform float u_time;
        uniform vec3 u_pointer;
        uniform vec3 u_wakes[${WAKE_COUNT}];
        out vec4 color;

        void main() {
          vec2 p = (gl_FragCoord.xy - .5 * u_resolution) / u_resolution.y;
          vec2 q = p;
          q.x += .16 * sin(p.y * 3.0 + u_time * .1) + .07 * sin(p.y * 7.0 - p.x * 2.0);
          float fold = sin(q.x * 9.5 + q.y * 3.0 + 1.5 * sin(q.y * 4.0) + u_time * .13);
          float height = .17 * fold + .08 * sin(q.x * 4.0 - q.y * 3.6 + .65 * sin(q.x * 2.1));
          height += .012 * sin(q.x * 27.0 + q.y * 9.0 + fold * 2.0);
          vec2 touch = p - u_pointer.xy;
          height -= .16 * u_pointer.z * exp(-dot(touch, touch) * 14.0);
          for (int i = 0; i < ${WAKE_COUNT}; i++) {
            float age = max(0.0, u_time - u_wakes[i].z);
            float radius = length(p - u_wakes[i].xy);
            float front = radius - age * .24;
            height += .018 * sin(front * 38.0) * exp(-front * front * 40.0) * exp(-age * 2.2);
          }

          // The continuous surface sits behind the independently displaced grains.
          vec3 normal = normalize(vec3(-dFdx(height) * u_resolution.y * .85, -dFdy(height) * u_resolution.y * .85, 1.0));
          vec3 light = normalize(vec3(-.6, .9, 1.2));
          vec3 halfLight = normalize(light + vec3(0.0, 0.0, 1.0));
          float reflection = max(0.0, dot(normal, halfLight));
          float diffuse = max(0.0, dot(normal, light));
          float silver = .025 + .035 * diffuse + .11 * pow(reflection, 9.0) + .22 * pow(reflection, 42.0);
          color = vec4(vec3(silver), 1.0);
        }
      `);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    } catch (error) {
      gl.deleteProgram(program);
      console.warn('Silk background unavailable:', error.message);
      return null;
    } finally {
      shaders.forEach(shader => gl.deleteShader(shader));
    }
    const resolutionUniform = gl.getUniformLocation(program, 'u_resolution');
    const timeUniform = gl.getUniformLocation(program, 'u_time');
    const pointerUniform = gl.getUniformLocation(program, 'u_pointer');
    const wakesUniform = gl.getUniformLocation(program, 'u_wakes[0]');
    gl.useProgram(program);
    return () => {
      // Bound fill cost on high-DPI displays; the glass does not need native resolution.
      const ratio = Math.min(devicePixelRatio || 1, 1.5, Math.sqrt(750000 / (innerWidth * innerHeight)));
      const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
      const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        gl.viewport(0, 0, width, height);
      }
      gl.uniform2f(resolutionUniform, width, height);
      gl.uniform1f(timeUniform, time);
      gl.uniform3f(pointerUniform, pointer.x, pointer.y, pointer.strength);
      gl.uniform3fv(wakesUniform, wakes);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
  }

  function createParticles() {
    const ctx = glitterCanvas.getContext('2d');
    if (!ctx) return null;
    let points = [], width = 0, height = 0, previousX = 0, previousY = 0;
    function resize() {
      width = glitterCanvas.clientWidth;
      height = glitterCanvas.clientHeight;
      const ratio = Math.min(devicePixelRatio || 1, 1.5);
      glitterCanvas.width = Math.round(width * ratio);
      glitterCanvas.height = Math.round(height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      let seed = 42;
      const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
      points = Array.from({ length: Math.min(4800, Math.max(1000, Math.floor(width * height / 240))) }, () => {
        const x = random() * width, y = random() * height;
        return { x, y, homeX: x, homeY: y, vx: 0, vy: 0, size: .55 + random() * .95, phase: random() * Math.PI * 2 };
      });
    }
    function draw(delta = 0) {
      ctx.clearRect(0, 0, width, height);
      const scale = Math.min(delta / (1000 / 60), 3);
      const px = pointer.x * innerHeight + innerWidth * .5;
      const py = innerHeight * .5 - pointer.y * innerHeight;
      const radius = mode === 'reduced' ? 85 : 170;
      const sx = px - previousX, sy = py - previousY;
      const segment = sx * sx + sy * sy;
      const damping = Math.pow(.86, scale);
      for (const point of points) {
        const homeX = point.homeX + Math.sin(time * .24 + point.phase) * 2;
        const homeY = point.homeY + Math.sin(time * .2 + point.homeX * .003) * 2;
        point.vx += (homeX - point.x) * .018 * scale;
        point.vy += (homeY - point.y) * .018 * scale;
        if (pointer.strength > .01) {
          // Repel along the swept path so a fast mouse cannot skip the grains between frames.
          const along = segment ? clamp(((point.x - previousX) * sx + (point.y - previousY) * sy) / segment, 0, 1) : 1;
          const dx = point.x - (previousX + sx * along), dy = point.y - (previousY + sy * along);
          const distance = Math.hypot(dx, dy);
          if (distance < radius) {
            const force = (1 - distance / radius) ** 2 * pointer.strength * (mode === 'reduced' ? 3 : 7);
            point.vx += (dx / Math.max(distance, 1) * force + clamp(sx, -25, 25) * .025 * force) * scale;
            point.vy += (dy / Math.max(distance, 1) * force + clamp(sy, -25, 25) * .025 * force) * scale;
          }
        }
        point.vx *= damping;
        point.vy *= damping;
        point.x += clamp(point.vx, -18, 18) * scale;
        point.y += clamp(point.vy, -18, 18) * scale;
        const fold = Math.sin(point.homeX / height * 9.5 + point.homeY / height * 3 + Math.sin(point.homeY / height * 4) * 1.5);
        const glint = .5 + .5 * Math.sin(point.phase + time * .65);
        ctx.globalAlpha = .12 + (.5 + .5 * fold) ** 4 * .4 + glint ** 8 * .34;
        ctx.fillStyle = '#eee';
        ctx.fillRect(point.x, point.y, point.size, point.size);
      }
      ctx.globalAlpha = 1;
      previousX = px;
      previousY = py;
    }
    resize();
    return { draw, resize };
  }

  function clearCard() {
    if (!activeCard) return;
    activeCard.classList.remove('is-tilting');
    for (const property of ['--tilt-x', '--tilt-y', '--shine-x', '--shine-y']) activeCard.style.removeProperty(property);
    activeCard = null;
    cardBounds = null;
    tiltX = tiltY = 0;
  }

  function tick(now) {
    frame = 0;
    if (!canMove()) return;
    const delta = Math.min(now - lastFrame, 50);
    lastFrame = now;
    time += delta / 1000 * (mode === 'reduced' ? .4 : 1);
    const ease = 1 - Math.exp(-delta / 90);
    pointer.x += (pointer.targetX - pointer.x) * ease;
    pointer.y += (pointer.targetY - pointer.y) * ease;
    pointer.strength += (pointer.targetStrength - pointer.strength) * ease;
    if (activeCard?.isConnected) {
      const limit = mode === 'reduced' ? 3 : MAX_TILT;
      tiltX += ((.5 - cardY) * limit * 2 - tiltX) * ease;
      tiltY += ((cardX - .5) * limit * 2 - tiltY) * ease;
      activeCard.style.setProperty('--tilt-x', tiltX.toFixed(2) + 'deg');
      activeCard.style.setProperty('--tilt-y', tiltY.toFixed(2) + 'deg');
      activeCard.style.setProperty('--shine-x', (cardX * 100).toFixed(1) + '%');
      activeCard.style.setProperty('--shine-y', (cardY * 100).toFixed(1) + '%');
    } else clearCard();
    if (now - lastDraw >= 1000 / 30) {
      renderer?.();
      particles?.draw(Math.min(now - lastDraw, 50));
      lastDraw = now;
    }
    if (mode === 'full' || now < activeUntil) frame = requestAnimationFrame(tick);
  }

  function wake() {
    if (!canMove()) return;
    activeUntil = performance.now() + SETTLE_MS;
    if (!frame) {
      lastFrame = performance.now();
      frame = requestAnimationFrame(tick);
    }
  }

  document.addEventListener('pointermove', event => {
    if (!canMove() || document.body.classList.contains('modal-open')) return;
    pointer.targetX = (event.clientX - innerWidth * .5) / innerHeight;
    pointer.targetY = (.5 * innerHeight - event.clientY) / innerHeight;
    pointer.targetStrength = 1;
    const now = performance.now();
    if (now - lastWake > 90) {
      wakes.set([pointer.targetX, pointer.targetY, time], wakeIndex * 3);
      wakeIndex = (wakeIndex + 1) % WAKE_COUNT;
      lastWake = now;
    }
    const card = event.pointerType === 'touch' ? null : event.target.closest('.widget');
    if (card !== activeCard) {
      clearCard();
      if (card) {
        cardBounds = card.getBoundingClientRect();
        activeCard = card;
        card.classList.add('is-tilting');
      }
    }
    if (cardBounds) {
      cardX = clamp((event.clientX - cardBounds.left) / cardBounds.width, 0, 1);
      cardY = clamp((event.clientY - cardBounds.top) / cardBounds.height, 0, 1);
    }
    wake();
  }, { passive: true });

  function relax() {
    clearCard();
    pointer.targetStrength = 0;
    wake();
  }

  function refresh(resize = false) {
    cancelAnimationFrame(frame);
    frame = 0;
    clearCard();
    pointer.strength = pointer.targetStrength = 0;
    wakes.fill(-100);
    if (resize) particles?.resize();
    if (!document.hidden) { renderer?.(); particles?.draw(); }
    if (mode === 'full') wake();
  }

  function updateMotion() {
    mode = ['full', 'off'].includes(preference) ? preference : reducedMotion.matches ? 'reduced' : 'full';
    document.documentElement.dataset.motion = mode;
    motionToggle.setAttribute('aria-pressed', mode === 'reduced' ? 'mixed' : String(mode !== 'off'));
    document.getElementById('motionLabel').textContent = mode === 'off' ? 'Hiệu ứng tắt' : mode === 'reduced' ? 'Hiệu ứng nhẹ' : 'Hiệu ứng bật';
    motionToggle.title = mode === 'reduced' ? 'Bật đầy đủ hiệu ứng chuyển động' : mode === 'off' ? 'Bật hiệu ứng chuyển động' : 'Tắt hiệu ứng chuyển động';
    refresh();
  }
  motionToggle.addEventListener('click', () => {
    preference = mode === 'full' ? 'off' : 'full';
    try { localStorage.setItem(MOTION_KEY, preference); } catch {}
    updateMotion();
  });

  window.addEventListener('pointerout', event => { if (!event.relatedTarget) relax(); });
  window.addEventListener('pointerup', event => { if (event.pointerType === 'touch') relax(); }, { passive: true });
  window.addEventListener('pointercancel', relax, { passive: true });
  window.addEventListener('blur', relax);
  window.addEventListener('scroll', relax, { passive: true });
  window.addEventListener('resize', () => refresh(true), { passive: true });
  window.addEventListener('pagehide', () => { cancelAnimationFrame(frame); frame = 0; clearCard(); });
  window.addEventListener('pageshow', () => refresh());
  document.addEventListener('visibilitychange', () => refresh());
  document.addEventListener('focusin', event => { if (event.target.closest('.overlay')) relax(); });
  reducedMotion.addEventListener('change', updateMotion);
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    renderer = null;
    canvas.style.visibility = 'hidden';
    wake();
  });
  canvas.addEventListener('webglcontextrestored', initialize);

  function initialize() {
    try { renderer = createRenderer(); }
    catch (error) { renderer = null; console.warn('Using Canvas background:', error.message); }
    canvas.style.visibility = renderer ? 'visible' : 'hidden';
    refresh();
  }
  particles = createParticles();
  updateMotion();
  initialize();
})();
