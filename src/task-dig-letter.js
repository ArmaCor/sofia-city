/* ==========================================================
   Задание: «Выкопай котлован в форме буквы».

   Как это работает:
   1. Букву раскладываем на штрихи (см. letters.js).
   2. Вдоль штриха рисуем пунктир — дорожку-подсказку.
   3. Ребёнок ведёт пальцем. Мы находим ближайшую точку дорожки
      ЧУТЬ ВПЕРЁД от уже пройденного и двигаем туда ковш.
   4. Назад прогресс не откатывается — промахнуться нельзя,
      проиграть нельзя. Это принципиально: игра для пяти лет.
   ========================================================== */

import * as THREE from 'three';
import { COLORS } from './scene.js';
import { buildLetter } from './letters.js';
import { sfx } from './sfx.js';
import { voice } from './voice.js';

const BUCKET_OFFSET = 3.7;  // насколько ковш вынесен вперёд от центра машины
const TOLERANCE     = 2.6;  // как далеко от дорожки может уйти палец (щедро!)
const LOOK_AHEAD    = 2.4;  // насколько вперёд разрешаем «перепрыгнуть»
const GRAB_RADIUS   = 4.0;  // с какого расстояния можно подхватить дорожку

export class DigLetterTask {
  constructor(world, excavator, letterKey, hooks = {}) {
    this.world = world;
    this.exc = excavator;
    this.hooks = hooks;

    this.letter = buildLetter(letterKey);
    this.root = new THREE.Group();
    this.world.scene.add(this.root);

    this.strokeIndex = 0;
    this.progress = 0;
    this.dragging = false;
    this.digging = false;
    this.digTimer = 0;
    this.finished = false;
    // Пока locked — ковш не реагирует на палец: сначала должна
    // договорить инструкция, и только потом можно начинать копать.
    this.locked = true;
    this._dummy = new THREE.Object3D();  // рабочий объект для матриц instanced-мешей

    this._buildVisuals();
    this._buildParticles();
    this._placeExcavatorAtStart();
  }

  // ---------- Постройка того, что видно на земле ----------

  _buildVisuals() {
    this.strokeViews = [];

    const dotGeo = new THREE.CircleGeometry(0.2, 12);
    // Кубик поменьше, но их снова много и часто: раньше ради быстродействия
    // их сделали крупными и редкими, отчего котлован выглядел «грубыми
    // ступенями». Instanced-мешу число кубиков почти не важно — видеокарта
    // рисует их одним вызовом, — поэтому частоту можно вернуть без потери FPS.
    const trenchGeo = new THREE.BoxGeometry(0.62, 0.5, 0.62);

    this.letter.strokes.forEach((pts, si) => {
      const dots = [];

      // Пунктир-подсказка — точек немного, отдельные меши тут не в тягость
      for (let i = 0; i < pts.length; i += 6) {
        const dot = new THREE.Mesh(
          dotGeo,
          new THREE.MeshBasicMaterial({
            color: 0xffffff, transparent: true, opacity: 0.85,
          })
        );
        dot.rotation.x = -Math.PI / 2;
        dot.position.set(pts[i].x, 0.03, pts[i].z);
        dot.userData.dist = pts[i].dist;
        this.root.add(dot);
        dots.push(dot);
      }

      // Точки котлована — часто (шаг 2, ~0.36 мировой единицы), но
      // рисуются одним InstancedMesh вместо отдельного меша на кубик.
      const trenchPts = [];
      for (let i = 0; i < pts.length; i += 2) trenchPts.push(pts[i]);

      const trenchMesh = new THREE.InstancedMesh(
        trenchGeo,
        new THREE.MeshLambertMaterial({ color: COLORS.dirt }),
        Math.max(1, trenchPts.length)
      );
      trenchMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      trenchMesh.castShadow = true;
      trenchMesh.count = 0;   // пока ничего не выкопано — ничего не рисуем
      this.root.add(trenchMesh);

      this.strokeViews.push({
        dots,
        trench: { mesh: trenchMesh, pts: trenchPts, opened: 0, growing: [] },
      });
    });

    // Зелёная стрелка «начни отсюда»
    this.startMark = new THREE.Mesh(
      new THREE.ConeGeometry(0.45, 1.0, 4),
      new THREE.MeshBasicMaterial({ color: 0x3DDC5B })
    );
    this.startMark.rotation.x = Math.PI;   // остриём вниз
    this.root.add(this.startMark);

    this._refreshStrokeHighlight();
  }

