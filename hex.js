const storageKeys = {
  state: "bas2048-hex-state",
  stats: "bas2048-hex-stats",
  settings: "bas2048-hex-settings",
};

const defaultStats = {
  gamesPlayed: 0,
  bestScore: 0,
  bestTile: 0,
};

const defaultSettings = {
  size: 2,
  dark: false,
  assist: true,
};

const valueChance = 0.9;
const historyLimit = 5;
let radius = defaultSettings.size;
let coords = [];
let coordKeys = [];
let linesByDir = {};
const cellNodes = new Map();

const dom = {};
let game;
let stats = { ...defaultStats };
let settings = { ...defaultSettings };
let historyStack = [];
let moveCount = 0;

function rebuildGeometry(size) {
  radius = size;
  coords = buildCoords(radius);
  coordKeys = coords.map((cell) => keyOf(cell));
  linesByDir = buildLines(coords);
}

class HexGame {
  constructor() {
    this.grid = new Map();
    this.score = 0;
    this.over = false;
    this.won = false;
    this.cachedValue = undefined;
    this.counted = false;
    this.reset();
  }

  reset() {
    this.grid = new Map();
    coordKeys.forEach((key) => this.grid.set(key, null));
    this.score = 0;
    this.over = false;
    this.won = false;
    this.cachedValue = undefined;
    this.counted = false;
    moveCount = 0;
    this.addRandomTile();
    this.addRandomTile();
  }

  peekNextValue() {
    if (this.cachedValue !== undefined) return this.cachedValue;
    const value = Math.random() < valueChance ? 2 : 4;
    this.cachedValue = value;
    return value;
  }

  consumeNextValue() {
    if (this.cachedValue !== undefined) {
      const value = this.cachedValue;
      this.cachedValue = undefined;
      return value;
    }
    return Math.random() < valueChance ? 2 : 4;
  }

  availableCells() {
    const cells = [];
    coordKeys.forEach((key) => {
      if (!this.grid.get(key)) cells.push(key);
    });
    return cells;
  }

  addRandomTile() {
    const cells = this.availableCells();
    if (!cells.length) return false;
    const value = this.consumeNextValue();
    const idx = Math.floor(Math.random() * cells.length);
    this.grid.set(cells[idx], value);
    return true;
  }

  movesAvailable() {
    if (this.availableCells().length) return true;
    for (const cell of coords) {
      const key = keyOf(cell);
      const value = this.grid.get(key);
      if (!value) continue;
      for (const dir of neighbourDirs) {
        const nextKey = keyOf({ q: cell.q + dir.q, r: cell.r + dir.r });
        if (!this.grid.has(nextKey)) continue;
        const nextValue = this.grid.get(nextKey);
        if (nextValue === value) return true;
      }
    }
    return false;
  }

  move(direction) {
    if (this.over) return { moved: false };
    const lines = linesByDir[direction];
    if (!lines) return { moved: false };
    let moved = false;
    let gained = 0;

    lines.forEach((line) => {
      const oldValues = line.map((key) => this.grid.get(key));
      const compact = oldValues.filter((val) => val !== null);
      const merged = [];
      for (let i = 0; i < compact.length; i += 1) {
        if (compact[i] === compact[i + 1]) {
          const value = compact[i] * 2;
          merged.push(value);
          gained += value;
          if (value >= 2048) this.won = true;
          i += 1;
        } else {
          merged.push(compact[i]);
        }
      }
      while (merged.length < line.length) merged.push(null);
      for (let i = 0; i < line.length; i += 1) {
        if (oldValues[i] !== merged[i]) moved = true;
        this.grid.set(line[i], merged[i]);
      }
    });

    if (moved) {
      this.score += gained;
      this.addRandomTile();
      moveCount += 1;
      if (!this.movesAvailable()) this.over = true;
    }

    return { moved, gained, score: this.score, over: this.over, won: this.won };
  }

  snapshot() {
    return {
      size: radius,
      score: this.score,
      over: this.over,
      won: this.won,
      cachedValue: this.cachedValue,
      counted: this.counted,
      moveCount,
      grid: coordKeys.map((key) => this.grid.get(key) || 0),
    };
  }

