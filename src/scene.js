/* ==========================================================
   Сцена: земля, свет, камера, дом.
   Здесь нет игровой логики — только «мир, в котором всё стоит».
   ========================================================== */

import * as THREE from 'three';

export const COLORS = {
  sky:     0x8ECAE6,
  sand:    0xE8D5A9,  // песок стройплощадки
  grass:   0x90BE6D,
  dirt:    0x8B5E34,  // выкопанная земля
  machine: 0xFB8500,
  dark:    0x3A2E24,
  white:   0xFFFFFF,
  sun:     0xFFB703,
};

export class World {
  constructor(canvas) {
    this.canvas = canvas;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      // На iPad это заметно экономит батарею и не даёт греться
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(COLORS.sky);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(COLORS.sky, 40, 80);

    this.camera = new THREE.PerspectiveCamera(46, 1, 0.1, 200);
    this.camera.position.set(0, 18.5, 12.5);
    this.camera.lookAt(0, 0, -0.5);

    this._addLights();
    this._addGround();

    // Плоскость земли для «пальцевого» луча: куда ткнули — та точка мира
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.raycaster = new THREE.Raycaster();

    this.clock = new THREE.Clock();
    this.updaters = [];   // сюда складываем функции, которые нужно звать каждый кадр

    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 250));
  }

  _addLights() {
    // Мягкий «мультяшный» свет: небо сверху, земля снизу, солнце сбоку
    this.scene.add(new THREE.HemisphereLight(0xBFE6F5, 0xC9A97B, 1.1));
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.35));

    const sun = new THREE.DirectionalLight(0xFFF3D6, 1.5);
    sun.position.set(9, 16, 7);
    sun.castShadow = true;
    sun.shadow.mapSize.set(768, 768);   // тени полегче — важнее ровные кадры, чем чёткость тени
    const d = 16;
    sun.shadow.camera.left = -d;
    sun.shadow.camera.right = d;
    sun.shadow.camera.top = d;
    sun.shadow.camera.bottom = -d;
    sun.shadow.camera.far = 60;
    sun.shadow.bias = -0.0012;
    this.scene.add(sun);
  }

  _addGround() {
    // Трава — большой фон вокруг стройки
    const grass = new THREE.Mesh(
      new THREE.PlaneGeometry(120, 120),
      new THREE.MeshLambertMaterial({ color: COLORS.grass })
    );
    grass.rotation.x = -Math.PI / 2;
    grass.position.y = -0.06;
    grass.receiveShadow = true;
    this.scene.add(grass);

    // Песчаная площадка — рабочая зона, где копаем
    const pad = new THREE.Mesh(
      new THREE.CircleGeometry(13, 48),
      new THREE.MeshLambertMaterial({ color: COLORS.sand })
    );
    pad.rotation.x = -Math.PI / 2;
    pad.receiveShadow = true;
    this.scene.add(pad);

    this.ground = pad;

    // Заборчик по краю площадки — рамка, чтобы взгляд не убегал.
    // Все столбики одного цвета лежат в ОДНОМ инстансированном меше:
    // вместо 30 отдельных объектов на видеокарту уходит всего 2 —
    // на слабом GPU (в том числе на iPad) это главное, что убирает рывки.
    const postGeo = new THREE.BoxGeometry(0.35, 1.5, 0.35);
    const white = new THREE.InstancedMesh(
      postGeo, new THREE.MeshLambertMaterial({ color: 0xF2F2F2 }), 15
    );
    const orange = new THREE.InstancedMesh(
      postGeo, new THREE.MeshLambertMaterial({ color: COLORS.machine }), 15
    );
    white.castShadow = orange.castShadow = true;
    const m = new THREE.Matrix4();
    let wi = 0, oi = 0;
    for (let i = 0; i < 30; i++) {
      const a = (i / 30) * Math.PI * 2;
      m.setPosition(Math.cos(a) * 12.6, 0.75, Math.sin(a) * 12.6);
      if (i % 2 === 0) white.setMatrixAt(wi++, m);
      else orange.setMatrixAt(oi++, m);
    }
    this.scene.add(white, orange);
  }

  /** Куда на земле указывает палец. Возвращает THREE.Vector3 или null. */
  pointerToGround(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this.groundPlane, hit) ? hit : null;
  }

  onUpdate(fn) { this.updaters.push(fn); }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    // Ограничиваем плотность пикселей: на Retina без этого падает частота кадров
    // 1.5, а не 2: на Retina-iPad это почти вдвое меньше пикселей к отрисовке
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.camera.aspect = w / h;
    // Если планшет держат вертикально — отодвигаем камеру, чтобы буква влезла
    this.camera.fov = this.camera.aspect < 1 ? 62 : 46;
    this.camera.updateProjectionMatrix();
  }

  start() {
    const loop = () => {
      const dt = Math.min(this.clock.getDelta(), 0.05); // защита от «скачка» при возврате из фона
      const t = this.clock.elapsedTime;
      for (const fn of this.updaters) fn(dt, t);
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(loop);
    };
    loop();
  }
}