  /** Активный штрих — яркий, будущие — бледные, пройденные — прячем. */
  _refreshStrokeHighlight() {
    this.strokeViews.forEach((view, si) => {
      const state = si < this.strokeIndex ? 'done' : si === this.strokeIndex ? 'active' : 'later';
      view.dots.forEach((d) => {
        d.visible = state !== 'done';
        d.material.opacity = state === 'active' ? 0.9 : 0.25;
      });
    });

    const pts = this.letter.strokes[this.strokeIndex];
    if (pts) {
      this.startMark.visible = true;
      this.startMark.position.set(pts[0].x, 1.4, pts[0].z);
    } else {
      this.startMark.visible = false;
    }
  }

  _buildParticles() {
    // Пул комьев земли: переиспользуем одни и те же кубики
    this.particles = [];
    const geo = new THREE.BoxGeometry(0.22, 0.22, 0.22);
    const mat = new THREE.MeshLambertMaterial({ color: COLORS.dirt });
    for (let i = 0; i < 44; i++) {
      const p = new THREE.Mesh(geo, mat);
      p.visible = false;
      p.userData = { life: 0, vx: 0, vy: 0, vz: 0 };
      this.world.scene.add(p);
      this.particles.push(p);
    }
    this._pIdx = 0;
  }

  _spawnDirt(x, z) {
    for (let k = 0; k < 3; k++) {
      const p = this.particles[this._pIdx++ % this.particles.length];
      p.visible = true;
      p.position.set(x, 0.2, z);
      p.userData.life = 0.75;
      p.userData.vx = (Math.random() - 0.5) * 3.2;
      p.userData.vy = 3.4 + Math.random() * 2.2;
      p.userData.vz = (Math.random() - 0.5) * 3.2;
      p.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    }
  }

  /** Открывает новые кубики котлована по мере продвижения и запускает их рост. */
  _revealTrench(trench, progress, dt) {
    const { mesh, pts, growing } = trench;
    let target = trench.opened;
    while (target < pts.length && pts[target].dist <= progress) target++;

    if (target > trench.opened) {
      for (let i = trench.opened; i < target; i++) {
        this._dummy.position.set(pts[i].x, -0.24, pts[i].z);
        this._dummy.scale.set(0.001, 1, 0.001);
        this._dummy.updateMatrix();
        mesh.setMatrixAt(i, this._dummy.matrix);
        growing.push({ index: i, t: 0 });
        this._spawnDirt(pts[i].x, pts[i].z);
      }
      trench.opened = target;
      mesh.count = target;
    }

    this._growTrench(trench, dt);
  }

