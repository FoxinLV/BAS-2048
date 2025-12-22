const storageKeys = {
  state: "bas2048-state",
  stats: "bas2048-stats",
  leaderboard: "bas2048-leaderboard",
  settings: "bas2048-settings",
};

const defaultSettings = {
  size: 4,
  dark: false,
  assist: true,
  animations: true,
  sounds: false,
  cloudEndpoint: "",
};

const defaultStats = {
  gamesPlayed: 0,
  bestScore: 0,
  bestTile: 0,
  streak: 0,
  maxStreak: 0,
};

const dom = {};
let settings = { ...defaultSettings };
let stats = { ...defaultStats };
let leaderboard = [];
let game;
let historyStack = [];
let audioCtx = null;

class SeededRandom {
  constructor(seed) {
    this.seed = typeof seed === "number" ? seed : hashSeed(seed);
  }
  next() {
    // mulberry32
    let t = (this.seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}

class Tile {
  constructor(value, row, col) {
    this.id = Tile.nextId++;
    this.value = value;
    this.row = row;
    this.col = col;
    this.merged = false;
    this.prev = null;
  }
}

Tile.nextId = 1;

class Game2048 {
  constructor(size = 4, seed) {
    this.size = size;
    this.seed = seed || randomSeed();
    this.rng = new SeededRandom(this.seed);
    this.grid = [];
    this.score = 0;
    this.over = false;
    this.won = false;
    this.cachedValue = undefined;
    this.counted = false;
    this.reset();
  }

  reset() {
    this.grid = this.empty();
    this.score = 0;
    this.over = false;
    this.won = false;
    this.cachedValue = undefined;
    this.counted = false;
    this.addRandomTile();
    this.addRandomTile();
  }

  empty() {
    return Array.from({ length: this.size }, () => Array.from({ length: this.size }, () => null));
  }

  random() {
    return this.rng.next();
  }

  peekNextValue() {
    if (this.cachedValue !== undefined) return this.cachedValue;
    const value = this.random() < 0.9 ? 2 : 4;
    this.cachedValue = value;
    return value;
  }

  consumeNextValue() {
    if (this.cachedValue !== undefined) {
      const value = this.cachedValue;
      this.cachedValue = undefined;
      return value;
    }
    return this.random() < 0.9 ? 2 : 4;
  }

  addRandomTile() {
    const cells = this.availableCells();
    if (!cells.length) return false;
    const value = this.consumeNextValue();
    const cell = cells[Math.floor(this.random() * cells.length)];
    this.insertTile(new Tile(value, cell.row, cell.col));
    return true;
  }

  availableCells() {
    const cells = [];
    for (let r = 0; r < this.size; r++) {
      for (let c = 0; c < this.size; c++) {
        if (!this.grid[r][c]) cells.push({ row: r, col: c });
      }
    }
    return cells;
  }

  cellContent(cell) {
    if (this.withinBounds(cell)) {
      return this.grid[cell.row][cell.col];
    }
    return null;
  }

  withinBounds(cell) {
    return cell.row >= 0 && cell.row < this.size && cell.col >= 0 && cell.col < this.size;
  }

  insertTile(tile) {
    this.grid[tile.row][tile.col] = tile;
  }

  prepareTiles() {
    for (let r = 0; r < this.size; r++) {
      for (let c = 0; c < this.size; c++) {
        const tile = this.grid[r][c];
        if (tile) {
          tile.merged = false;
          tile.prev = { row: tile.row, col: tile.col };
        }
      }
    }
  }

  buildTraversals(vector) {
    const traversals = { rows: [], cols: [] };
    for (let pos = 0; pos < this.size; pos++) {
      traversals.rows.push(pos);
      traversals.cols.push(pos);
    }
    if (vector.row === 1) traversals.rows.reverse();
    if (vector.col === 1) traversals.cols.reverse();
    return traversals;
  }

  findFarthest(cell, vector) {
    let previous;
    do {
      previous = cell;
      cell = { row: previous.row + vector.row, col: previous.col + vector.col };
    } while (this.withinBounds(cell) && !this.cellContent(cell));

    return {
      farthest: previous,
      next: this.withinBounds(cell) ? cell : null,
    };
  }

  movesAvailable() {
    if (this.availableCells().length) return true;
    for (let r = 0; r < this.size; r++) {
      for (let c = 0; c < this.size; c++) {
        const tile = this.grid[r][c];
        if (!tile) continue;
        const neighbours = [
          { row: r + 1, col: c },
          { row: r, col: c + 1 },
        ];
        for (const n of neighbours) {
          const other = this.cellContent(n);
          if (other && other.value === tile.value) return true;
        }
      }
    }
    return false;
  }

  getVector(direction) {
    const map = {
      up: { row: -1, col: 0 },
      down: { row: 1, col: 0 },
      left: { row: 0, col: -1 },
      right: { row: 0, col: 1 },
    };
    return map[direction];
  }

  move(direction) {
    const vector = this.getVector(direction);
    if (!vector || this.over) return { moved: false };

    this.prepareTiles();
    const traversals = this.buildTraversals(vector);
    let moved = false;
    let gained = 0;

    traversals.rows.forEach((row) => {
      traversals.cols.forEach((col) => {
        const tile = this.grid[row][col];
        if (!tile) return;

        const positions = this.findFarthest({ row, col }, vector);
        const next = positions.next && this.cellContent(positions.next);

        if (next && next.value === tile.value && !next.merged) {
          const merged = new Tile(tile.value * 2, positions.next.row, positions.next.col);
          merged.merged = true;

          this.grid[row][col] = null;
          this.grid[positions.next.row][positions.next.col] = merged;

          this.score += merged.value;
          gained += merged.value;
          if (merged.value >= 2048) this.won = true;
          moved = true;
        } else {
          if (positions.farthest.row !== row || positions.farthest.col !== col) {
            this.grid[row][col] = null;
            tile.row = positions.farthest.row;
            tile.col = positions.farthest.col;
            this.grid[tile.row][tile.col] = tile;
            moved = true;
          }
        }
      });
    });

    if (moved) {
      this.addRandomTile();
      if (!this.movesAvailable()) this.over = true;
    }

    return { moved, gained, score: this.score, over: this.over, won: this.won };
  }

  snapshot() {
    return {
      size: this.size,
      seed: this.seed,
      rngSeed: this.rng.seed,
      cachedValue: this.cachedValue,
      score: this.score,
      grid: this.grid.map((row) => row.map((t) => (t ? t.value : 0))),
      over: this.over,
      won: this.won,
      counted: this.counted,
    };
  }

  loadSnapshot(snapshot) {
    this.size = snapshot.size;
    this.seed = snapshot.seed;
    this.rng = new SeededRandom(snapshot.rngSeed ?? this.seed);
    this.score = snapshot.score;
    this.over = snapshot.over;
    this.won = snapshot.won;
    this.cachedValue = snapshot.cachedValue;
    this.counted = snapshot.counted ?? false;
    this.grid = this.empty();
    for (let r = 0; r < this.size; r++) {
      for (let c = 0; c < this.size; c++) {
        const val = snapshot.grid[r][c];
        if (val) this.insertTile(new Tile(val, r, c));
      }
    }
  }
}

function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function randomSeed() {
  return Math.random().toString(36).slice(2, 10);
}

function ensureAudio() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    audioCtx = new Ctx();
  }
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

function playTone(frequency = 440, duration = 0.12) {
  if (!settings.sounds) return;
  const ctx = ensureAudio();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "triangle";
  osc.frequency.value = frequency;
  gain.gain.setValueAtTime(0.001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.16, ctx.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + duration + 0.05);
}

function loadStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

function qs(id) {
  return document.getElementById(id);
}

function setupDom() {
  dom.board = qs("board");
  dom.grid = qs("grid");
  dom.tiles = qs("tiles");
  dom.statusLayer = qs("statusLayer");
  dom.statusCard = qs("statusCard");
  dom.statusTitle = qs("statusTitle");
  dom.statusSub = qs("statusSub");
  dom.scoreValue = qs("scoreValue");
  dom.bestValue = qs("bestValue");
  dom.streakValue = qs("streakValue");
  dom.nextTile = qs("nextTile");
  dom.sizeRange = qs("sizeRange");
  dom.sizeLabel = qs("sizeLabel");
  dom.assistToggle = qs("assistToggle");
  dom.darkToggle = qs("darkToggle");
  dom.animToggle = qs("animToggle");
  dom.soundToggle = qs("soundToggle");
  dom.nickname = qs("nicknameInput");
  dom.leaderboard = qs("leaderboard");
  dom.summaryList = qs("summaryList");
  dom.shareLink = qs("shareLink");
}

function renderGrid(size) {
  dom.board.style.setProperty("--size", size);
  dom.grid.innerHTML = "";
  dom.board.setAttribute("data-size", size);
  const fragment = document.createDocumentFragment();
  for (let i = 0; i < size * size; i++) {
    const cell = document.createElement("div");
    cell.className = "cell";
    fragment.appendChild(cell);
  }
  dom.grid.appendChild(fragment);
}

function renderTiles(animate = true) {
  dom.tiles.innerHTML = "";
  const fragment = document.createDocumentFragment();
  for (let r = 0; r < game.size; r++) {
    for (let c = 0; c < game.size; c++) {
      const tile = game.grid[r][c];
      if (!tile) continue;
      const el = document.createElement("div");
      el.className = "tile";
      el.dataset.value = tile.value;
      el.textContent = tile.value;
      el.style.setProperty("--x", tile.col);
      el.style.setProperty("--y", tile.row);
      if (animate && settings.animations) {
        el.classList.add("pop");
      }
      fragment.appendChild(el);
    }
  }
  dom.tiles.appendChild(fragment);
}

function currentMaxTile() {
  let max = 0;
  for (let r = 0; r < game.size; r++) {
    for (let c = 0; c < game.size; c++) {
      const tile = game.grid[r][c];
      if (tile) max = Math.max(max, tile.value);
    }
  }
  return max;
}

function updateScoreboard() {
  dom.scoreValue.textContent = game.score;
  stats.bestScore = Math.max(stats.bestScore, game.score);
  dom.bestValue.textContent = stats.bestScore;
  dom.streakValue.textContent = stats.streak;
  saveStorage(storageKeys.stats, stats);
}

function updateNextTile() {
  const next = settings.assist ? game.peekNextValue() : "?";
  dom.nextTile.textContent = next;
}

function updateSummary() {
  const items = [
    `Игр сыграно: ${stats.gamesPlayed}`,
    `Максимальный счет: ${stats.bestScore}`,
    `Лучшая плитка: ${stats.bestTile || 0}`,
    `Максимальная серия побед: ${stats.maxStreak}`,
  ];
  dom.summaryList.innerHTML = items.map((i) => `<li>${i}</li>`).join("");
}

function updateStatusOverlay({ title, sub }) {
  dom.statusTitle.textContent = title;
  dom.statusSub.textContent = sub;
  dom.statusCard.classList.remove("hidden");
  dom.statusCard.classList.add("visible");
}

function hideStatusOverlay() {
  dom.statusCard.classList.remove("visible");
  dom.statusCard.classList.add("hidden");
}

function pushHistory() {
  const snapshot = game.snapshot();
  historyStack.push(snapshot);
  if (historyStack.length > 5) historyStack.shift();
}

function handleMove(dir) {
  const before = game.snapshot();
  const result = game.move(dir);
  if (!result.moved) return;

  historyStack.push(before);
  if (historyStack.length > 5) historyStack.shift();

  renderTiles();
  const maxTile = currentMaxTile();
  stats.bestTile = Math.max(stats.bestTile, maxTile);
  updateScoreboard();
  updateNextTile();

  let counted = false;
  if (result.won && !game.counted) {
    stats.gamesPlayed += 1;
    counted = true;
    game.counted = true;
    stats.streak += 1;
    stats.maxStreak = Math.max(stats.maxStreak, stats.streak);
    stats.bestTile = Math.max(stats.bestTile, maxTile);
    updateStatusOverlay({ title: "Победа!", sub: "Можно продолжить повышать результат." });
  }

  if (result.over && !game.counted) {
    stats.gamesPlayed += 1;
    stats.streak = 0;
    game.counted = true;
    updateStatusOverlay({ title: "Ходов больше нет", sub: "Попробуй еще раз — отмена хода помогает." });
  }

  if (settings.sounds) {
    playTone(result.gained ? 520 : 360, 0.08);
  }

  updateSummary();
  saveCurrentState();
}

function undoMove() {
  const prev = historyStack.pop();
  if (!prev) return;
  game.loadSnapshot(prev);
  renderGrid(game.size);
  renderTiles(false);
  hideStatusOverlay();
  updateScoreboard();
  updateNextTile();
  saveCurrentState();
}

function saveCurrentState() {
  saveStorage(storageKeys.state, { snapshot: game.snapshot(), stats, settings });
}

function restoreState() {
  const saved = loadStorage(storageKeys.state, null);
  if (saved && saved.snapshot) {
    settings = { ...defaultSettings, ...saved.settings };
    stats = { ...defaultStats, ...saved.stats };
    game = new Game2048(saved.snapshot.size, saved.snapshot.seed);
    game.loadSnapshot(saved.snapshot);
    renderGrid(game.size);
    renderTiles(false);
    applySettingsToUI();
    updateScoreboard();
    updateNextTile();
    updateSummary();
    return true;
  }
  return false;
}

function startNewGame({ size, seed, label } = {}) {
  const newSize = size || settings.size;
  settings.size = newSize;
  if (!seed) seed = randomSeed();
  game = new Game2048(newSize, seed);
  historyStack = [];
  renderGrid(newSize);
  renderTiles(false);
  hideStatusOverlay();
  updateNextTile();
  updateScoreboard();
  const maxTile = currentMaxTile();
  stats.bestTile = Math.max(stats.bestTile, maxTile);
  updateSummary();
  updateShareLink(seed);
  dom.sizeRange.value = newSize;
  dom.sizeLabel.textContent = `${newSize}×${newSize}`;
  saveCurrentState();
  if (label) {
    dom.statusTitle.textContent = label;
    dom.statusCard.classList.remove("hidden");
    dom.statusCard.classList.add("visible");
    setTimeout(() => hideStatusOverlay(), 1200);
  }
}

function startDaily() {
  const today = new Date();
  const stamp = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
    today.getDate()
  ).padStart(2, "0")}`;
  const seed = `daily-${stamp}`;
  startNewGame({ seed, label: "Дневное испытание" });
  qs("dailyInfo").textContent = `Семя дня: ${seed}. Поделись ссылкой, чтобы играть на одинаковом поле.`;
}

function applySettingsToUI() {
  dom.assistToggle.checked = settings.assist;
  dom.darkToggle.checked = settings.dark;
  dom.animToggle.checked = settings.animations;
  dom.soundToggle.checked = settings.sounds;
  dom.sizeRange.value = settings.size;
  dom.sizeLabel.textContent = `${settings.size}×${settings.size}`;
  document.body.classList.toggle("light", !settings.dark);
}

function updateShareLink(seed = game?.seed) {
  const url = new URL(window.location.href);
  url.searchParams.set("size", settings.size);
  if (seed) url.searchParams.set("seed", seed);
  const link = url.toString();
  dom.shareLink.value = link;
}

function copyShareLink() {
  navigator.clipboard.writeText(dom.shareLink.value).catch(() => {});
}

function addScoreToLeaderboard(name, score) {
  const entry = {
    name: name || "Гость",
    score,
    size: game.size,
    seed: game.seed,
    ts: Date.now(),
  };
  leaderboard.push(entry);
  leaderboard.sort((a, b) => b.score - a.score);
  leaderboard = leaderboard.slice(0, 20);
  saveStorage(storageKeys.leaderboard, leaderboard);
  renderLeaderboard();
  pushCloudScore(entry);
}

function renderLeaderboard() {
  dom.leaderboard.innerHTML = "";
  if (!leaderboard.length) {
    dom.leaderboard.innerHTML = `<p class="tiny">Пока пусто. Сыграй и добавь результат.</p>`;
    return;
  }
  leaderboard.forEach((row, idx) => {
    const el = document.createElement("div");
    el.className = "leaderboard-row";
    el.innerHTML = `
      <span>#${idx + 1}</span>
      <div>
        <strong>${row.name}</strong>
        <p class="tiny">Счет ${row.score} · ${row.size}×${row.size}${row.seed ? " · " + row.seed : ""}</p>
      </div>
      <span class="tiny">${new Date(row.ts).toLocaleDateString("ru-RU")}</span>
    `;
    dom.leaderboard.appendChild(el);
  });
}

function exportLeaderboard() {
  const blob = new Blob([JSON.stringify(leaderboard, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "leaderboard.json";
  a.click();
  URL.revokeObjectURL(url);
}

function importLeaderboard() {
  const data = prompt("Вставь JSON экспорта рейтинга:");
  if (!data) return;
  try {
    const parsed = JSON.parse(data);
    if (Array.isArray(parsed)) {
      leaderboard = parsed;
      saveStorage(storageKeys.leaderboard, leaderboard);
      renderLeaderboard();
    }
  } catch (e) {
    alert("Не удалось прочитать JSON");
  }
}

async function fetchCloudLeaderboard() {
  if (!settings.cloudEndpoint) return;
  try {
    const res = await fetch(settings.cloudEndpoint, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    if (Array.isArray(data)) {
      leaderboard = mergeLeaderboards(leaderboard, data);
      saveStorage(storageKeys.leaderboard, leaderboard);
      renderLeaderboard();
    }
  } catch (err) {
    console.warn("Не удалось загрузить облачный рейтинг", err);
  }
}

async function pushCloudScore(entry) {
  if (!settings.cloudEndpoint) return;
  try {
    await fetch(settings.cloudEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry),
    });
  } catch (err) {
    console.warn("Не удалось отправить результат в облако", err);
  }
}

function mergeLeaderboards(local, remote) {
  const map = new Map();
  [...local, ...remote].forEach((row) => {
    const key = `${row.name}-${row.size}-${row.seed}-${row.ts}`;
    map.set(key, row);
  });
  return Array.from(map.values()).sort((a, b) => b.score - a.score).slice(0, 30);
}

function configureApi() {
  const value = prompt(
    "URL API рейтинга (GET вернет JSON-массив, POST принимает {name,score,size,seed,ts}). Например, endpoint вашего Supabase/Cloudflare Worker."
  );
  if (value !== null) {
    settings.cloudEndpoint = value.trim();
    saveStorage(storageKeys.settings, settings);
    fetchCloudLeaderboard();
  }
}

function bindControls() {
  document.addEventListener("keydown", (e) => {
    const map = {
      ArrowUp: "up",
      ArrowDown: "down",
      ArrowLeft: "left",
      ArrowRight: "right",
      w: "up",
      s: "down",
      a: "left",
      d: "right",
    };
    if (map[e.key]) {
      e.preventDefault();
      handleMove(map[e.key]);
    }
  });

  let touchStart = null;
  dom.board.addEventListener("touchstart", (e) => {
    touchStart = e.touches[0];
  });
  dom.board.addEventListener("touchend", (e) => {
    if (!touchStart) return;
    const dx = e.changedTouches[0].clientX - touchStart.clientX;
    const dy = e.changedTouches[0].clientY - touchStart.clientY;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    if (Math.max(absX, absY) < 16) return;
    if (absX > absY) {
      handleMove(dx > 0 ? "right" : "left");
    } else {
      handleMove(dy > 0 ? "down" : "up");
    }
    touchStart = null;
  });

  qs("newGameBtn").addEventListener("click", () => startNewGame());
  qs("undoBtn").addEventListener("click", undoMove);
  qs("dailyBtn").addEventListener("click", startDaily);
  qs("continueBtn").addEventListener("click", () => {
    game.over = false;
    game.won = false;
    hideStatusOverlay();
  });
  qs("resetBtn").addEventListener("click", () => startNewGame());
  dom.sizeRange.addEventListener("input", (e) => {
    const val = Number(e.target.value);
    dom.sizeLabel.textContent = `${val}×${val}`;
  });
  dom.sizeRange.addEventListener("change", (e) => {
    const val = Number(e.target.value);
    settings.size = val;
    saveStorage(storageKeys.settings, settings);
    startNewGame({ size: val });
  });
  dom.assistToggle.addEventListener("change", (e) => {
    settings.assist = e.target.checked;
    saveStorage(storageKeys.settings, settings);
    updateNextTile();
  });
  dom.darkToggle.addEventListener("change", (e) => {
    settings.dark = e.target.checked;
    document.body.classList.toggle("light", !settings.dark);
    saveStorage(storageKeys.settings, settings);
  });
  dom.animToggle.addEventListener("change", (e) => {
    settings.animations = e.target.checked;
    saveStorage(storageKeys.settings, settings);
  });
  dom.soundToggle.addEventListener("change", (e) => {
    settings.sounds = e.target.checked;
    saveStorage(storageKeys.settings, settings);
  });
  qs("submitScoreBtn").addEventListener("click", () => {
    addScoreToLeaderboard(dom.nickname.value.trim() || "Гость", game.score);
  });
  qs("refreshLbBtn").addEventListener("click", () => {
    renderLeaderboard();
    fetchCloudLeaderboard();
  });
  qs("configureApiBtn").addEventListener("click", configureApi);
  qs("exportBtn").addEventListener("click", exportLeaderboard);
  qs("importBtn").addEventListener("click", importLeaderboard);
  qs("copyShareBtn").addEventListener("click", copyShareLink);
}

function loadLeaderboard() {
  leaderboard = loadStorage(storageKeys.leaderboard, []);
  renderLeaderboard();
}

function initFromURL(params = new URLSearchParams(window.location.search)) {
  const sizeParam = Number(params.get("size"));
  const seed = params.get("seed");
  if (sizeParam && sizeParam >= 3 && sizeParam <= 6) {
    settings.size = sizeParam;
  }
  applySettingsToUI();
  startNewGame({ size: settings.size, seed: seed || undefined });
  if (seed) {
    qs("dailyInfo").textContent = `Игра по ссылке с семенем: ${seed}`;
  }
}

function init() {
  setupDom();
  settings = { ...defaultSettings, ...loadStorage(storageKeys.settings, {}) };
  stats = { ...defaultStats, ...loadStorage(storageKeys.stats, {}) };
  leaderboard = loadStorage(storageKeys.leaderboard, []);
  applySettingsToUI();
  bindControls();
  loadLeaderboard();
  const params = new URLSearchParams(window.location.search);
  const hasSharedSeed = params.has("seed") || params.has("size");
  const restored = !hasSharedSeed && restoreState();
  if (!restored) {
    initFromURL(params);
  }
  fetchCloudLeaderboard();
  updateSummary();
  updateShareLink(game.seed);
}

document.addEventListener("DOMContentLoaded", init);
