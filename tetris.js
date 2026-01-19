const storageKeys = {
  state: "bas2048-tetris-state",
  stats: "bas2048-tetris-stats",
  settings: "bas2048-tetris-settings",
};

const defaultStats = {
  gamesPlayed: 0,
  bestScore: 0,
  bestTile: 0,
};

const defaultSettings = {
  dark: false,
};

const rows = 16;
const cols = 10;
const dropIntervalMs = 700;

const shapes = [
  { name: "I", cells: [[0, 1], [1, 1], [2, 1], [3, 1]] },
  { name: "J", cells: [[0, 0], [0, 1], [1, 1], [2, 1]] },
  { name: "L", cells: [[2, 0], [0, 1], [1, 1], [2, 1]] },
  { name: "O", cells: [[1, 0], [2, 0], [1, 1], [2, 1]] },
  { name: "S", cells: [[1, 0], [2, 0], [0, 1], [1, 1]] },
  { name: "T", cells: [[1, 0], [0, 1], [1, 1], [2, 1]] },
  { name: "Z", cells: [[0, 0], [1, 0], [1, 1], [2, 1]] },
].map((shape) => ({ ...shape, rotations: buildRotations(shape.cells) }));

const dom = {};
let grid = createEmptyGrid();
let stats = { ...defaultStats };
let settings = { ...defaultSettings };
let current = null;
let next = null;
let score = 0;
let linesCleared = 0;
let paused = false;
let over = false;
let tickTimer = null;

function createEmptyGrid() {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => null));
}

function buildRotations(cells) {
  const rotations = [cells];
  for (let i = 1; i < 4; i += 1) {
    rotations.push(rotateCells(rotations[i - 1]));
  }
  return rotations;
}

function rotateCells(cells) {
  const rotated = cells.map(([x, y]) => [y, -x]);
  const minX = Math.min(...rotated.map(([x]) => x));
  const minY = Math.min(...rotated.map(([, y]) => y));
  return rotated.map(([x, y]) => [x - minX, y - minY]);
}

function randomValue() {
  return Math.random() < 0.9 ? 2 : 4;
}

function createPiece() {
  const shapeIndex = Math.floor(Math.random() * shapes.length);
  return {
    shapeIndex,
    rotation: 0,
    row: 0,
    col: 0,
    value: randomValue(),
  };
}

function pieceCells(piece, rotation = piece.rotation) {
  const shape = shapes[piece.shapeIndex];
  const cells = shape.rotations[rotation];
  return cells.map(([x, y]) => ({ r: piece.row + y, c: piece.col + x }));
}

function pieceWidth(piece, rotation = piece.rotation) {
  const shape = shapes[piece.shapeIndex];
  const cells = shape.rotations[rotation];
  return Math.max(...cells.map(([x]) => x)) + 1;
}

function canPlace(piece, rowOffset = 0, colOffset = 0, rotation = piece.rotation) {
  const testPiece = {
    ...piece,
    row: piece.row + rowOffset,
    col: piece.col + colOffset,
  };
  return pieceCells(testPiece, rotation).every(({ r, c }) => {
    return r >= 0 && r < rows && c >= 0 && c < cols && !grid[r][c];
  });
}

function spawnPiece() {
  current = next || createPiece();
  next = createPiece();
  current.rotation = 0;
  current.row = 0;
  current.col = Math.floor((cols - pieceWidth(current)) / 2);
  if (!canPlace(current)) {
    handleGameOver();
  }
}

function placePiece(piece) {
  pieceCells(piece).forEach(({ r, c }) => {
    grid[r][c] = piece.value;
  });
}

function applyMergeAndGravity() {
  let gained = 0;
  for (let c = 0; c < cols; c += 1) {
    const values = [];
    for (let r = rows - 1; r >= 0; r -= 1) {
      if (grid[r][c]) values.push(grid[r][c]);
    }
    const merged = [];
    for (let i = 0; i < values.length; i += 1) {
      if (values[i] === values[i + 1]) {
        const value = values[i] * 2;
        merged.push(value);
        gained += value;
        i += 1;
      } else {
        merged.push(values[i]);
      }
    }
    for (let r = rows - 1, idx = 0; r >= 0; r -= 1, idx += 1) {
      grid[r][c] = merged[idx] || null;
    }
  }
  score += gained;
}

