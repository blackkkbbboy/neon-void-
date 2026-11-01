(() => {
  'use strict';

  // ---------- Setup ----------
  const cv = document.getElementById('game');
  const ctx = cv.getContext('2d');
  const W = 480, H = 720;
  cv.width = W; cv.height = H;

  const $ = id => document.getElementById(id);
  const ui = {
    menu: $('menu'), over: $('over'), paused: $('paused'),
    score: $('score'), best: $('best'), wave: $('wave'), hp: $('hp'),
    final: $('final'), newbest: $('newbest')
  };

  let best = 0;
  try { best = +localStorage.getItem('neonvoid-best') || 0; } catch (e) {}
  ui.best.textContent = best;

  const rand = (a, b) => Math.random() * (b - a) + a;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  let state = 'menu'; // menu | play | paused | over
  let score, wave, player, bullets, enemies, ebullets, items, parts;
  let spawnQ, spawnT, waveDelay, banner, shake, muted = false, last = 0;
  const keys = {};
  let pointer = null;
  const stars = Array.from({ length: 80 }, () => ({ x: rand(0, W), y: rand(0, H), z: rand(.3, 1.3) }));

  // ---------- Audio ----------
  let ac;
  function beep(f, d, type = 'square', v = .04, slide = 0) {
    if (muted) return;
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime;
      o.type = type;
      o.frequency.setValueAtTime(f, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, f + slide), t + d);
      g.gain.setValueAtTime(v, t);
      g.gain.exponentialRampToValueAtTime(.001, t + d);
      o.connect(g); g.connect(ac.destination);
      o.start(t); o.stop(t + d);
    } catch (e) {}
  }

  // ---------- Game flow ----------
  function reset() {
    score = 0; wave = 0; shake = 0; banner = 0;
    player = { x: W / 2, y: H - 100, r: 13, hp: 3, cd: 0, rapid: 0, triple: 0, shield: 0, inv: 0 };
    bullets = []; enemies = []; ebullets = []; items = []; parts = [];
    spawnQ = []; spawnT = 0; waveDelay = .6;
    updateHUD();
  }

  function start() {
    reset();
    state = 'play';
    ui.menu.classList.add('hidden');
    ui.over.classList.add('hidden');
    ui.paused.classList.add('hidden');
    beep(440, .25, 'sawtooth', .05, 440);
  }

  function gameOver() {
    state = 'over';
    explode(player.x, player.y, '#00f0ff', 40, 260);
    beep(220, .8, 'sawtooth', .07, -180);
    const isBest = score > best;
    if (isBest) {
      best = score;
      try { localStorage.setItem('neonvoid-best', best); } catch (e) {}
    }
    ui.final.textContent = score;
    ui.newbest.classList.toggle('hidden', !isBest);
    ui.best.textContent = best;
    setTimeout(() => { if (state === 'over') ui.over.classList.remove('hidden'); }, 700);
  }

  function togglePause() {
    if (state === 'play') { state = 'paused'; ui.paused.classList.remove('hidden'); }
    else if (state === 'paused') { state = 'play'; ui.paused.classList.add('hidden'); last = performance.now(); }
  }

  function updateHUD() {
    ui.score.textContent = score;
    ui.wave.textContent = Math.max(1, wave);
    ui.hp.textContent = '♥'.repeat(Math.max(0, player.hp)) + '♡'.repeat(Math.max(0, 3 - player.hp));
  }

  // ---------- Waves & enemies ----------
  function nextWave() {
    wave++;
    banner = 1.8;
    spawnQ = [];
    if (wave % 5 === 0) spawnQ.push('boss');
    const n = 5 + wave * 2;
    for (let i = 0; i < n; i++) {
      const r = Math.random();
      let t = 'drone';
      if (wave >= 2 && r > .60) t = 'zig';
      if (wave >= 3 && r > .80) t = 'shooter';
      if (wave >= 4 && r > .92) t = 'tank';
      spawnQ.push(t);
    }
    spawnT = 0;
    beep(660, .2, 'triangle', .05, 300);
    updateHUD();
  }

  function spawn(t) {
    const x = rand(40, W - 40);
    const e = { t, x, fx: x, y: -40, age: 0, cd: rand(.5, 1.5) };
    const sc = 1 + Math.floor(wave / 6);
    if (t === 'drone')   Object.assign(e, { r: 14, hp: 1, vy: 90 + wave * 5, c: '#ff4d6d', pts: 10 });
    if (t === 'zig')     Object.assign(e, { r: 14, hp: 2, vy: 70 + wave * 4, c: '#ff9f1c', pts: 20 });
    if (t === 'shooter') Object.assign(e, { r: 16, hp: 3 * sc, vy: 80, stop: rand(90, 220), c: '#b967ff', pts: 40 });
    if (t === 'tank')    Object.assign(e, { r: 24, hp: 8 * sc, vy: 45, c: '#3dff8a', pts: 80 });
    if (t === 'boss') {
      Object.assign(e, { x: W / 2, fx: W / 2, r: 48, hp: 45 + wave * 6, max: 45 + wave * 6, vy: 60, stop: 110, c: '#ff2e93', pts: 500 + wave * 40, phase: 0 });
    }
    enemies.push(e);
  }

  function kill(e) {
    score += e.pts;
    explode(e.x, e.y, e.c, e.t === 'boss' ? 70 : 16, e.t === 'boss' ? 360 : 180);
    beep(e.t === 'boss' ? 120 : 200, e.t === 'boss' ? .7 : .15, 'sawtooth', .06, -90);
    if (e.t === 'boss') {
      shake = 1;
      for (let i = 0; i < 3; i++) dropItem(e.x + rand(-40, 40), e.y + rand(-20, 20), true);
    } else if (Math.random() < .12) dropItem(e.x, e.y);
    updateHUD();
  }

  function dropItem(x, y, force) {
    const kinds = ['T', 'R', 'S', 'H'];
    let k = kinds[Math.floor(Math.random() * kinds.length)];
    if (k === 'H' && player.hp >= 3 && !force) k = 'R';
    items.push({ x, y, k, r: 11, vy: 80 });
  }

  const ITEM_COLOR = { T: '#00f0ff', R: '#ffd23f', S: '#3dff8a', H: '#ff2e93' };

  // ---------- Effects ----------
  function explode(x, y, c, n, speed) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2), s = rand(30, speed);
      parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(.3, .8), max: .8, c, s: rand(1.5, 3.5) });
    }
  }

  function hurt() {
    if (player.inv > 0 || player.shield > 0) return;
    player.hp--;
    player.inv = 1.4;
    shake = .5;
    explode(player.x, player.y, '#ff2e93', 14, 200);
    beep(150, .3, 'sawtooth', .07, -80);
    updateHUD();
    if (player.hp <= 0) gameOver();
  }

  function enemyShoot(e, angle, speed = 210) {
    ebullets.push({ x: e.x, y: e.y + e.r * .5, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, r: 5 });
  }

  // ---------- Update ----------
  function update(dt) {
    // stars
    stars.forEach(s => { s.y += 40 * s.z * dt; if (s.y > H) { s.y = 0; s.x = rand(0, W); } });

    // particles always update
    parts.forEach(p => { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= .98; p.vy *= .98; p.life -= dt; });
    parts = parts.filter(p => p.life > 0);
    shake = Math.max(0, shake - dt * 1.6);

    if (state !== 'play') return;

    // player movement
    let dx = 0, dy = 0;
    if (keys.arrowleft || keys.a) dx--;
    if (keys.arrowright || keys.d) dx++;
    if (keys.arrowup || keys.w) dy--;
    if (keys.arrowdown || keys.s) dy++;
    player.x += dx * 330 * dt;
    player.y += dy * 330 * dt;
    if (pointer) {
      const k = Math.min(1, 14 * dt);
      player.x += (pointer.x - player.x) * k;
      player.y += (pointer.y - player.y) * k;
    }
    player.x = clamp(player.x, 20, W - 20);
    player.y = clamp(player.y, 60, H - 30);

    player.rapid = Math.max(0, player.rapid - dt);
    player.triple = Math.max(0, player.triple - dt);
    player.shield = Math.max(0, player.shield - dt);
    player.inv = Math.max(0, player.inv - dt);
    player.cd -= dt;

    // auto fire
    if (player.cd <= 0) {
      player.cd = player.rapid > 0 ? .1 : .21;
      const shots = player.triple > 0 ? [-.22, 0, .22] : [0];
      shots.forEach(a => bullets.push({ x: player.x, y: player.y - 16, vx: Math.sin(a) * 640, vy: -Math.cos(a) * 640 }));
      beep(880, .05, 'square', .015, -300);
    }

    // waves
    banner = Math.max(0, banner - dt);
    if (!spawnQ.length && !enemies.length) {
      waveDelay -= dt;
      if (waveDelay <= 0) { nextWave(); waveDelay = 1.2; }
    }
    spawnT -= dt;
    if (spawnQ.length && spawnT <= 0) {
      spawn(spawnQ.shift());
      spawnT = Math.max(.25, .85 - wave * .03);
    }

    // bullets
    bullets.forEach(b => { b.x += b.vx * dt; b.y += b.vy * dt; });
    bullets = bullets.filter(b => b.y > -20 && b.x > -20 && b.x < W + 20);
    ebullets.forEach(b => { b.x += b.vx * dt; b.y += b.vy * dt; });
    ebullets = ebullets.filter(b => b.y < H + 20 && b.y > -20 && b.x > -20 && b.x < W + 20);

    // enemies
    enemies.forEach(e => {
      e.age += dt;
      if (e.t === 'drone') e.y += e.vy * dt;
      else if (e.t === 'zig') { e.y += e.vy * dt; e.x = clamp(e.fx + Math.sin(e.age * 3) * 70, 20, W - 20); }
      else if (e.t === 'tank') { e.y += e.vy * dt; e.cd -= dt; if (e.cd <= 0 && e.y > 0) { e.cd = 1.6; enemyShoot(e, Math.PI / 2); } }
      else if (e.t === 'shooter') {
        if (e.y < e.stop) e.y += e.vy * dt; else e.y += 8 * dt;
        e.cd -= dt;
        if (e.cd <= 0 && e.y > 0) { e.cd = 1.4; enemyShoot(e, Math.atan2(player.y - e.y, player.x - e.x)); beep(300, .08, 'square', .02, -100); }
      } else if (e.t === 'boss') {
        if (e.y < e.stop) e.y += e.vy * dt;
        else {
          e.x = W / 2 + Math.sin(e.age * .9) * (W / 2 - 80);
          e.cd -= dt;
          if (e.cd <= 0) {
            e.phase = (e.phase + 1) % 3;
            if (e.phase === 0) { e.cd = 1.1; for (let i = -3; i <= 3; i++) enemyShoot(e, Math.PI / 2 + i * .22, 190); }
            else if (e.phase === 1) { e.cd = .9; enemyShoot(e, Math.atan2(player.y - e.y, player.x - e.x), 280); enemyShoot(e, Math.atan2(player.y - e.y, player.x - e.x) + .2, 280); enemyShoot(e, Math.atan2(player.y - e.y, player.x - e.x) - .2, 280); }
            else { e.cd = 1.3; for (let i = 0; i < 12; i++) enemyShoot(e, i / 12 * Math.PI * 2 + e.age, 160); }
            beep(180, .15, 'sawtooth', .04, -60);
          }
        }
      }
    });
    enemies = enemies.filter(e => e.y < H + 50);

    // bullet vs enemy
    bullets.forEach(b => {
      for (const e of enemies) {
        if (e.hp > 0 && Math.hypot(b.x - e.x, b.y - e.y) < e.r + 4) {
          e.hp--; b.dead = true; e.flash = .08;
          explode(b.x, b.y, e.c, 3, 120);
          if (e.hp <= 0) kill(e); else beep(500, .04, 'square', .02);
          break;
        }
      }
    });
    bullets = bullets.filter(b => !b.dead);
    enemies = enemies.filter(e => e.hp > 0);
    enemies.forEach(e => { if (e.flash) e.flash = Math.max(0, e.flash - dt); });

    // enemy vs player
    if (state === 'play') {
      enemies.forEach(e => { if (e.hp > 0 && Math.hypot(e.x - player.x, e.y - player.y) < e.r + player.r - 2) { if (e.t !== 'boss') { e.hp = 0; kill(e); } hurt(); } });
      ebullets.forEach(b => { if (!b.dead && Math.hypot(b.x - player.x, b.y - player.y) < b.r + player.r - 5) { b.dead = true; hurt(); } });
      ebullets = ebullets.filter(b => !b.dead);
      enemies = enemies.filter(e => e.hp > 0);
    }

    // items
    items.forEach(it => {
      it.y += it.vy * dt;
      if (Math.hypot(it.x - player.x, it.y - player.y) < it.r + player.r + 4) {
        it.dead = true;
        if (it.k === 'T') player.triple = 10;
        if (it.k === 'R') player.rapid = 10;
        if (it.k === 'S') player.shield = 8;
        if (it.k === 'H') player.hp = Math.min(3, player.hp + 1);
        score += 25;
        beep(700, .2, 'triangle', .05, 500);
        updateHUD();
      }
    });
    items = items.filter(i => !i.dead && i.y < H + 20);
  }

  // ---------- Draw ----------
  function glow(color, blur = 12) { ctx.shadowColor = color; ctx.shadowBlur = blur; }
  function noGlow() { ctx.shadowBlur = 0; }

  function draw() {
    ctx.save();
    ctx.clearRect(0, 0, W, H);
    if (shake > 0) ctx.translate(rand(-1, 1) * shake * 8, rand(-1, 1) * shake * 8);

    // stars
    stars.forEach(s => { ctx.fillStyle = `rgba(180,210,255,${.25 + s.z * .4})`; ctx.fillRect(s.x, s.y, s.z * 1.8, s.z * 1.8); });

    if (state === 'play' || state === 'paused' || state === 'over') {
      // items
      items.forEach(it => {
        const c = ITEM_COLOR[it.k];
        glow(c); ctx.strokeStyle = c; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(it.x, it.y, it.r, 0, 7); ctx.stroke();
        noGlow(); ctx.fillStyle = c; ctx.font = 'bold 13px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(it.k === 'H' ? '+' : it.k, it.x, it.y + 1);
      });

      // enemies
      enemies.forEach(drawEnemy);

      // bullets
      glow('#00f0ff', 10); ctx.fillStyle = '#aefcff';
      bullets.forEach(b => ctx.fillRect(b.x - 2, b.y - 8, 4, 14));
      glow('#ff2e93', 10); ctx.fillStyle = '#ff8cc6';
      ebullets.forEach(b => { ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, 7); ctx.fill(); });
      noGlow();

      // player
      if (player.hp > 0 && !(player.inv > 0 && Math.floor(player.inv * 14) % 2)) drawPlayer();

      // particles
      parts.forEach(p => { ctx.globalAlpha = clamp(p.life / p.max, 0, 1); ctx.fillStyle = p.c; ctx.fillRect(p.x, p.y, p.s, p.s); });
      ctx.globalAlpha = 1;

      // power-up bars
      let by = H - 14;
      [['triple', '#00f0ff'], ['rapid', '#ffd23f'], ['shield', '#3dff8a']].forEach(([k, c]) => {
        if (player && player[k] > 0) { ctx.fillStyle = c; ctx.fillRect(10, by, (player[k] / 10) * 70, 4); by -= 8; }
      });

      // banner
      if (banner > 0 && state === 'play') {
        ctx.globalAlpha = Math.min(1, banner);
        glow('#00f0ff', 20); ctx.fillStyle = '#fff'; ctx.font = 'bold 40px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(wave % 5 === 0 ? `WAVE ${wave} - BOSS` : `WAVE ${wave}`, W / 2, H / 3);
        noGlow(); ctx.globalAlpha = 1;
      }

      // boss bar
      const boss = enemies.find(e => e.t === 'boss');
      if (boss) {
        ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.fillRect(60, 16, W - 120, 8);
        glow('#ff2e93', 8); ctx.fillStyle = '#ff2e93'; ctx.fillRect(60, 16, (W - 120) * clamp(boss.hp / boss.max, 0, 1), 8); noGlow();
      }
    }
    ctx.restore();
  }

  function drawPlayer() {
    const { x, y } = player;
    if (player.shield > 0) {
      glow('#3dff8a', 14); ctx.strokeStyle = '#3dff8a'; ctx.lineWidth = 2;
      ctx.globalAlpha = .6 + Math.sin(performance.now() / 80) * .3;
      ctx.beginPath(); ctx.arc(x, y, 24, 0, 7); ctx.stroke(); ctx.globalAlpha = 1;
    }
    glow('#00f0ff', 14);
    ctx.fillStyle = '#00f0ff';
    ctx.beginPath(); ctx.moveTo(x, y - 18); ctx.lineTo(x + 14, y + 14); ctx.lineTo(x, y + 8); ctx.lineTo(x - 14, y + 14); ctx.closePath(); ctx.fill();
    // engine flame
    glow('#ff9f1c', 12); ctx.fillStyle = '#ff9f1c';
    ctx.beginPath(); ctx.moveTo(x - 5, y + 10); ctx.lineTo(x, y + 18 + rand(0, 8)); ctx.lineTo(x + 5, y + 10); ctx.fill();
    noGlow();
  }

  function drawEnemy(e) {
    const c = e.flash ? '#ffffff' : e.c;
    glow(c, 12); ctx.fillStyle = c; ctx.strokeStyle = c; ctx.lineWidth = 2;
    ctx.save(); ctx.translate(e.x, e.y);
    ctx.beginPath();
    if (e.t === 'drone') { ctx.moveTo(0, e.r); ctx.lineTo(e.r, -e.r * .7); ctx.lineTo(0, -e.r * .2); ctx.lineTo(-e.r, -e.r * .7); ctx.closePath(); ctx.fill(); }
    else if (e.t === 'zig') { ctx.rect(-e.r * .8, -e.r * .8, e.r * 1.6, e.r * 1.6); ctx.rotate(Math.PI / 4); ctx.fill(); }
    else if (e.t === 'shooter') { for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; ctx.lineTo(Math.cos(a) * e.r, Math.sin(a) * e.r); } ctx.closePath(); ctx.fill(); noGlow(); ctx.fillStyle = '#05060f'; ctx.beginPath(); ctx.arc(0, 0, 5, 0, 7); ctx.fill(); }
    else if (e.t === 'tank') { ctx.rect(-e.r, -e.r * .7, e.r * 2, e.r * 1.4); ctx.fill(); noGlow(); ctx.fillStyle = '#05060f'; ctx.fillRect(-6, -4, 12, 8); }
    else if (e.t === 'boss') {
      ctx.rotate(Math.sin(e.age) * .05);
      ctx.moveTo(0, e.r); ctx.lineTo(e.r, 0); ctx.lineTo(e.r * .6, -e.r * .8); ctx.lineTo(-e.r * .6, -e.r * .8); ctx.lineTo(-e.r, 0); ctx.closePath(); ctx.fill();
      noGlow(); ctx.fillStyle = '#05060f'; ctx.beginPath(); ctx.arc(0, -4, 14, 0, 7); ctx.fill();
      ctx.fillStyle = '#ff2e93'; ctx.beginPath(); ctx.arc(0, -4, 7 + Math.sin(e.age * 6) * 2, 0, 7); ctx.fill();
    }
    ctx.restore(); noGlow();
  }

  // ---------- Loop ----------
  function loop(t) {
    const dt = Math.min(.033, (t - last) / 1000 || 0);
    last = t;
    if (state !== 'paused') update(dt);
    draw();
    requestAnimationFrame(loop);
  }

  // ---------- Input ----------
  addEventListener('keydown', e => {
    const k = e.key.toLowerCase();
    if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', ' '].includes(k)) e.preventDefault();
    keys[k] = true;
    if ((k === 'enter' || k === ' ') && (state === 'menu' || state === 'over')) start();
    if (k === 'p' || k === 'escape') togglePause();
    if (k === 'm') muted = !muted;
  });
  addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });
  addEventListener('blur', () => { if (state === 'play') togglePause(); });

  function setPointer(e) {
    const r = cv.getBoundingClientRect();
    const touch = e.pointerType === 'touch';
    pointer = {
      x: (e.clientX - r.left) / r.width * W,
      y: (e.clientY - r.top) / r.height * H - (touch ? 60 : 0)
    };
  }
  cv.addEventListener('pointerdown', e => { if (state === 'paused') return togglePause(); setPointer(e); cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', e => { if (e.buttons || e.pointerType === 'touch') setPointer(e); });
  const release = () => { pointer = null; };
  cv.addEventListener('pointerup', release);
  cv.addEventListener('pointercancel', release);
  ui.paused.addEventListener('click', togglePause);

  $('startBtn').addEventListener('click', start);
  $('againBtn').addEventListener('click', start);

  reset();
  requestAnimationFrame(loop);
})();
