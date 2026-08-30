/* ==========================================================
   Буквы как маршруты для экскаватора.
   Каждая буква — это набор «штрихов». Штрих — ломаная линия,
   по которой ребёнок ведёт палец, а Ковшик копает.

   Координаты условные: x вправо, y вверх, примерно от -1 до 1.
   В мир они разворачиваются функцией buildLetter().
   Добавить новую букву = дописать сюда массив точек. Кода трогать не надо.
   ========================================================== */

export const LETTERS = {
  'А': {
    name: 'А',
    word: 'Автокран',
    strokes: [
      [[-0.85, -1], [0, 1], [0.85, -1]],   // «домик» — две ноги
      [[-0.42, -0.1], [0.42, -0.1]],       // перекладина
    ],
  },
  'О': {
    name: 'О',
    word: 'Огород',
    strokes: [
      // Круг задаём точками, чтобы не заводить отдельную математику
      [[0, 1], [0.62, 0.7], [0.85, 0], [0.62, -0.7], [0, -1],
       [-0.62, -0.7], [-0.85, 0], [-0.62, 0.7], [0, 1]],
    ],
  },
  'С': {
    name: 'С',
    word: 'Самосвал',
    strokes: [
      [[0.7, 0.72], [0.1, 1], [-0.6, 0.6], [-0.82, 0], [-0.6, -0.6],
       [0.1, -1], [0.7, -0.72]],
    ],
  },
  'У': {
    name: 'У',
    word: 'Улица',
    strokes: [
      [[-0.75, 1], [0, -0.15]],
      [[0.75, 1], [-0.35, -1]],
    ],
  },
  'М': {
    name: 'М',
    word: 'Мигалка',
    strokes: [
      [[-0.8, -1], [-0.8, 1], [0, -0.1], [0.8, 1], [0.8, -1]],
    ],
  },
};

/**
 * Разбивает ломаную на частые точки с равным шагом.
 * Нужно, чтобы движение ковша было плавным, а не рывками от угла к углу.
 */
function resample(points, step) {
  const out = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[i + 1];
    const len = Math.hypot(x2 - x1, y2 - y1);
    const n = Math.max(1, Math.ceil(len / step));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      out.push([x1 + (x2 - x1) * t, y1 + (y2 - y1) * t]);
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

/**
 * Готовит букву к работе в 3D-мире.
 * scale — во сколько раз растянуть; step — плотность точек в мировых единицах.
 * Возвращает штрихи: массив массивов {x, z, dist} — dist это путь от начала штриха.
 */
export function buildLetter(key, scale = 4.2, step = 0.18) {
  const letter = LETTERS[key];
  if (!letter) throw new Error(`Нет буквы «${key}» в letters.js`);

  const strokes = letter.strokes.map((raw) => {
    // Переводим в мир: y (вверх на бумаге) становится -z (вглубь сцены)
    const worldPts = resample(raw, step / scale).map(([x, y]) => ({
      x: x * scale,
      z: -y * scale,
    }));

    let dist = 0;
    worldPts[0].dist = 0;
    for (let i = 1; i < worldPts.length; i++) {
      dist += Math.hypot(worldPts[i].x - worldPts[i - 1].x, worldPts[i].z - worldPts[i - 1].z);
      worldPts[i].dist = dist;
    }
    worldPts.length_ = dist;
    return worldPts;
  });

  return { key, name: letter.name, word: letter.word, strokes };
}
