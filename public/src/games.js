// ═══════════════════════════════════════════════════
// NYCKING Mini Games — 2048 / Snake / Whack-a-Mole
// ═══════════════════════════════════════════════════

(function () {
  const $ = (id) => document.getElementById(id);

  // ─── Leaderboard (localStorage) ───
  const LB_KEY = 'nycking_lb';
  function loadLB() {
    try { return JSON.parse(localStorage.getItem(LB_KEY)) || []; } catch { return []; }
  }
  function saveLB(arr) { localStorage.setItem(LB_KEY, JSON.stringify(arr)); }
  function addScore(game, score) {
    if (!score) return;
    const lb = loadLB();
    lb.push({ game, score, ts: Date.now() });
    lb.sort((a, b) => b.score - a.score);
    if (lb.length > 50) lb.length = 50;
    saveLB(lb);
  }
  function getBest(game) {
    const lb = loadLB();
    const entry = lb.find(e => e.game === game);
    return entry ? entry.score : 0;
  }
  function renderLB() {
    const list = $('lb-list');
    const lb = loadLB();
    if (!lb.length) {
      list.innerHTML = '<div style="text-align:center;color:var(--text-dim);padding:40px 0" data-i18n="lb_empty">No scores yet. Play a game first!</div>';
      return;
    }
    const medals = ['🥇', '🥈', '🥉'];
    const gameNames = { '2048': '2048', snake: '🐍 Snake', mole: '🐹 Mole' };
    list.innerHTML = lb.slice(0, 20).map((e, i) => `
      <div class="lb-row">
        <span class="lb-rank">${medals[i] || (i + 1)}</span>
        <div>
          <div style="font-weight:700">${gameNames[e.game] || e.game}</div>
          <div class="lb-game">${new Date(e.ts).toLocaleDateString()}</div>
        </div>
        <span class="lb-score">${e.score.toLocaleString()}</span>
      </div>
    `).join('');
  }

  // Clear leaderboard
  $('lb-clear').addEventListener('click', () => {
    if (confirm('Clear all scores?')) {
      saveLB([]);
      renderLB();
    }
  });

  // ═══════════════════════════════════════════════
  // 2048
  // ═══════════════════════════════════════════════
  const G2048 = {
    grid: null,
    score: 0,
    running: false,

    init() {
      this.grid = Array(16).fill(0);
      this.score = 0;
      this.running = true;
      $('go-2048-over').classList.remove('show');
      this.spawn();
      this.spawn();
      this.render();
      $('s2048-score').textContent = '0';
      $('s2048-best').textContent = getBest('2048').toLocaleString();
    },

    spawn() {
      const empty = this.grid.map((v, i) => v === 0 ? i : -1).filter(i => i >= 0);
      if (!empty.length) return;
      const idx = empty[Math.floor(Math.random() * empty.length)];
      this.grid[idx] = Math.random() < 0.9 ? 2 : 4;
    },

    render() {
      const container = $('grid-2048');
      container.innerHTML = '';
      for (let i = 0; i < 16; i++) {
        const div = document.createElement('div');
        div.className = 'tile-2048';
        const v = this.grid[i];
        if (v) {
          div.textContent = v;
          div.dataset.v = v > 2048 ? '2048' : v;
        }
        container.appendChild(div);
      }
      $('s2048-score').textContent = this.score.toLocaleString();
    },

    slide(row) {
      let arr = row.filter(v => v !== 0);
      let scored = 0;
      for (let i = 0; i < arr.length - 1; i++) {
        if (arr[i] === arr[i + 1]) {
          arr[i] *= 2;
          scored += arr[i];
          arr.splice(i + 1, 1);
        }
      }
      while (arr.length < 4) arr.push(0);
      return { arr, scored };
    },

    move(dir) {
      if (!this.running) return;
      let moved = false;
      const g = this.grid;
      const getRow = (r) => [g[r * 4], g[r * 4 + 1], g[r * 4 + 2], g[r * 4 + 3]];
      const getCol = (c) => [g[c], g[c + 4], g[c + 8], g[c + 12]];
      const setRow = (r, arr) => { for (let i = 0; i < 4; i++) g[r * 4 + i] = arr[i]; };
      const setCol = (c, arr) => { for (let i = 0; i < 4; i++) g[c + i * 4] = arr[i]; };

      for (let i = 0; i < 4; i++) {
        let line, result;
        if (dir === 'left') {
          line = getRow(i);
          result = this.slide(line);
          if (line.join() !== result.arr.join()) moved = true;
          setRow(i, result.arr);
        } else if (dir === 'right') {
          line = getRow(i).reverse();
          result = this.slide(line);
          if (getRow(i).join() !== result.arr.reverse().join()) moved = true;
          result.arr.reverse();
          setRow(i, result.arr);
        } else if (dir === 'up') {
          line = getCol(i);
          result = this.slide(line);
          if (line.join() !== result.arr.join()) moved = true;
          setCol(i, result.arr);
        } else if (dir === 'down') {
          line = getCol(i).reverse();
          result = this.slide(line);
          if (getCol(i).join() !== result.arr.reverse().join()) moved = true;
          result.arr.reverse();
          setCol(i, result.arr);
        }
        this.score += result.scored;
      }

      if (moved) {
        this.spawn();
        this.render();
        if (this.isGameOver()) this.gameOver();
      }
    },

    isGameOver() {
      if (this.grid.includes(0)) return false;
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 4; c++) {
          const v = this.grid[r * 4 + c];
          if (c < 3 && v === this.grid[r * 4 + c + 1]) return false;
          if (r < 3 && v === this.grid[(r + 1) * 4 + c]) return false;
        }
      }
      return true;
    },

    gameOver() {
      this.running = false;
      addScore('2048', this.score);
      $('s2048-best').textContent = getBest('2048').toLocaleString();
      $('go-2048-fscore').textContent = `Score: ${this.score.toLocaleString()}`;
      $('go-2048-over').classList.add('show');
    },

    stop() { this.running = false; }
  };

  // 2048 touch + keyboard
  let t2048Start = null;
  const grid2048El = $('grid-2048');
  grid2048El.addEventListener('touchstart', (e) => {
    t2048Start = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, { passive: true });
  grid2048El.addEventListener('touchend', (e) => {
    if (!t2048Start) return;
    const dx = e.changedTouches[0].clientX - t2048Start.x;
    const dy = e.changedTouches[0].clientY - t2048Start.y;
    if (Math.abs(dx) < 30 && Math.abs(dy) < 30) return;
    if (Math.abs(dx) > Math.abs(dy)) {
      G2048.move(dx > 0 ? 'right' : 'left');
    } else {
      G2048.move(dy > 0 ? 'down' : 'up');
    }
    t2048Start = null;
  }, { passive: true });
  document.addEventListener('keydown', (e) => {
    if (!G2048.running) return;
    const map = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
    if (map[e.key]) { e.preventDefault(); G2048.move(map[e.key]); }
  });
  $('go-2048-retry').addEventListener('click', () => G2048.init());

  // ═══════════════════════════════════════════════
  // SNAKE
  // ═══════════════════════════════════════════════
  const SNAKE = {
    canvas: $('snake-canvas'),
    ctx: null,
    size: 16,
    snake: [],
    food: null,
    dir: { x: 1, y: 0 },
    nextDir: { x: 1, y: 0 },
    score: 0,
    timer: null,
    running: false,
    speed: 150,

    init() {
      this.ctx = this.canvas.getContext('2d');
      // Make canvas responsive
      const w = Math.min(320, window.innerWidth - 40);
      this.canvas.style.width = w + 'px';
      this.canvas.style.height = w + 'px';
      this.canvas.width = 320;
      this.canvas.height = 320;

      this.snake = [{ x: 5, y: 8 }, { x: 4, y: 8 }, { x: 3, y: 8 }];
      this.dir = { x: 1, y: 0 };
      this.nextDir = { x: 1, y: 0 };
      this.score = 0;
      this.speed = 150;
      this.running = true;
      $('go-snake-over').classList.remove('show');
      $('snake-score').textContent = '0';
      $('snake-best').textContent = getBest('snake').toLocaleString();
      this.placeFood();
      this.loop();
    },

    placeFood() {
      const cells = [];
      const occupied = new Set(this.snake.map(s => `${s.x},${s.y}`));
      for (let x = 0; x < this.size; x++) {
        for (let y = 0; y < this.size; y++) {
          if (!occupied.has(`${x},${y}`)) cells.push({ x, y });
        }
      }
      this.food = cells[Math.floor(Math.random() * cells.length)];
    },

    loop() {
      if (this.timer) clearTimeout(this.timer);
      if (!this.running) return;
      this.update();
      this.draw();
      this.timer = setTimeout(() => this.loop(), this.speed);
    },

    update() {
      this.dir = { ...this.nextDir };
      const head = { x: this.snake[0].x + this.dir.x, y: this.snake[0].y + this.dir.y };

      // Wall collision
      if (head.x < 0 || head.x >= this.size || head.y < 0 || head.y >= this.size) {
        return this.gameOver();
      }
      // Self collision
      if (this.snake.some(s => s.x === head.x && s.y === head.y)) {
        return this.gameOver();
      }

      this.snake.unshift(head);

      if (this.food && head.x === this.food.x && head.y === this.food.y) {
        this.score += 10;
        $('snake-score').textContent = this.score;
        if (this.speed > 60) this.speed -= 3;
        this.placeFood();
      } else {
        this.snake.pop();
      }
    },

    draw() {
      const ctx = this.ctx;
      const cell = 320 / this.size;
      // Background
      ctx.fillStyle = '#111';
      ctx.fillRect(0, 0, 320, 320);
      // Grid
      ctx.strokeStyle = '#1a1a1a';
      for (let i = 0; i <= this.size; i++) {
        ctx.beginPath(); ctx.moveTo(i * cell, 0); ctx.lineTo(i * cell, 320); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, i * cell); ctx.lineTo(320, i * cell); ctx.stroke();
      }
      // Food
      if (this.food) {
        ctx.fillStyle = '#f97316';
        ctx.beginPath();
        ctx.arc(this.food.x * cell + cell / 2, this.food.y * cell + cell / 2, cell / 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
      // Snake
      this.snake.forEach((s, i) => {
        ctx.fillStyle = i === 0 ? '#4ade80' : '#22c55e';
        ctx.fillRect(s.x * cell + 1, s.y * cell + 1, cell - 2, cell - 2);
        ctx.strokeStyle = '#111';
        ctx.strokeRect(s.x * cell + 1, s.y * cell + 1, cell - 2, cell - 2);
      });
    },

    setDir(x, y) {
      if (!this.running) return;
      // Prevent 180-degree turn
      if (this.dir.x === -x && this.dir.y === -y) return;
      if (x === this.dir.x && y === this.dir.y) return;
      this.nextDir = { x, y };
    },

    gameOver() {
      this.running = false;
      if (this.timer) clearTimeout(this.timer);
      addScore('snake', this.score);
      $('snake-best').textContent = getBest('snake').toLocaleString();
      $('go-snake-fscore').textContent = `Score: ${this.score}`;
      $('go-snake-over').classList.add('show');
    },

    stop() {
      this.running = false;
      if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    }
  };

  // Snake touch controls
  let snakeStart = null;
  SNAKE.canvas.addEventListener('touchstart', (e) => {
    snakeStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, { passive: true });
  SNAKE.canvas.addEventListener('touchend', (e) => {
    if (!snakeStart) return;
    const dx = e.changedTouches[0].clientX - snakeStart.x;
    const dy = e.changedTouches[0].clientY - snakeStart.y;
    if (Math.abs(dx) < 20 && Math.abs(dy) < 20) return;
    if (Math.abs(dx) > Math.abs(dy)) {
      SNAKE.setDir(dx > 0 ? 1 : -1, 0);
    } else {
      SNAKE.setDir(0, dy > 0 ? 1 : -1);
    }
  }, { passive: true });
  // Arrow keys for snake
  document.addEventListener('keydown', (e) => {
    if (!SNAKE.running) return;
    const map = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (map[e.key]) { e.preventDefault(); SNAKE.setDir(...map[e.key]); }
  });
  $('go-snake-retry').addEventListener('click', () => SNAKE.init());

  // ═══════════════════════════════════════════════
  // WHACK-A-MOLE
  // ═══════════════════════════════════════════════
  const MOLE = {
    score: 0,
    timeLeft: 30,
    timer: null,
    moleTimer: null,
    running: false,
    activeMole: -1,

    init() {
      this.score = 0;
      this.timeLeft = 30;
      this.running = true;
      this.activeMole = -1;
      $('go-mole-over').classList.remove('show');
      $('mole-score').textContent = '0';
      $('mole-best').textContent = getBest('mole').toLocaleString();
      $('mole-timer').textContent = '30s';
      $('mole-start').style.display = 'none';
      this.clearMoles();
      this.startTimers();
    },

    clearMoles() {
      document.querySelectorAll('.mole-hole').forEach(h => {
        h.classList.remove('active');
        h.textContent = '';
      });
    },

    showMole() {
      this.clearMoles();
      const idx = Math.floor(Math.random() * 9);
      this.activeMole = idx;
      const hole = document.querySelectorAll('.mole-hole')[idx];
      hole.classList.add('active');
      hole.textContent = '🐹';
    },

    startTimers() {
      this.showMole();
      // Mole appears every 800-1200ms, gets faster over time
      const scheduleNext = () => {
        if (!this.running) return;
        const baseDelay = Math.max(400, 1000 - (30 - this.timeLeft) * 15);
        this.moleTimer = setTimeout(() => {
          if (!this.running) return;
          this.showMole();
          scheduleNext();
        }, baseDelay + Math.random() * 300);
      };
      scheduleNext();

      // Countdown
      this.timer = setInterval(() => {
        this.timeLeft--;
        $('mole-timer').textContent = this.timeLeft + 's';
        if (this.timeLeft <= 0) this.gameOver();
      }, 1000);
    },

    whack(idx) {
      if (!this.running || idx !== this.activeMole) return;
      this.score += 10;
      $('mole-score').textContent = this.score;
      const hole = document.querySelectorAll('.mole-hole')[idx];
      hole.textContent = '💥';
      hole.classList.remove('active');
      this.activeMole = -1;
      setTimeout(() => { if (hole.textContent === '💥') hole.textContent = ''; }, 200);
    },

    gameOver() {
      this.running = false;
      if (this.timer) clearInterval(this.timer);
      if (this.moleTimer) clearTimeout(this.moleTimer);
      this.clearMoles();
      addScore('mole', this.score);
      $('mole-best').textContent = getBest('mole').toLocaleString();
      $('go-mole-fscore').textContent = `Score: ${this.score}`;
      $('go-mole-over').classList.add('show');
      $('mole-start').style.display = '';
    },

    stop() {
      this.running = false;
      if (this.timer) { clearInterval(this.timer); this.timer = null; }
      if (this.moleTimer) { clearTimeout(this.moleTimer); this.moleTimer = null; }
    }
  };

  // Mole click handlers
  document.querySelectorAll('.mole-hole').forEach(hole => {
    hole.addEventListener('click', () => {
      const idx = parseInt(hole.dataset.i);
      MOLE.whack(idx);
    });
  });
  $('mole-start').addEventListener('click', () => MOLE.init());
  $('go-mole-retry').addEventListener('click', () => MOLE.init());

  // ─── Game lifecycle hooks ───
  window.NYCKING_GAME_START = function (game) {
    if (game === '2048') G2048.init();
    else if (game === 'snake') SNAKE.init();
    else if (game === 'mole') { /* wait for Start button */ $('mole-start').style.display = ''; }
    else if (game === 'lb') renderLB();
  };

  window.NYCKING_GAME_STOP = function (game) {
    if (game === '2048') G2048.stop();
    else if (game === 'snake') SNAKE.stop();
    else if (game === 'mole') MOLE.stop();
  };
})();
