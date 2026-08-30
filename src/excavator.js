/* ==========================================================
   Ковшик — экскаватор.
   Собран из простых коробок: это «низкополигональный» стиль,
   тот же, что у наборов Kenney. Позже коробки можно заменить
   на готовую 3D-модель — остальной код об этом не узнает.
   ========================================================== */

import * as THREE from 'three';
import { COLORS } from './scene.js';

const box = (w, h, d, color) =>
  new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshLambertMaterial({ color })
  );

export class Excavator {
  constructor() {
    this.group = new THREE.Group();
    this.heading = 0;      // куда смотрит, в радианах
    this.digPhase = 0;     // фаза качания стрелы
    this.digging = false;

    const yellow = COLORS.machine;
    const dark = 0x2F2A26;

    // --- Гусеницы ---
    for (const side of [-1, 1]) {
      const track = box(0.55, 0.5, 2.6, dark);
      track.position.set(side * 0.78, 0.25, 0);
      track.castShadow = true;
      this.group.add(track);
      // Светлые накладки — чтобы гусеница читалась
      for (let i = -2; i <= 2; i++) {
        const shoe = box(0.62, 0.12, 0.22, 0x4A423B);
        shoe.position.set(side * 0.78, 0.25, i * 0.5);
        this.group.add(shoe);
      }
    }

    // --- Поворотная платформа и корпус ---
    const plate = box(1.7, 0.22, 2.2, 0xE07A00);
    plate.position.y = 0.6;
    plate.castShadow = true;
    this.group.add(plate);

    const body = box(1.5, 0.75, 1.9, yellow);
    body.position.set(0, 1.05, 0.15);
    body.castShadow = true;
    this.group.add(body);

    // --- Кабина с глазами ---
    const cab = box(1.15, 1.0, 1.05, yellow);
    cab.position.set(-0.15, 1.9, 0.25);
    cab.castShadow = true;
    this.group.add(cab);

    const glass = box(1.0, 0.72, 0.08, 0x2E6B8A);
    glass.position.set(-0.15, 1.95, -0.29);
    this.group.add(glass);

    // Глаза — то, что превращает технику в героя
    this.eyes = [];
    for (const side of [-1, 1]) {
      const white = new THREE.Mesh(
        new THREE.SphereGeometry(0.21, 16, 12),
        new THREE.MeshLambertMaterial({ color: 0xffffff })
      );
      white.position.set(-0.15 + side * 0.26, 1.98, -0.34);
      this.group.add(white);

      const pupil = new THREE.Mesh(
        new THREE.SphereGeometry(0.1, 12, 10),
        new THREE.MeshBasicMaterial({ color: 0x1B1B1B })
      );
      pupil.position.set(-0.15 + side * 0.26, 1.97, -0.46);
      this.group.add(pupil);
      this.eyes.push({ white, pupil, baseY: 1.98 });
    }

    // --- Стрела, рукоять, ковш ---
    // Крепим сбоку, чтобы не закрывать глаза.
    this.armPivot = new THREE.Group();
    this.armPivot.position.set(0.66, 1.15, -0.55);
    this.group.add(this.armPivot);

    const boom = box(0.3, 0.3, 2.3, 0xE07A00);
    boom.position.z = -1.05;
    boom.castShadow = true;
    this.armPivot.add(boom);

    this.stickPivot = new THREE.Group();
    this.stickPivot.position.z = -2.1;
    this.armPivot.add(this.stickPivot);

    const stick = box(0.24, 0.24, 1.3, 0xE07A00);
    stick.position.z = -0.6;
    stick.castShadow = true;
    this.stickPivot.add(stick);

    this.bucket = box(0.72, 0.6, 0.7, 0x9A9A9A);
    this.bucket.position.set(0, -0.12, -1.25);
    this.bucket.castShadow = true;
    this.stickPivot.add(this.bucket);

    // Зубья ковша
    for (let i = -1; i <= 1; i++) {
      const tooth = box(0.14, 0.14, 0.2, 0xBFBFBF);
      tooth.position.set(i * 0.22, -0.32, -1.52);
      this.stickPivot.add(tooth);
    }

    // Мигалка на крыше — для узнаваемости
    const beacon = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 12, 10),
      new THREE.MeshBasicMaterial({ color: COLORS.sun })
    );
    beacon.position.set(-0.15, 2.5, 0.25);
    this.group.add(beacon);
    this.beacon = beacon;

    this.armPivot.rotation.x = -0.35;
    this.stickPivot.rotation.x = 0.5;
  }

  /** Ставим машину в точку и разворачиваем в сторону движения. */
  moveTo(x, z, dirX, dirZ, dt) {
    this.group.position.x = x;
    this.group.position.z = z;
    if (dirX !== 0 || dirZ !== 0) {
      // «Перёд» модели смотрит в -Z, поэтому атан считаем так
      const target = Math.atan2(dirX, dirZ) + Math.PI;
      // Плавный доворот по кратчайшей дуге, без резких разворотов.
      // Скорость доворота привязана к dt — иначе при просадке кадров
      // на iPad поворот на глаз выглядит рывками, а не плавной дугой.
      let diff = target - this.heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.heading += diff * Math.min(1, dt * 11);
      this.group.rotation.y = this.heading;
    }
  }

  update(dt, t) {
    // Копает — стрела ходит вверх-вниз, стоит — чуть дышит
    const speed = this.digging ? 9 : 1.6;
    const depth = this.digging ? 0.42 : 0.06;
    this.digPhase += dt * speed;
    this.armPivot.rotation.x = -0.35 + Math.sin(this.digPhase) * depth * 0.6;
    this.stickPivot.rotation.x = 0.5 + Math.sin(this.digPhase + 0.7) * depth;

    // Мигалка мигает
    this.beacon.material.color.setHex(
      Math.sin(t * 6) > 0 ? COLORS.sun : 0x8a6400
    );

    // Моргание: раз в несколько секунд глаза «схлопываются»
    const blink = (t % 4.2) > 4.05;
    for (const eye of this.eyes) {
      eye.white.scale.y = blink ? 0.12 : 1;
      eye.pupil.visible = !blink;
    }

    // Лёгкое покачивание корпуса при работе
    this.group.rotation.z = this.digging ? Math.sin(this.digPhase * 0.5) * 0.02 : 0;
  }
}