function clearLines() {
  let cleared = 0;
  for (let r = rows - 1; r >= 0; r -= 1) {
    if (grid[r].every((value) => value)) {
      grid.splice(r, 1);
      grid.unshift(Array.from({ length: cols }, () => null));
      cleared += 1;
      r += 1;
    }
  }
  if (cleared) {
    linesCleared += cleared;
    score += cleared * 100;
  }
}

function lockPiece() {
  if (!current) return;
  placePiece(current);
  applyMergeAndGravity();
  clearLines();
  updateBestStats();
  spawnPiece();
}

function updateBestStats() {
  stats.bestScore = Math.max(stats.bestScore, score);
  stats.bestTile = Math.max(stats.bestTile, currentMaxTile());
  saveStorage(storageKeys.stats, stats);
}

function currentMaxTile() {
  let max = 0;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      if (grid[r][c]) max = Math.max(max, grid[r][c]);
    }
  }
  return max;
}

function movePiece(rowOffset, colOffset) {
  if (!current || over || paused) return;
  if (canPlace(current, rowOffset, colOffset)) {
    current.row += rowOffset;
    current.col += colOffset;
    render();
    saveState();
  } else if (rowOffset === 1 && colOffset === 0) {
    lockPiece();
    render();
    saveState();
  }
}

function rotatePiece() {
  if (!current || over || paused) return;
  const nextRotation = (current.rotation + 1) % 4;
  if (canPlace(current, 0, 0, nextRotation)) {
    current.rotation = nextRotation;
    render();
    saveState();
    return;
  }
  const kicks = [-1, 1, -2, 2];
  for (const offset of kicks) {
    if (canPlace(current, 0, offset, nextRotation)) {
      current.rotation = nextRotation;
      current.col += offset;
      render();
      saveState();
      return;
    }
  }
}

function hardDrop() {
  if (!current || over || paused) return;
  while (canPlace(current, 1, 0)) {
    current.row += 1;
  }
  lockPiece();
  render();
  saveState();
}

function tick() {
  if (paused || over) return;
  movePiece(1, 0);
}

function startLoop() {
  stopLoop();
  tickTimer = setInterval(tick, dropIntervalMs);
}

function stopLoop() {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = null;
}

function togglePause() {
  if (over) return;
  paused = !paused;
  dom.pauseBtn.textContent = paused ? "Продолжить" : "Пауза";
  if (paused) {
    stopLoop();
  } else {
    startLoop();
  }
  saveState();
}

function resetGame() {
  grid = createEmptyGrid();
  score = 0;
  linesCleared = 0;
  paused = false;
  over = false;
  dom.pauseBtn.textContent = "Пауза";
  hideStatus();
  next = createPiece();
  spawnPiece();
  startLoop();
  render();
  saveState();
}

function handleGameOver() {
  over = true;
  stopLoop();
  stats.gamesPlayed += 1;
  saveStorage(storageKeys.stats, stats);
  showStatus("Игра окончена", "Начни заново и попробуй новый рекорд.");
}

function updateSummary() {
  const items = [
    `Сыграно игр: ${stats.gamesPlayed}`,
    `Лучший счет: ${stats.bestScore}`,
    `Лучший тайл: ${stats.bestTile}`,
    `Линий очищено: ${linesCleared}`,
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

function render() {
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const cell = dom.cells[r][c];
      const value = grid[r][c];
      if (value) {
        cell.textContent = value;
        cell.dataset.value = value;
      } else {
        cell.textContent = "";
        cell.removeAttribute("data-value");
      }
    }
  }

  if (current && !over) {
    pieceCells(current).forEach(({ r, c }) => {
      if (r < 0 || r >= rows || c < 0 || c >= cols) return;
      const cell = dom.cells[r][c];
      cell.textContent = current.value;
      cell.dataset.value = current.value;
    });
  }

  dom.scoreValue.textContent = score;
  dom.bestValue.textContent = stats.bestScore;
  dom.maxValue.textContent = currentMaxTile();
  dom.linesValue.textContent = linesCleared;
  dom.nextValue.textContent = next ? next.value : "?";
  dom.nextShape.textContent = `Фигура: ${next ? shapes[next.shapeIndex].name : "-"}`;
  updateSummary();
}

