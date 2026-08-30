/* ==========================================================
   Точка входа. Здесь всё соединяется:
   мир + Ковшик + задание + интерфейс + сохранение прогресса.
   ========================================================== */

import './style.css';
import { World } from './scene.js';
import { Excavator } from './excavator.js';
import { DigLetterTask } from './task-dig-letter.js';
import { voice } from './voice.js';
import { sfx } from './sfx.js';

// Порядок букв в срезе. Дальше это переедет в JSON с уровнями.
const LETTER_SEQUENCE = ['А', 'О', 'С', 'У', 'М'];

// ---------- Сохранение прогресса ----------
// Всё живёт в памяти самого iPad, никуда не отправляется.

const SAVE_KEY = 'sofia-city-save-v1';

function loadSave() {
  try {
    return JSON.parse(localStorage.getItem(SAVE_KEY)) || {};
  } catch { return {}; }
}
function saveState() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch { /* приватный режим */ }
}

const saved = loadSave();
const state = {
  coins: saved.coins || 0,
  stickers: saved.stickers || [],
  letterIndex: saved.letterIndex || 0,
  muted: saved.muted || false,
};

// ---------- Интерфейс ----------

const $ = (id) => document.getElementById(id);
const ui = {
  coins: $('coins'),
  coinsValue: $('coins-value'),
  taskText: $('task-text'),
  btnSound: $('btn-sound'),
  btnRepeat: $('btn-repeat'),
  btnStart: $('btn-start'),
  btnAgain: $('btn-again'),
  overlayStart: $('overlay-start'),
  overlayWin: $('overlay-win'),
  overlayRotate: $('overlay-rotate'),
  winSticker: $('win-sticker'),
};

function renderCoins(bump = false) {
  ui.coinsValue.textContent = state.coins;
  if (bump) {
    ui.coins.classList.remove('bump');
    void ui.coins.offsetWidth;   // перезапуск анимации
    ui.coins.classList.add('bump');
  }
}

function renderSoundButton() {
  ui.btnSound.textContent = state.muted ? '🔇' : '🔊';
  ui.btnSound.classList.toggle('off', state.muted);
}

// Просьбу повернуть показываем только на планшете/телефоне.
// На компьютере окно бывает узким — и это не повод мешать игре.
const IS_TOUCH = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

function checkOrientation() {
  const portrait = window.innerHeight > window.innerWidth;
  ui.overlayRotate.classList.toggle('hidden', !(portrait && IS_TOUCH));
}

// ---------- Мир ----------

const world = new World(document.getElementById('scene'));
const excavator = new Excavator();
world.scene.add(excavator.group);

let task = null;

function startTask() {
  if (task) task.dispose();
  const key = LETTER_SEQUENCE[state.letterIndex % LETTER_SEQUENCE.length];

  task = new DigLetterTask(world, excavator, key, {
    onWin: (letter) => {
      state.coins += 1;
      if (!state.stickers.includes(letter.name)) state.stickers.push(letter.name);
      state.letterIndex += 1;
      saveState();
      renderCoins(true);
      sfx.coin();
      ui.winSticker.textContent = letter.name;
      ui.overlayWin.classList.remove('hidden');
    },
    onHouseReady: () => {
      ui.taskText.textContent = 'Коснись экрана, чтобы продолжить';
    },
  });

  ui.taskText.textContent = `Выкопай букву ${key} — веди пальчиком по дорожке`;
  // Управление открывается только когда Ковшик договорит — иначе кажется,
  // что трактор срывается с места раньше, чем понятно, что делать
  voice.sayThen('task.dig', () => task.unlock(), key);
}

world.onUpdate((dt, t) => {
  if (task) task.update(dt, t);
});

// ---------- Палец ----------

const canvas = document.getElementById('scene');
canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  canvas.setPointerCapture(e.pointerId);
  if (task) task.onPointerDown(e.clientX, e.clientY);
});
canvas.addEventListener('pointermove', (e) => {
  e.preventDefault();
  if (task) task.onPointerMove(e.clientX, e.clientY);
});
canvas.addEventListener('pointerup', () => { if (task) task.onPointerUp(); });
canvas.addEventListener('pointercancel', () => { if (task) task.onPointerUp(); });
// Safari на iPad иначе показывает лупу и выделение при долгом нажатии
canvas.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
canvas.addEventListener('gesturestart', (e) => e.preventDefault());

// ---------- Кнопки ----------

ui.btnStart.addEventListener('click', () => {
  // Первое касание: только здесь iPad разрешает включить звук
  sfx.init();
  voice.init();
  sfx.setMuted(state.muted);
  voice.setMuted(state.muted);

  ui.overlayStart.classList.add('hidden');
  // Раньше startTask() запускался через фиксированные 2.2с — если Ковшик
  // говорил дольше или короче, задание стартовало не в такт с речью.
  // Теперь ждём реального конца фразы.
  voice.sayThen('start', startTask);
});

ui.btnAgain.addEventListener('click', () => {
  ui.overlayWin.classList.add('hidden');
  startTask();
});

ui.btnSound.addEventListener('click', () => {
  state.muted = !state.muted;
  sfx.setMuted(state.muted);
  voice.setMuted(state.muted);
  renderSoundButton();
  saveState();
});

ui.btnRepeat.addEventListener('click', () => {
  if (!task || task.finished) return;
  voice.say('task.dig', task.letter.name);
});

// ---------- Поехали ----------

renderCoins();
renderSoundButton();
checkOrientation();
window.addEventListener('resize', checkOrientation);
window.addEventListener('orientationchange', () => setTimeout(checkOrientation, 250));

window.__gameAlive = true;   // сигнал аварийному экрану: всё загрузилось
world.start();