  loadSnapshot(snapshot) {
    this.score = snapshot.score || 0;
    this.over = snapshot.over || false;
    this.won = snapshot.won || false;
    this.cachedValue = snapshot.cachedValue;
    this.counted = snapshot.counted || false;
    moveCount = snapshot.moveCount || 0;
    this.grid = new Map();
    coordKeys.forEach((key, idx) => {
      const value = snapshot.grid?.[idx] || 0;
      this.grid.set(key, value || null);
    });
  }
}

function keyOf(cell) {
  return `${cell.q},${cell.r}`;
}

function buildCoords(size) {
  const cells = [];
  for (let r = -size; r <= size; r += 1) {
    const qMin = Math.max(-size, -r - size);
    const qMax = Math.min(size, -r + size);
    for (let q = qMin; q <= qMax; q += 1) {
      cells.push({ q, r });
    }
  }
  return cells;
}

const neighbourDirs = [
  { q: 1, r: 0 },
  { q: -1, r: 0 },
  { q: 1, r: -1 },
  { q: -1, r: 1 },
  { q: 0, r: -1 },
  { q: 0, r: 1 },
];

function buildLines(cells) {
  const definitions = {
    e: { axis: "r", sort: (a, b) => b.q - a.q },
    w: { axis: "r", sort: (a, b) => a.q - b.q },
    ne: { axis: "s", sort: (a, b) => b.q - a.q },
    sw: { axis: "s", sort: (a, b) => a.q - b.q },
    nw: { axis: "q", sort: (a, b) => a.r - b.r },
    se: { axis: "q", sort: (a, b) => b.r - a.r },
  };

  const lines = {};
  Object.entries(definitions).forEach(([dir, def]) => {
    const groups = new Map();
    cells.forEach((cell) => {
      const axisValue =
        def.axis === "q" ? cell.q : def.axis === "r" ? cell.r : -cell.q - cell.r;
      if (!groups.has(axisValue)) groups.set(axisValue, []);
      groups.get(axisValue).push(cell);
    });
    const lineList = [];
    groups.forEach((group) => {
      group.sort(def.sort);
      lineList.push(group.map((cell) => keyOf(cell)));
    });
    lines[dir] = lineList;
  });
  return lines;
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

function setupDom() {
  dom.board = document.getElementById("hexBoard");
  dom.scoreValue = document.getElementById("hexScoreValue");
  dom.bestValue = document.getElementById("hexBestValue");
  dom.maxValue = document.getElementById("hexMaxValue");
  dom.movesValue = document.getElementById("hexMovesValue");
  dom.nextTile = document.getElementById("hexNextTile");
  dom.statusCard = document.getElementById("hexStatusCard");
  dom.statusTitle = document.getElementById("hexStatusTitle");
  dom.statusSub = document.getElementById("hexStatusSub");
  dom.summaryList = document.getElementById("hexSummaryList");
  dom.assistToggle = document.getElementById("hexAssistToggle");
  dom.darkToggle = document.getElementById("hexDarkToggle");
  dom.sizeRange = document.getElementById("hexSizeRange");
  dom.sizeLabel = document.getElementById("hexSizeLabel");
}

function layoutBoard() {
  if (!dom.board) return;
  const style = getComputedStyle(dom.board);
  const min = parseFloat(style.getPropertyValue("--hex-size-min")) || 44;
  const max = parseFloat(style.getPropertyValue("--hex-size-max")) || 68;
  const vw = parseFloat(style.getPropertyValue("--hex-size-vw")) || 8;
  const preferred = window.innerWidth * (vw / 100);
  const width = Math.min(max, Math.max(min, preferred));
  const height = width * 0.866;
  const size = width / 2;
  const vertical = height;
  dom.board.style.setProperty("--hex-size", `${width}px`);
  const positions = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  coords.forEach((cell) => {
    const centerX = size * 1.5 * cell.q;
    const centerY = vertical * (cell.r + cell.q / 2);
    const x = centerX - width / 2;
    const y = centerY - height / 2;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + width);
    maxY = Math.max(maxY, y + height);
    positions.push({ key: keyOf(cell), x, y });
  });

  const pad = Math.max(4, width * 0.06);
  dom.board.style.width = `${maxX - minX + pad * 2}px`;
  dom.board.style.height = `${maxY - minY + pad * 2}px`;
  positions.forEach(({ key, x, y }) => {
    const node = cellNodes.get(key);
    if (!node) return;
    node.style.transform = `translate(${x - minX + pad}px, ${y - minY + pad}px)`;
  });
}