function buildBoard() {
  dom.board.innerHTML = "";
  dom.cells = [];
  for (let r = 0; r < rows; r += 1) {
    const row = [];
    for (let c = 0; c < cols; c += 1) {
      const cell = document.createElement("div");
      cell.className = "tetris-cell";
      dom.board.appendChild(cell);
      row.push(cell);
    }
    dom.cells.push(row);
  }
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

function saveState() {
  const state = {
    grid,
    score,
    linesCleared,
    paused,
    over,
    current,
    next,
  };
  saveStorage(storageKeys.state, { state, stats, settings });
}

function restoreState() {
  const saved = loadStorage(storageKeys.state, null);
  if (!saved || !saved.state) return false;
  settings = { ...defaultSettings, ...saved.settings };
  stats = { ...defaultStats, ...saved.stats };
  grid = saved.state.grid || createEmptyGrid();
  score = saved.state.score || 0;
  linesCleared = saved.state.linesCleared || 0;
  paused = saved.state.paused || false;
  over = saved.state.over || false;
  current = saved.state.current || null;
  next = saved.state.next || createPiece();
  if (!current && !over) {
    spawnPiece();
  }
  applySettings();
  render();
  if (over) {
    showStatus("Игра окончена", "Начни заново и попробуй новый рекорд.");
  } else if (!paused) {
    startLoop();
  }
  dom.pauseBtn.textContent = paused ? "Продолжить" : "Пауза";
  return true;
}

function applySettings() {
  dom.darkToggle.checked = settings.dark;
  document.body.classList.toggle("dark", settings.dark);
}

function setupDom() {
  dom.board = document.getElementById("tetrisBoard");
  dom.scoreValue = document.getElementById("tetrisScoreValue");
  dom.bestValue = document.getElementById("tetrisBestValue");
  dom.maxValue = document.getElementById("tetrisMaxValue");
  dom.linesValue = document.getElementById("tetrisLinesValue");
  dom.nextValue = document.getElementById("tetrisNextValue");
  dom.nextShape = document.getElementById("tetrisNextShape");
  dom.summaryList = document.getElementById("tetrisSummaryList");
  dom.statusCard = document.getElementById("tetrisStatusCard");
  dom.statusTitle = document.getElementById("tetrisStatusTitle");
  dom.statusSub = document.getElementById("tetrisStatusSub");
  dom.pauseBtn = document.getElementById("tetrisPauseBtn");
  dom.darkToggle = document.getElementById("tetrisDarkToggle");
}

function bindControls() {
  document.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      movePiece(0, -1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      movePiece(0, 1);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      movePiece(1, 0);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      rotatePiece();
    } else if (e.key === " ") {
      e.preventDefault();
      hardDrop();
    } else if (e.key.toLowerCase() === "p") {
      e.preventDefault();
      togglePause();
    }
  });

  dom.pauseBtn.addEventListener("click", togglePause);
  document.getElementById("tetrisNewBtn").addEventListener("click", resetGame);
  document.getElementById("tetrisRestartBtn").addEventListener("click", resetGame);

  dom.darkToggle.addEventListener("change", (e) => {
    settings.dark = e.target.checked;
    document.body.classList.toggle("dark", settings.dark);
    saveStorage(storageKeys.settings, settings);
  });
}

function init() {
  setupDom();
  buildBoard();
  stats = { ...defaultStats, ...loadStorage(storageKeys.stats, {}) };
  settings = { ...defaultSettings, ...loadStorage(storageKeys.settings, {}) };
  next = createPiece();
  applySettings();
  bindControls();
  if (!restoreState()) {
    resetGame();
  }
}

document.addEventListener("DOMContentLoaded", init);
