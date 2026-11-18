// Space War, ported to the browser from the C++/SFML original
// (github.com/KeMeNoToRiKo/Spacewar.Project). The constants, update order and
// drawing positions follow Game.cpp, Spaceship.cpp and Bullet.cpp so the port
// plays like the desktop build. Web-only additions: Start/pause overlay,
// R to restart, M to mute, F for full screen.
(() => {
  'use strict';

  const stage = document.getElementById('sw-stage');
  if (!stage) return;
  const canvas = stage.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const overlay = document.getElementById('sw-overlay');
  const overlayTitle = document.getElementById('sw-overlay-title');
  const startBtn = document.getElementById('sw-start');
  const muteBtn = document.getElementById('sw-mute');
  const fsBtn = document.getElementById('sw-fullscreen');
  const touchNote = document.getElementById('sw-touch');

  const BASE = 'assets/spacewar/';
  const W = 1280;
  const H = 720;
  const STEP = 1000 / 60; // setFramerateLimit(60)
  const DEG = 3.14159 / 180; // the original's own pi

  // ---------- Assets ----------
  // Each texture is redrawn onto a canvas at its real pixel size. Some browsers shrink an
  // image's reported size using resolution metadata in the file, which made the background
  // render smaller than the arena.
  const SIZES = {
    'Background2.jpg': [1336, 768],
    'Spaceship.png': [256, 256],
    'Bullet.png': [1280, 1280],
    'Explode.png': [899, 857],
  };
  const img = {};
  const loadImage = (name) =>
    new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => {
        const [w, h] = SIZES[name];
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        c.getContext('2d').drawImage(i, 0, 0, w, h);
        resolve((img[name] = c));
      };
      i.onerror = reject;
      i.src = BASE + name;
    });

  // Spaceship::replaceColor: swap the exact orange (246,172,109) for the player color.
  function tintShip(source, rgb) {
    const c = document.createElement('canvas');
    c.width = source.width;
    c.height = source.height;
    const g = c.getContext('2d');
    g.drawImage(source, 0, 0);
    try {
      const data = g.getImageData(0, 0, c.width, c.height);
      const p = data.data;
      for (let i = 0; i < p.length; i += 4) {
        if (p[i] === 246 && p[i + 1] === 172 && p[i + 2] === 109 && p[i + 3] === 255) {
          p[i] = rgb[0];
          p[i + 1] = rgb[1];
          p[i + 2] = rgb[2];
        }
      }
      g.putImageData(data, 0, 0);
    } catch (e) {
      // Canvas is tainted (e.g. opened from file://): keep the untinted ship.
    }
    return c;
  }

  const FONT_BIG = 'SWPixels'; // Font/Pixels.ttf
  const FONT_SMALL = 'SWDogica'; // Font/dogica.ttf
  const loadFont = (family, file) => {
    if (!window.FontFace || !document.fonts) return Promise.resolve();
    const f = new FontFace(family, `url(${BASE}${file})`);
    return f.load().then((loaded) => document.fonts.add(loaded)).catch(() => {});
  };

  // ---------- Audio ----------
  let actx = null;
  let master = null;
  let muted = false;
  let fireSource = null;
  const buffers = {};
  const music = new Audio(BASE + 'BackgroundMusic.mp3');
  music.loop = true;
  music.volume = 0.1; // bgMusic.setVolume(10)
  music.preload = 'none';

  function initAudio() {
    if (actx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    actx = new AC();
    master = actx.createGain();
    master.gain.value = muted ? 0 : 1;
    master.connect(actx.destination);
    [['fire', 'blaster.mp3'], ['explode', 'Explode.mp3']].forEach(([key, file]) => {
      fetch(BASE + file)
        .then((r) => r.arrayBuffer())
        .then((b) => new Promise((ok, fail) => actx.decodeAudioData(b, ok, fail)))
        .then((buf) => (buffers[key] = buf))
        .catch(() => {});
    });
  }

  function playSound(key, volume, rate, restartSingle) {
    if (!actx || !buffers[key]) return;
    const src = actx.createBufferSource();
    src.buffer = buffers[key];
    src.playbackRate.value = rate;
    const gain = actx.createGain();
    gain.gain.value = volume;
    src.connect(gain);
    gain.connect(master);
    if (restartSingle) {
      // One shared sf::Sound: calling play() again restarts it.
      if (fireSource) {
        try {
          fireSource.stop();
        } catch (e) {}
      }
      fireSource = src;
    }
    src.start();
  }

  function setMuted(next) {
    muted = next;
    music.muted = muted;
    if (master) master.gain.value = muted ? 0 : 1;
    muteBtn.setAttribute('aria-pressed', String(muted));
    const label = muted ? 'Unmute sound (M)' : 'Mute sound (M)';
    muteBtn.setAttribute('aria-label', label);
    muteBtn.title = label;
    muteBtn.querySelector('[data-icon="on"]').hidden = muted;
    muteBtn.querySelector('[data-icon="off"]').hidden = !muted;
  }

  // ---------- Game objects ----------
  class Ship {
    constructor(x, y, rgb) {
      this.startX = x;
      this.startY = y;
      this.rgb = rgb;
      this.sprite = null;
      this.reset();
    }

    reset() {
      this.x = this.startX;
      this.y = this.startY;
      this.rotation = 0;
      this.vx = 0;
      this.vy = 0;
      this.attackCooldownMax = 20;
      this.attackCooldown = this.attackCooldownMax;
      this.hpMax = 10;
      this.hp = this.hpMax;
      this.destroying = false;
      this.explosionSoundPlayed = false;
      this.frameLeft = 0;
      this.frameTop = -5;
      this.destructionClock = -Infinity;
    }

    get destroyed() {
      return this.hp <= 0;
    }

    rotateClockwise() {
      if (!this.destroyed) this.rotation -= 2.5;
    }

    rotateCounterClockwise() {
      if (!this.destroyed) this.rotation += 2.5;
    }

    moveForward() {
      if (this.destroyed) return;
      this.vx += 1;
      this.vy += 1;
      if (Math.abs(this.vx) > 3) this.vx = 3 * Math.sign(this.vx);
      const a = this.rotation * DEG;
      this.x += this.vx * Math.sin(a);
      this.y -= this.vx * Math.cos(a);
    }

    moveBackward() {
      if (this.destroyed) return;
      const a = this.rotation * DEG;
      this.x -= 2 * Math.sin(a);
      this.y += 2 * Math.cos(a);
    }

    canAttack() {
      if (this.attackCooldown >= this.attackCooldownMax && !this.destroyed) {
        this.attackCooldown = 0;
        return true;
      }
      return false;
    }

    // Sprite global bounds: a 64x64 sprite (256px at 0.25 scale), rotated about its center.
    bounds() {
      const a = this.rotation * DEG;
      const h = 32 * (Math.abs(Math.cos(a)) + Math.abs(Math.sin(a)));
      return { left: this.x - h, top: this.y - h, right: this.x + h, bottom: this.y + h };
    }

    update(time) {
      // updateAttack
      if (this.attackCooldown < this.attackCooldownMax) this.attackCooldown += 0.5;
      // updatePhysics
      const a = this.rotation * DEG;
      this.vx *= 0.98;
      this.vy *= 0.98;
      if (Math.abs(this.vx) < 0.5) this.vx = 0;
      if (Math.abs(this.vy) < 0.5) this.vy = 0;
      this.x += this.vx * Math.sin(a);
      this.y -= this.vx * Math.cos(a);
      // updateAnimation: next 100x100 explosion frame every 0.025 s
      if (this.destroying && time - this.destructionClock >= 0.025) {
        this.frameLeft += 100;
        if (this.frameLeft >= 899) {
          this.frameLeft = 0;
          this.frameTop += 100;
          if (this.frameTop >= 857) this.destroying = false;
        }
        this.destructionClock = time;
      }
      // updateDestruction
      if (this.destroyed && !this.explosionSoundPlayed) {
        playSound('explode', 1, 1, false);
        this.destroying = true;
        this.explosionSoundPlayed = true;
      }
    }

    render() {
      if (this.destroyed) {
        drawClipped(img['Explode.png'], this.frameLeft, this.frameTop, 100, 100, this.x - 50, this.y - 50);
      } else if (this.sprite) {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.rotation * DEG);
        ctx.drawImage(this.sprite, -32, -32, 64, 64);
        ctx.restore();
      }
    }
  }

  class Bullet {
    constructor(x, y, dx, dy, owner) {
      this.x = x;
      this.y = y;
      this.dx = dx;
      this.dy = dy;
      this.speed = 10;
      this.owner = owner;
      this.rotation = 0;
    }

    update() {
      this.x += this.speed * this.dx;
      this.y += this.speed * this.dy;
      this.rotation = Math.atan2(this.dy, this.dx) / DEG + 90;
    }

    // A 32x32 sprite (1280px at 0.025 scale), rotated about its center.
    bounds() {
      const a = this.rotation * DEG;
      const h = 16 * (Math.abs(Math.cos(a)) + Math.abs(Math.sin(a)));
      return { left: this.x - h, top: this.y - h, right: this.x + h, bottom: this.y + h };
    }

    offscreen() {
      return this.x < -64 || this.x > W + 64 || this.y < -64 || this.y > H + 64;
    }

    render() {
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.rotate(this.rotation * DEG);
      ctx.drawImage(img['Bullet.png'], -16, -16, 32, 32);
      ctx.restore();
    }
  }

  const intersects = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

  // Draw a texture rect, clipping the parts that fall outside the image (SFML shows them as empty).
  function drawClipped(image, sx, sy, sw, sh, dx, dy) {
    const x0 = Math.max(sx, 0);
    const y0 = Math.max(sy, 0);
    const x1 = Math.min(sx + sw, image.width);
    const y1 = Math.min(sy + sh, image.height);
    if (x1 <= x0 || y1 <= y0) return;
    ctx.drawImage(image, x0, y0, x1 - x0, y1 - y0, dx + (x0 - sx), dy + (y0 - sy), x1 - x0, y1 - y0);
  }

  // ---------- Game ----------
  const p1 = new Ship(100, 300, [0, 0, 255]); // Color::Blue
  const p2 = new Ship(1100, 300, [255, 0, 0]); // Color::Red
  let bullets = [];
  let time = 0;
  const keys = new Set();
  const down = (code) => keys.has(code);

  function fire(ship, owner) {
    playSound('fire', 0.5, 1.5, true); // volume 50, pitch 1.5
    const r = (ship.rotation - 90) * DEG;
    bullets.push(new Bullet(ship.x, ship.y, Math.cos(r), Math.sin(r), owner));
  }

  function p1Movement() {
    if (down('KeyA')) p1.rotateClockwise();
    if (down('KeyD')) p1.rotateCounterClockwise();
    if (down('KeyW')) p1.moveForward();
    if (down('KeyS')) p1.moveBackward();
    if (down('Space') && p1.canAttack()) fire(p1, 1);
  }

  function p2Movement() {
    if (down('ArrowLeft')) p2.rotateClockwise();
    if (down('ArrowRight')) p2.rotateCounterClockwise();
    if (down('ArrowUp')) p2.moveForward();
    if (down('ArrowDown')) p2.moveBackward();
    if ((down('Enter') || down('NumpadEnter')) && p2.canAttack()) fire(p2, 2);
  }

  // Game::update, in the original order (bullets and ships each update twice per frame there).
  function tick() {
    time += STEP / 1000;
    if (!p1.destroyed && !p2.destroyed) {
      p1Movement();
      p2Movement();
    }
    for (const b of bullets) b.update(); // updateBullets
    bullets = bullets.filter((b) => !b.offscreen());
    const kept = [];
    for (const b of bullets) {
      // updateCombat
      b.update();
      const bb = b.bounds();
      if (intersects(p1.bounds(), bb) && b.owner !== 1) {
        p1.hp = Math.max(0, p1.hp - 1);
        continue;
      }
      if (intersects(p2.bounds(), bb) && b.owner !== 2) {
        p2.hp = Math.max(0, p2.hp - 1);
        continue;
      }
      kept.push(b);
    }
    bullets = kept;
    p1.update(time);
    p2.update(time);
    p1.update(time); // updatePlayerState
    p2.update(time);
  }

  function restart() {
    p1.reset();
    p2.reset();
    bullets = [];
    fireSource = null;
  }

  // ---------- Rendering ----------
  // sf::Text: baseline sits one character size below the position; outline drawn outside the glyphs.
  function drawText(str, x, y, size, family, fill, spacingFactor) {
    ctx.font = `${size}px ${family}`;
    const extra = spacingFactor ? (ctx.measureText(' ').width / 3) * (spacingFactor - 1) : 0;
    const baseline = y + size;
    ctx.lineJoin = 'round';
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#000';
    ctx.fillStyle = fill;
    for (const pass of ['stroke', 'fill']) {
      let cx = x;
      for (const ch of str) {
        if (pass === 'stroke') ctx.strokeText(ch, cx, baseline);
        else ctx.fillText(ch, cx, baseline);
        cx += ctx.measureText(ch).width + extra;
      }
    }
  }

  function textWidth(str, size, family) {
    ctx.font = `${size}px ${family}`;
    return ctx.measureText(str).width;
  }

  function hpBar(x, ship) {
    ctx.fillStyle = 'rgba(25, 25, 25, 0.784)';
    ctx.fillRect(x, 40, 300, 25);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.strokeRect(x - 1, 39, 302, 27);
    ctx.fillStyle = '#f00';
    ctx.fillRect(x, 40, (300 * ship.hp) / ship.hpMax, 25);
  }

  function render() {
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(img['Background2.jpg'], 0, 0, 1336, 768);
    for (const b of bullets) b.render();
    p1.render();
    p2.render();

    hpBar(20, p1);
    hpBar(950, p2);
    drawText('Player 1', 20, -30, 60, FONT_BIG, '#fff', 2);
    drawText('Player 2', 1085, -30, 60, FONT_BIG, '#fff', 2);

    if (p1.destroyed || p2.destroyed) {
      drawText('Game over', 325, 165, 200, FONT_BIG, '#f00', 2);
      if (p1.destroyed && p2.destroyed) drawText('TIE!', 615, 390, 20, FONT_SMALL, '#fff');
      else if (p1.destroyed) drawText('Player 2 WINS!', 500, 390, 20, FONT_SMALL, '#fff');
      else drawText('PLAYER 1 WINS!', 500, 390, 20, FONT_SMALL, '#fff');
      const hint = 'Press R to restart';
      drawText(hint, (W - textWidth(hint, 14, FONT_SMALL)) / 2, 460, 14, FONT_SMALL, '#fff');
    }
  }

  // ---------- Loop, focus and input ----------
  let ready = false;
  let running = false;
  let paused = true;
  let last = performance.now();
  let acc = 0;

  function frame(now) {
    const dt = Math.min(now - last, 250);
    last = now;
    if (ready && running && !paused) {
      acc += dt;
      let steps = 0;
      while (acc >= STEP && steps < 5) {
        tick();
        acc -= STEP;
        steps += 1;
      }
      if (steps === 5) acc = 0;
      render();
    }
    requestAnimationFrame(frame);
  }

  function showOverlay(title, buttonLabel) {
    overlayTitle.textContent = title;
    startBtn.textContent = buttonLabel;
    overlay.hidden = false;
  }

  function resume() {
    if (!ready) return;
    initAudio();
    if (actx && actx.state === 'suspended') actx.resume();
    music.play().catch(() => {});
    running = true;
    paused = false;
    acc = 0;
    overlay.hidden = true;
    stage.focus({ preventScroll: true });
  }

  function pause() {
    if (!running || paused) return;
    paused = true;
    keys.clear();
    music.pause();
    showOverlay('Paused', 'Resume');
  }

  const GAME_KEYS = new Set([
    'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space',
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'NumpadEnter',
  ]);

  stage.addEventListener('keydown', (e) => {
    if (e.target !== stage) return; // let the toolbar buttons handle their own keys
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === 'KeyM') {
      setMuted(!muted);
      return;
    }
    if (e.code === 'KeyF') {
      toggleFullscreen();
      return;
    }
    if (paused) {
      if (e.code === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        resume();
      }
      return;
    }
    if (e.code === 'Escape') {
      pause();
      return;
    }
    if (e.code === 'KeyR' && (p1.destroyed || p2.destroyed)) {
      restart();
      return;
    }
    if (GAME_KEYS.has(e.code)) {
      e.preventDefault();
      keys.add(e.code);
    }
  });

  stage.addEventListener('keyup', (e) => keys.delete(e.code));
  stage.addEventListener('focusout', (e) => {
    if (!stage.contains(e.relatedTarget)) pause();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause();
  });

  overlay.addEventListener('click', () => resume());

  // Toolbar buttons keep focus on the arena so play is not interrupted.
  [muteBtn, fsBtn].forEach((b) => b.addEventListener('mousedown', (e) => e.preventDefault()));
  muteBtn.addEventListener('click', () => setMuted(!muted));

  const fsSupported = !!(stage.requestFullscreen || stage.webkitRequestFullscreen);
  if (!fsSupported) fsBtn.hidden = true;
  function toggleFullscreen() {
    if (!fsSupported) return;
    const active = document.fullscreenElement || document.webkitFullscreenElement;
    if (active) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    else (stage.requestFullscreen || stage.webkitRequestFullscreen).call(stage);
  }
  fsBtn.addEventListener('click', toggleFullscreen);
  document.addEventListener('fullscreenchange', () => {
    if (running && !paused) stage.focus({ preventScroll: true });
  });

  if (touchNote && window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches) {
    touchNote.hidden = false;
  }

  Promise.all([
    loadImage('Background2.jpg'),
    loadImage('Spaceship.png'),
    loadImage('Bullet.png'),
    loadImage('Explode.png'),
    loadFont(FONT_BIG, 'Pixels.ttf'),
    loadFont(FONT_SMALL, 'dogica.ttf'),
  ])
    .then(() => {
      p1.sprite = tintShip(img['Spaceship.png'], p1.rgb);
      p2.sprite = tintShip(img['Spaceship.png'], p2.rgb);
      ready = true;
      render();
      startBtn.disabled = false;
      startBtn.textContent = 'Start match';
    })
    .catch(() => {
      startBtn.textContent = 'Could not load the game';
    });

  requestAnimationFrame(frame);
})();
