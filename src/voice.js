/* ==========================================================
   Голос заданий.
   Пока не записаны живые файлы — говорит синтез речи браузера.
   Как только по нужному пути появится файл — он используется вместо
   синтеза автоматически, без правок кода. Положить файлы можно
   постепенно, по одному: чего не хватает, там просто звучит синтез.

   Фразы с буквой внутри («буква А», «буква О»...) собраны из кусочков:
   обвязка (один файл на все буквы) + короткий клип с именем буквы
   (LETTER_FILES). Так при добавлении новой буквы достаточно записать
   только её имя — переписывать обвязку не нужно.
   ========================================================== */

// Все реплики игры в одном месте — их удобно править и переводить в аудио
export const PHRASES = {
  'task.dig':      (l) => `София, помоги Ковшику выкопать котлован в форме буквы ${l}!`,
  'stroke.next':   () => 'Молодец! Теперь второй кусочек.',
  'win':           (l) => `Ура! Буква ${l} готова! Смотри, какой дом вырос!`,
  // Пока дом один на все буквы — описание тоже одно. Когда для каждой
  // буквы сделаем свой дом, у каждого будет своя фраза-описание.
  'house.default': () => 'Смотри, какой получился домик! Стены светлые, крыша красная, а окошки синие, как небо.',
  'hint':          () => 'Веди пальчиком по дорожке.',
  'start':         () => 'Привет, София! Я Ковшик. Поехали работать!',
};

// mp3 вместо m4a: на iPad та же самая запись через <audio> падала с
// «no supported source», хотя Content-Type был верный (audio/mp4) —
// mp3 не даёт такой неопределённости ни в одном браузере.
//
// Версия — прямо в имени файла (не через ?v=...): у сервера кеш на звук
// 10 минут, а вопросительный знак в адресе аудио на старом Safari сам
// по себе иногда мешает распознать формат. Бампить суффикс -vN при
// каждой замене содержимого звуковых файлов.
const VOICE_VERSION = 'v5';
const v = (path) => path.replace(/\.mp3$/, `-${VOICE_VERSION}.mp3`);

// Обычные реплики — целиком один файл. Положить в public/assets/voice/.
const VOICE_FILES = {
  start:           v('assets/voice/start.mp3'),
  'stroke.next':   v('assets/voice/stroke-next.mp3'),
  'house.default': v('assets/voice/house-default.mp3'),
};

// Имя буквы — отдельный короткий клип, переиспользуется в разных фразах
const LETTER_FILES = {
  'А': v('assets/voice/letter-a.mp3'),
  'О': v('assets/voice/letter-o.mp3'),
  'С': v('assets/voice/letter-s.mp3'),
  'У': v('assets/voice/letter-u.mp3'),
  'М': v('assets/voice/letter-m.mp3'),
};

// Фразы с буквой внутри: null — сюда подставится клип буквы из LETTER_FILES
const VOICE_TEMPLATES = {
  'task.dig': [v('assets/voice/task-dig-prefix.mp3'), null],
  win:        [v('assets/voice/win-prefix.mp3'), null, v('assets/voice/win-suffix.mp3')],
};

// Все файлы, что вообще могут понадобиться — для разовой разблокировки разом
const ALL_VOICE_FILES = [
  ...Object.values(VOICE_FILES),
  ...Object.values(LETTER_FILES),
  ...Object.values(VOICE_TEMPLATES).flat().filter(Boolean),
];

// ВРЕМЕННЫЙ отладочный лог — пишет на экран (#voice-debug), если он есть
// в разметке. Нужен, чтобы видеть на самом iPad, что со звуком идёт не
// так, не подключая кабель и Мак. Убрать после того, как звук починим.
function log(msg) {
  const el = document.getElementById('voice-debug');
  if (!el) return;
  const t = new Date().toISOString().slice(11, 19);
  el.textContent = `[${t}] ${msg}\n${el.textContent}`.slice(0, 4000);
}

class Voice {
  constructor() {
    this.muted = false;
    this.ruVoice = null;
    this.ready = false;
    this._audio = null;
    this._pool = new Map();  // путь к файлу → готовый <audio>-элемент
  }

  /** Вызывать только после первого касания экрана — этого требует iPad. */
  init() {
    if (!('speechSynthesis' in window)) return;
    const pick = () => {
      const voices = window.speechSynthesis.getVoices().filter(
        (v) => v.lang && v.lang.toLowerCase().startsWith('ru')
      );
      // Если в Настройках iPad скачан «улучшенный»/«премиум» голос —
      // их у Apple несколько штук с именем длиннее и без слова Milena.
      // Компактный голос по умолчанию звучит роботом, поэтому берём
      // любой другой, если он есть.
      this.ruVoice =
        voices.find((v) => !/milena/i.test(v.name)) || voices[0] || null;
      this.ready = voices.length > 0;
    };
    pick();
    window.speechSynthesis.onvoiceschanged = pick;
  }