function buildBoard() {
  dom.board.innerHTML = "";
  cellNodes.clear();
  coords.forEach((cell) => {
    const tile = document.createElement("div");
    tile.className = "hex-cell";
    tile.dataset.key = keyOf(cell);
    dom.board.appendChild(tile);
    cellNodes.set(tile.dataset.key, tile);
  });
  requestAnimationFrame(layoutBoard);
}

function renderBoard() {
  cellNodes.forEach((node, key) => {
    const value = game.grid.get(key);
    if (value) {
      node.textContent = value;
      node.dataset.value = value;
    } else {
      node.textContent = "";
      node.removeAttribute("data-value");
    }
  });
}

function currentMaxTile() {
  let max = 0;
  coordKeys.forEach((key) => {
    const value = game.grid.get(key);
    if (value) max = Math.max(max, value);
  });
  return max;
}

function updateScoreboard() {
  dom.scoreValue.textContent = game.score;
  stats.bestScore = Math.max(stats.bestScore, game.score);
  const maxTile = currentMaxTile();
  stats.bestTile = Math.max(stats.bestTile, maxTile);
  dom.bestValue.textContent = stats.bestScore;
  dom.maxValue.textContent = maxTile;
  dom.movesValue.textContent = moveCount;
  saveStorage(storageKeys.stats, stats);
}

function updateNextTile() {
  dom.nextTile.textContent = settings.assist ? game.peekNextValue() : "?";
}

function updateSummary() {
  const items = [
    `Сыграно игр: ${stats.gamesPlayed}`,
    `Лучший счет: ${stats.bestScore}`,
    `Лучший тайл: ${stats.bestTile}`,
  ];
  dom.summaryList.innerHTML = items.map((item) => `<li>${item}</li>`).join("");
}

function showStatus(title, sub) {
  dom.statusTitle.textContent = title;
  dom.statusSub.textContent = sub;
  dom.statusCard.classList.remove("hidden");
  dom.statusCard.classList.add("visible");
}

function hideStatus() {
  dom.statusCard.classList.remove("visible");
  dom.statusCard.classList.add("hidden");
}

function saveState() {
  const snapshot = game.snapshot();
  saveStorage(storageKeys.state, { snapshot, stats, settings });
}

function restoreState() {
  const saved = loadStorage(storageKeys.state, null);
  if (!saved || !saved.snapshot) return false;
  settings = { ...defaultSettings, ...saved.settings };
  stats = { ...defaultStats, ...saved.stats };
  const savedSize = saved.snapshot.size || settings.size || defaultSettings.size;
  settings.size = savedSize;
  rebuildGeometry(savedSize);
  buildBoard();
  game = new HexGame();
  game.loadSnapshot(saved.snapshot);
  applySettings();
  renderBoard();
  updateScoreboard();
  updateNextTile();
  updateSummary();
  if (game.over) {
    showStatus("Ходы закончились", "Попробуй еще раз!");
  } else if (game.won) {
    showStatus("Ты победил!", "Можно продолжать ради рекорда.");
  }
  return true;
}

function applySettings() {
  dom.assistToggle.checked = settings.assist;
  dom.darkToggle.checked = settings.dark;
  dom.sizeRange.value = settings.size;
  dom.sizeLabel.textContent = `R=${settings.size}`;
  document.body.classList.toggle("dark", settings.dark);
}

