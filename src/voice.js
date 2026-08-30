/* ==========================================================
   Голос заданий.
   Сейчас говорит встроенный синтез речи браузера.
   Когда запишем живые голоса — кладём mp3 в public/assets/voice/
   и прописываем путь в VOICE_FILES. Остальной код менять не нужно.
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

// Сюда позже впишем записанные файлы, например: 'win': '/assets/voice/win.mp3'
const VOICE_FILES = {};

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

    // 1) Если для реплики записан живой голос — играем файл
    if (VOICE_FILES[key]) {
      this.stop();
      this._audio = new Audio(VOICE_FILES[key]);
      if (onDone) this._audio.addEventListener('ended', onDone, { once: true });
      this._audio.play().catch(() => onDone && onDone());
      return;
    }

    // 2) Иначе — синтез речи
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