  /** Вызывать СИНХРОННО прямо в обработчике нажатия «Играть».
   *  onDone — когда все файлы разблокированы (успешно или нет).
   *
   *  Важное: play() должен быть ВЫЗВАН синхронно, в тот же момент, что
   *  и касание — Safari на iPad засчитывает «жест пользователя» только
   *  для вызовов внутри самого обработчика клика, а не для цепочки
   *  «одно за другим через .then()»: всё, что случилось хоть на тик
   *  позже, Safari отклоняет с «not allowed... user denied permission»,
   *  даже если это тот же самый клик. Поэтому все 11 play() запускаем
   *  разом, одним синхронным проходом — то, что каждый из них решится
   *  (успехом, ошибкой, таймаутом) уже потом, не важно.
   */
  unlockAudioFiles(onDone) {
    const paths = ALL_VOICE_FILES;
    log(`unlock: старт (${paths.length} файлов, разом)`);
    let remaining = paths.length;
    const oneDone = () => { remaining--; if (remaining <= 0) { log('unlock: всё готово'); onDone && onDone(); } };

    for (const path of paths) {
      const short = path.split('/').pop();
      const a = this._getAudio(path);
      const vol = a.volume;
      a.volume = 0;
      let settled = false;
      const finish = (reason) => {
        if (settled) return;
        settled = true;
        a.pause();
        a.currentTime = 0;
        a.volume = vol;
        log(`unlock: ${short} — ${reason}`);
        oneDone();
      };
      a.play().then(() => finish('ок')).catch((e) => finish('ошибка: ' + (e && e.message || e)));
      setTimeout(() => finish('таймаут'), 2000);
    }
  }

  _getAudio(path) {
    let a = this._pool.get(path);
    if (!a) { a = new Audio(path); this._pool.set(path, a); }
    return a;
  }

  /** key — ключ из PHRASES, args — что подставить (например, буква). */
  say(key, ...args) {
    this._speak(key, args);
  }

  /** То же самое, но onDone вызовется, когда реплика договорена.
   *  Нужно, чтобы игрок не мог начать действие, пока Ковшик ещё объясняет. */
  sayThen(key, onDone, ...args) {
    this._speak(key, args, onDone);
  }

  _speak(key, args, onDone) {
    if (this.muted) { onDone && onDone(); return; }
    this.stop();

    const clips = this._resolveClips(key, args[0]);
    log(`say: "${key}"${args[0] ? ' ' + args[0] : ''} → ${clips ? 'живой звук (' + clips.length + ' шт)' : 'синтез'}`);
    if (clips) {
      this._playSequence(clips, onDone, () => this._speakSynth(key, args, onDone));
    } else {
      this._speakSynth(key, args, onDone);
    }
  }

  /** Список файлов для реплики, либо null, если чего-то не хватает —
   *  тогда лучше сказать всю фразу синтезом, чем полуживым голосом. */
  _resolveClips(key, letter) {
    const template = VOICE_TEMPLATES[key];
    if (template) {
      const clips = template.map((c) => (c === null ? LETTER_FILES[letter] : c));
      return clips.every(Boolean) ? clips : null;
    }
    return VOICE_FILES[key] ? [VOICE_FILES[key]] : null;
  }

  /** Проигрывает файлы подряд один за другим. onFail — если файла нет на месте. */
  _playSequence(files, onDone, onFail) {
    let i = 0;
    let failed = false;
    const fail = (reason) => {
      if (!failed) { failed = true; log(`play: цепочка прервана — ${reason}`); onFail(); }
    };
    const playNext = () => {
      if (i >= files.length) { log('play: цепочка доиграна'); onDone && onDone(); return; }
      const short = files[i].split('/').pop();
      log(`play: старт ${short}`);
      // Берём уже разблокированный элемент из пула, а не создаём новый —
      // свежий <audio>, ни разу не тронутый жестом, iPad может отказаться
      // играть в обход правила «сначала касание».
      this._audio = this._getAudio(files[i]);
      this._audio.currentTime = 0;

      let settled = false;
      const advance = () => {
        if (settled || failed) return;
        settled = true;
        log(`play: ${short} — доиграл`);
        i++;
        playNext();
      };
      this._audio.addEventListener('ended', advance, { once: true });
      this._audio.addEventListener('error', () => fail(`${short} — error-событие`), { once: true });
      this._audio.play().catch((e) => fail(`${short} — play() отклонён: ${e && e.message || e}`));
      // Если клип за разумное время не доиграл и не сообщил об ошибке —
      // не виснем молча, идём дальше сами (замечено зависание элементов
      // на старом iPad).
      setTimeout(() => {
        if (!settled && !failed) { log(`play: ${short} — не ответил за 8с, идём дальше`); advance(); }
      }, 8000);
    };
    playNext();
  }

  _speakSynth(key, args, onDone) {
    if (!('speechSynthesis' in window) || !PHRASES[key]) {
      log(`synth: нечем сказать "${key}" (нет speechSynthesis или фразы)`);
      onDone && onDone();
      return;
    }

    const text = PHRASES[key](...args);
    log(`synth: "${text.slice(0, 30)}${text.length > 30 ? '…' : ''}"`);
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ru-RU';
    if (this.ruVoice) u.voice = this.ruVoice;
    u.rate = 0.95;   // чуть медленнее обычного — ребёнку так понятнее
    u.pitch = 1.03;  // раньше было 1.15 — задранный питч и звучал «пищащим роботом»

    if (onDone) {
      // На iPad событие onend у синтеза речи срабатывает РАНЬШЕ, чем
      // реально доигран звук (особенность старого Safari) — из-за этого
      // окно награды выскакивало на середине фразы. Поэтому onend не
      // используем вообще, только onerror (настоящий сбой синтеза),
      // а время ждём сами по длине фразы + пауза, чтобы было время
      // разглядеть, что появилось на экране, а не просто дослушать.
      let done = false;
      const finish = () => { if (!done) { done = true; onDone(); } };
      u.onerror = finish;
      setTimeout(finish, Math.max(1800, text.length * 110) + 600);
    }

    window.speechSynthesis.speak(u);
  }

  stop() {
    if (this._audio) { this._audio.pause(); this._audio = null; }
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }

  setMuted(v) {
    this.muted = v;
    if (v) this.stop();
  }
}

export const voice = new Voice();