function handleMove(direction) {
  if (game.over) return;
  const before = game.snapshot();
  const result = game.move(direction);
  if (!result.moved) return;

  historyStack.push(before);
  if (historyStack.length > historyLimit) historyStack.shift();

  renderBoard();
  updateScoreboard();
  updateNextTile();

  if (result.won && !game.counted) {
    stats.gamesPlayed += 1;
    game.counted = true;
    showStatus("Ты победил!", "Продолжай играть ради рекорда.");
    saveStorage(storageKeys.stats, stats);
  }

  if (result.over && !game.counted) {
    stats.gamesPlayed += 1;
    game.counted = true;
    showStatus("Ходы закончились", "Начни новую игру.");
    saveStorage(storageKeys.stats, stats);
  }

  updateSummary();
  saveState();
}

function undoMove() {
  const prev = historyStack.pop();
  if (!prev) return;
  game.loadSnapshot(prev);
  renderBoard();
  updateScoreboard();
  updateNextTile();
  hideStatus();
  saveState();
}

function startNewGame() {
  game.reset();
  historyStack = [];
  hideStatus();
  renderBoard();
  updateNextTile();
  updateScoreboard();
  updateSummary();
  saveState();
}

function handleKey(e) {
  if (e.repeat) return;
  const key = e.key.toLowerCase();
  const map = {
    w: "nw",
    "ц": "nw",
    s: "se",
    "ы": "se",
    a: "sw",
    "ф": "sw",
    d: "e",
    "в": "e",
    q: "w",
    "й": "w",
    e: "ne",
    "у": "ne",
  };
  if (map[key]) {
    e.preventDefault();
    handleMove(map[key]);
  }
}

function handleSwipe(start, end) {
  const dx = end.clientX - start.clientX;
  const dy = end.clientY - start.clientY;
  const dist = Math.hypot(dx, dy);
  if (dist < 20) return;
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  const deg = (angle + 360) % 360;
  let dir = "e";
  if (deg >= 30 && deg < 90) dir = "se";
  else if (deg >= 90 && deg < 150) dir = "sw";
  else if (deg >= 150 && deg < 210) dir = "w";
  else if (deg >= 210 && deg < 270) dir = "nw";
  else if (deg >= 270 && deg < 330) dir = "ne";
  handleMove(dir);
}

function bindControls() {
  document.addEventListener("keydown", handleKey);

  let touchStart = null;
  dom.board.addEventListener("touchstart", (e) => {
    touchStart = e.touches[0];
  });
  dom.board.addEventListener("touchend", (e) => {
    if (!touchStart) return;
    handleSwipe(touchStart, e.changedTouches[0]);
    touchStart = null;
  });

  document.getElementById("hexNewBtn").addEventListener("click", startNewGame);
  document.getElementById("hexUndoBtn").addEventListener("click", undoMove);
  document.getElementById("hexContinueBtn").addEventListener("click", () => {
    game.over = false;
    hideStatus();
  });
  document.getElementById("hexResetBtn").addEventListener("click", startNewGame);

  dom.assistToggle.addEventListener("change", (e) => {
    settings.assist = e.target.checked;
    updateNextTile();
    saveStorage(storageKeys.settings, settings);
  });
  dom.darkToggle.addEventListener("change", (e) => {
    settings.dark = e.target.checked;
    document.body.classList.toggle("dark", settings.dark);
    saveStorage(storageKeys.settings, settings);
  });
  dom.sizeRange.addEventListener("input", (e) => {
    const val = Number(e.target.value);
    dom.sizeLabel.textContent = `R=${val}`;
  });
  dom.sizeRange.addEventListener("change", (e) => {
    const val = Number(e.target.value);
    settings.size = val;
    saveStorage(storageKeys.settings, settings);
    rebuildGeometry(val);
    buildBoard();
    startNewGame();
  });
}

function init() {
  setupDom();
  settings = { ...defaultSettings, ...loadStorage(storageKeys.settings, {}) };
  rebuildGeometry(settings.size);
  buildBoard();
  window.addEventListener("resize", layoutBoard);
  stats = { ...defaultStats, ...loadStorage(storageKeys.stats, {}) };
  game = new HexGame();
  applySettings();
  bindControls();
  if (!restoreState()) {
    startNewGame();
  }
}

document.addEventListener("DOMContentLoaded", init);
