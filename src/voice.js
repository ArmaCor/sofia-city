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

// Обычные реплики — целиком один файл. Положить в public/assets/voice/.
const VOICE_FILES = {
  start:           'assets/voice/start.m4a',
  'stroke.next':   'assets/voice/stroke-next.m4a',
  'house.default': 'assets/voice/house-default.m4a',
};

// Имя буквы — отдельный короткий клип, переиспользуется в разных фразах
const LETTER_FILES = {
  'А': 'assets/voice/letter-a.m4a',
  'О': 'assets/voice/letter-o.m4a',
  'С': 'assets/voice/letter-s.m4a',
  'У': 'assets/voice/letter-u.m4a',
  'М': 'assets/voice/letter-m.m4a',
};

// Фразы с буквой внутри: null — сюда подставится клип буквы из LETTER_FILES
const VOICE_TEMPLATES = {
  'task.dig': ['assets/voice/task-dig-prefix.m4a', null],
  win:        ['assets/voice/win-prefix.m4a', null, 'assets/voice/win-suffix.m4a'],
};

class Voice {
  constructor() {
    this.muted = false;
    this.ruVoice = null;
    this.ready = false;
    this._audio = null;
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
    const fail = () => { if (!failed) { failed = true; onFail(); } };
    const playNext = () => {
      if (i >= files.length) { onDone && onDone(); return; }
      this._audio = new Audio(files[i]);
      this._audio.addEventListener('ended', () => { i++; playNext(); }, { once: true });
      this._audio.addEventListener('error', fail, { once: true });
      this._audio.play().catch(fail);
    };
    playNext();
  }

  _speakSynth(key, args, onDone) {
    if (!('speechSynthesis' in window) || !PHRASES[key]) { onDone && onDone(); return; }

    const text = PHRASES[key](...args);
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