  /** Доигрывает анимацию «вырастания» уже открытых кубиков. */
  _growTrench(trench, dt) {
    const { mesh, pts, growing } = trench;
    if (!growing.length) return;

    for (let k = growing.length - 1; k >= 0; k--) {
      const g = growing[k];
      g.t = Math.min(1, g.t + dt * 6);
      this._dummy.position.set(pts[g.index].x, -0.24, pts[g.index].z);
      this._dummy.scale.set(g.t, 1, g.t);
      this._dummy.updateMatrix();
      mesh.setMatrixAt(g.index, this._dummy.matrix);
      if (g.t >= 1) growing.splice(k, 1);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  _placeExcavatorAtStart() {
    const pts = this.letter.strokes[0];
    const dir = this._dirAt(pts, 0);
    this.exc.heading = Math.atan2(dir.x, dir.z) + Math.PI;
    const f = this._forward();
    this.exc.group.position.set(pts[0].x - f.x * BUCKET_OFFSET, 0, pts[0].z - f.z * BUCKET_OFFSET);
    this.exc.group.rotation.y = this.exc.heading;
  }

  _forward() {
    const h = this.exc.heading;
    return { x: -Math.sin(h), z: -Math.cos(h) };
  }

  _dirAt(pts, dist) {
    const i = this._indexAt(pts, dist);
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    return { x: dx / len, z: dz / len };
  }

  _indexAt(pts, dist) {
    // Точки идут по возрастанию dist, поэтому просто ищем первую подходящую
    for (let i = 0; i < pts.length; i++) if (pts[i].dist >= dist) return i;
    return pts.length - 1;
  }

  _pointAt(pts, dist) {
    return pts[this._indexAt(pts, dist)];
  }

  // ---------- Управление пальцем ----------

  onPointerDown(x, y) {
    if (this.finished || this.locked) return;
    const hit = this.world.pointerToGround(x, y);
    if (!hit) return;
    const pts = this.letter.strokes[this.strokeIndex];
    const head = this._pointAt(pts, this.progress);
    // Подхватываем, только если палец рядом с текущей «головой» дорожки
    if (Math.hypot(hit.x - head.x, hit.z - head.z) <= GRAB_RADIUS) {
      this.dragging = true;
      this.onPointerMove(x, y);
    }
  }

  onPointerMove(x, y) {
    if (!this.dragging || this.finished) return;
    const hit = this.world.pointerToGround(x, y);
    if (!hit) return;

    const pts = this.letter.strokes[this.strokeIndex];
    let best = null;

    // Берём самую дальнюю точку дорожки, до которой палец «дотянулся».
    // Именно самую дальнюю, а не ближайшую: тогда движение пальца
    // не тормозит ковш и ребёнку не нужна точность.
    const from = this._indexAt(pts, this.progress);
    for (let i = from; i < pts.length; i++) {
      if (pts[i].dist > this.progress + LOOK_AHEAD) break;
      const d = Math.hypot(hit.x - pts[i].x, hit.z - pts[i].z);
      if (d <= TOLERANCE) best = pts[i];
    }

    if (best && best.dist > this.progress) {
      this.progress = best.dist;
      this.digTimer = 0.2;
      sfx.dig();
    }
  }

  onPointerUp() {
    this.dragging = false;
  }

  /** Открывает управление — вызывается, когда инструкция договорена. */
  unlock() {
    if (!this.locked) return;
    this.locked = false;
    sfx.ready();
  }

  // ---------- Каждый кадр ----------

  update(dt, t) {
    const pts = this.letter.strokes[this.strokeIndex];

    if (pts && !this.finished) {
      // Ковш едет по дорожке
      const head = this._pointAt(pts, this.progress);
      const dir = this._dirAt(pts, this.progress);
      const f = this._forward();
      this.exc.moveTo(head.x - f.x * BUCKET_OFFSET, head.z - f.z * BUCKET_OFFSET, dir.x, dir.z, dt);

      // Открываем куски котлована и подбрасываем землю
      const view = this.strokeViews[this.strokeIndex];
      this._revealTrench(view.trench, this.progress, dt);

      // Прячем пройденный пунктир
      for (const dot of view.dots) {
        if (dot.userData.dist <= this.progress) dot.visible = false;
      }

      // Штрих закончен?
      if (this.progress >= pts.length_ - 0.05) this._finishStroke();
    }

    // Кубики уже открытых (не текущих) штрихов продолжают доигрывать рост
    for (let si = 0; si < this.strokeViews.length; si++) {
      if (si !== this.strokeIndex) this._growTrench(this.strokeViews[si].trench, dt);
    }

    // Стрелка старта подпрыгивает
    if (this.startMark.visible) {
      this.startMark.position.y = 1.4 + Math.sin(t * 4) * 0.25;
      this.startMark.rotation.y = t * 1.5;
    }

    // Комья земли летят и падают
    for (const p of this.particles) {
      if (!p.visible) continue;
      const u = p.userData;
      u.life -= dt;
      if (u.life <= 0) { p.visible = false; continue; }
      u.vy -= 13 * dt;
      p.position.x += u.vx * dt;
      p.position.y += u.vy * dt;
      p.position.z += u.vz * dt;
      p.rotation.x += dt * 6;
      if (p.position.y < 0.1) { p.visible = false; }
    }

    // Копает или стоит
    this.digTimer = Math.max(0, this.digTimer - dt);
    this.exc.digging = this.digTimer > 0;
    this.exc.update(dt, t);

    if (this.house) this._growHouse(dt);
  }

  _finishStroke() {
    this.strokeIndex++;
    this.progress = 0;
    this.dragging = false;

    if (this.strokeIndex >= this.letter.strokes.length) {
      this._win();
    } else {
      this._refreshStrokeHighlight();
      voice.say('stroke.next');
    }
  }

  // ---------- Победа ----------

  _win() {
    this.finished = true;
    this.startMark.visible = false;
    sfx.build();

    // Дом вырастает из котлована
    const house = new THREE.Group();

    const walls = new THREE.Mesh(
      new THREE.BoxGeometry(3.4, 3.0, 3.4),
      new THREE.MeshLambertMaterial({ color: 0xFFF2D8 })
    );
    walls.position.y = 1.5;
    walls.castShadow = true;
    house.add(walls);

    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(2.85, 1.7, 4),
      new THREE.MeshLambertMaterial({ color: 0xE63946 })
    );
    roof.position.y = 3.85;
    roof.rotation.y = Math.PI / 4;
    roof.castShadow = true;
    house.add(roof);

    // Окошки и дверь
    for (const [dx, dy] of [[-0.85, 1.9], [0.85, 1.9]]) {
      const win = new THREE.Mesh(
        new THREE.BoxGeometry(0.9, 0.9, 0.08),
        new THREE.MeshLambertMaterial({ color: 0x8ECAE6 })
      );
      win.position.set(dx, dy, -1.72);
      house.add(win);
    }
    const door = new THREE.Mesh(
      new THREE.BoxGeometry(0.85, 1.4, 0.08),
      new THREE.MeshLambertMaterial({ color: 0x9B5D30 })
    );
    door.position.set(0, 0.7, -1.72);
    house.add(door);

    house.position.set(0, 0, 0);
    house.scale.set(0.01, 0.01, 0.01);
    this.world.scene.add(house);
    this.house = house;
    this.houseGrow = 0;

    setTimeout(() => sfx.win(), 350);
    // Окно с наградой открываем, когда фраза реально договорена, а не через
    // угаданную паузу — иначе дом вырос, а окно уже перекрыло его на полуслове
    voice.sayThen('win', () => {
      this.hooks.onWin && this.hooks.onWin(this.letter);
    }, this.letter.name);
  }

  _growHouse(dt) {
    if (this.houseGrow >= 1) return;
    this.houseGrow = Math.min(1, this.houseGrow + dt * 0.9);
    // Пружинка: дом слегка «перелетает» и возвращается — так живее
    const t = this.houseGrow;
    const s = 1 + 0.28 * Math.sin(t * Math.PI) * (1 - t);
    this.house.scale.set(s * t, s * t, s * t);
  }

  /** Убрать всё с земли — перед новым заданием. */
  dispose() {
    this.world.scene.remove(this.root);
    for (const p of this.particles) this.world.scene.remove(p);
    if (this.house) this.world.scene.remove(this.house);
  }
}
