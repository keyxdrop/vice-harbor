// Vice Harbor — game brain. Owns the player, traffic, police, rivals,
// missions, wanted heat, combat, HUD and the save file. Rendering is plain
// three.js; every system here is small, explicit and deterministic under a
// seed so the screenshot scenes replay identically.
import * as THREE from 'three';
import { City, ROAD_LINES, ROAD_HALF, HARBOR_Z, CITY_EDGE } from './city.js';
import { Car, carPaint, steerToward } from './vehicles.js';
import { Person, Walker } from './people.js';
import { Rng, clamp, angleDelta, dist2d } from './rng.js';

const SAVE_KEY = 'viceHarborSaveV1';
const $ = (id) => document.getElementById(id);

const MARA_POS = { x: 14, z: HARBOR_Z - 24 };
const GARAGE_POS = { x: 76, z: -228 };
const PICKUP_POS = { x: -228, z: 76 };
const PIER_POS = { x: 30, z: HARBOR_Z - 4 };
const CLINIC_POS = { x: -76, z: 228 };
const GANG_POS = { x: 76, z: 76 }; // the east-central intersection — open asphalt, their turf

function nearestRoadLine(v) {
  let best = ROAD_LINES[0];
  for (const r of ROAD_LINES) if (Math.abs(r - v) < Math.abs(best - v)) best = r;
  return best;
}

export class Game {
  constructor(scene, camera, opts = {}) {
    this.scene = scene;
    this.camera = camera;
    this.seed = opts.seed ?? 1;
    this.rng = new Rng(this.seed * 131 + 7);
    this.shotMode = opts.shot ?? null;
    this.city = new City(scene, this.seed);
    this.time = 0;
    this.state = 'title'; // title | playing | paused | busted | wasted
    this.keys = new Set();
    this.mouseDown = false;
    this.camYaw = Math.PI * 0.85;
    this.camPitch = 0.34;
    this.camDist = 10;

    // --- world lighting: hard tropical sun + sky fill ---
    const sky = new THREE.Color(0x79c7e3);
    scene.background = sky;
    scene.fog = new THREE.Fog(0x9fd4e8, 190, 620);
    const hemi = new THREE.HemisphereLight(0xcfeeff, 0x51683f, 0.95);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff1cf, 2.0);
    sun.position.set(140, 210, 90);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -300;
    sun.shadow.camera.right = 300;
    sun.shadow.camera.top = 300;
    sun.shadow.camera.bottom = -300;
    sun.shadow.camera.far = 620;
    sun.shadow.bias = -0.0006;
    scene.add(sun);
    this.sun = sun;

    // --- actors ---
    this.player = new Person(scene, this.rng, { x: 2, z: 232, shirt: 0xff2e88, pants: 0x22333b, skin: 0xc68863 });
    this.playerCar = null;
    this.traffic = [];
    this.parked = [];
    this.police = [];
    this.walkers = [];
    this.rivals = [];
    this.tracers = [];
    this.spawnTraffic();
    this.spawnParked();
    this.spawnWalkers();
    this.spawnRivals();
    this.mara = new Person(scene, this.rng, { x: MARA_POS.x, z: MARA_POS.z, shirt: 0x7bedff, pants: 0x2b2d42, skin: 0x8d5524, hair: 0x0d0d0f });
    this.mara.heading = Math.PI;
    this.crew = [
      new Person(scene, this.rng, { x: PIER_POS.x - 3, z: PIER_POS.z - 2, shirt: 0x43aa8b }),
      new Person(scene, this.rng, { x: PIER_POS.x + 3, z: PIER_POS.z - 2, shirt: 0xf9c74f }),
    ];

    // objective beacon: a pillar of gold light + floating ring
    const beaconMat = new THREE.MeshBasicMaterial({ color: 0xffd32a, transparent: true, opacity: 0.25, depthWrite: false });
    this.beacon = new THREE.Mesh(new THREE.CylinderGeometry(3.0, 3.0, 46, 18, 1, true), beaconMat);
    this.beacon.visible = false;
    scene.add(this.beacon);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.4, 0.22, 8, 28), new THREE.MeshBasicMaterial({ color: 0xffd32a }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 1.2;
    this.beacon.add(ring);
    this.beaconRing = ring;

    // muzzle flash light, reused
    this.flash = new THREE.PointLight(0xffc46b, 0, 18);
    scene.add(this.flash);

    // --- run state ---
    this.cash = 120;
    this.health = 100;
    this.heat = 0; // wanted heat; stars = ceil(heat)
    this.unseenT = 0;
    this.bust = 0;
    this.fireCd = 0;
    this.toastT = 0;
    this.dialogueQueue = [];
    this.dialogueT = 0;
    this.missionIndex = 0; // 0 intro, 1 first run, 2 hot wheels, 3 harbor heat, 4 done
    this.missionStage = 0;
    this.specialCar = null;
    this.hasPackage = false;
    this.crewAboard = false;
    this.loadSaveNote();
    this.bindInput();
    this.bindButtons();
    this.setObjective('Welcome to Vice Harbor', 'Meet Mara Voss by the harbour boardwalk — follow the gold beacon.');
  }

  // ---------------------------------------------------------- spawning
  spawnTraffic() {
    const rng = this.rng;
    const kinds = ['sedan', 'sedan', 'sedan', 'taxi', 'van', 'sports'];
    for (let i = 0; i < 15; i += 1) {
      const alongX = rng.chance(0.5);
      const road = rng.pick(ROAD_LINES);
      const pos = rng.float(-240, 240);
      const dir = rng.chance(0.5) ? 1 : -1;
      let x;
      let z;
      let heading;
      if (alongX) {
        z = road + (dir > 0 ? 4.2 : -4.2);
        x = pos;
        heading = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      } else {
        x = road + (dir > 0 ? -4.2 : 4.2);
        z = pos;
        heading = dir > 0 ? 0 : Math.PI;
      }
      const car = new Car(this.scene, rng.pick(kinds), carPaint(rng.int(0, 9)), x, z, heading);
      car.ai = { axis: alongX ? 'x' : 'z', dir, road, turnCd: rng.float(1, 4), speedWanted: rng.float(11, 17) };
      this.traffic.push(car);
    }
  }

  spawnParked() {
    const rng = this.rng;
    const spots = [
      { x: -6, z: 238, h: Math.PI / 2, kind: 'sedan' },
      { x: 60, z: HARBOR_Z - 12 - 6.4, h: Math.PI / 2, kind: 'sedan' },
      { x: -120, z: 70, h: 0, kind: 'van' },
      { x: 82, z: -140, h: Math.PI, kind: 'sedan' },
      { x: -70, z: -82, h: Math.PI / 2, kind: 'taxi' },
      { x: 160, z: 6, h: 0, kind: 'sedan' },
      { x: -234, z: -60, h: 0, kind: 'sports' },
      { x: 222, z: 160, h: Math.PI, kind: 'van' },
    ];
    for (const s of spots) {
      const car = new Car(this.scene, s.kind, carPaint(rng.int(0, 9)), s.x, s.z, s.h);
      car.parked = true;
      this.parked.push(car);
    }
    // Mara's magenta coupe — the M2 target, parked by the marina offices
    const special = new Car(this.scene, 'sports', 0xff2e88, 146, -70, Math.PI / 2);
    special.parked = true;
    special.isSpecial = true;
    this.specialCar = special;
    this.parked.push(special);
  }

  spawnWalkers() {
    const rng = this.rng;
    for (let i = 0; i < 16; i += 1) {
      const bi = rng.int(0, ROAD_LINES.length - 2);
      const bj = rng.int(0, ROAD_LINES.length - 2);
      const inset = ROAD_HALF + 1.6;
      const ring = {
        x0: ROAD_LINES[bi] + inset,
        z0: ROAD_LINES[bj] + inset,
        x1: ROAD_LINES[bi + 1] - inset,
        z1: ROAD_LINES[bj + 1] - inset,
      };
      const w = new Walker(this.scene, rng, ring);
      w.corner = rng.int(0, 3);
      const cs = w.corners();
      w.x = cs[w.corner][0];
      w.z = cs[w.corner][1];
      this.walkers.push(w);
    }
  }

  spawnRivals() {
    const rng = this.rng;
    const spots = [
      [GANG_POS.x - 4, GANG_POS.z - 3], [GANG_POS.x + 4, GANG_POS.z - 2],
      [GANG_POS.x - 2, GANG_POS.z + 4], [GANG_POS.x + 5, GANG_POS.z + 4],
    ];
    for (const [x, z] of spots) {
      const r = new Person(this.scene, rng, { x, z, shirt: 0x22223a, pants: 0x14141f, hair: 0x000000, health: 100 });
      r.isRival = true;
      r.fireCd = rng.float(0.5, 1.6);
      this.rivals.push(r);
    }
  }

  // ---------------------------------------------------------- input & UI wiring
  bindInput() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'KeyF') this.tryEnterExit();
      if (e.code === 'KeyP' || e.code === 'Escape') this.togglePause();
      if (e.code === 'KeyE') this.skipDialogue();
      if (e.code === 'Enter' && (this.state === 'busted' || this.state === 'wasted')) this.respawn();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    const cv = document.querySelector('#game');
    cv.addEventListener('mousedown', (e) => {
      this.mouseDown = true;
      this.lastMouse = [e.clientX, e.clientY];
    });
    window.addEventListener('mouseup', () => { this.mouseDown = false; });
    window.addEventListener('mousemove', (e) => {
      if (!this.mouseDown || this.state !== 'playing') return;
      const dx = e.clientX - this.lastMouse[0];
      const dy = e.clientY - this.lastMouse[1];
      this.lastMouse = [e.clientX, e.clientY];
      this.camYaw -= dx * 0.0052;
      this.camPitch = clamp(this.camPitch + dy * 0.004, 0.06, 1.15);
    });
    cv.addEventListener('wheel', (e) => {
      this.camDist = clamp(this.camDist + Math.sign(e.deltaY) * 1.4, 6.5, 18);
    }, { passive: true });
  }

  bindButtons() {
    $('btnNew').addEventListener('click', () => this.startGame(false));
    $('btnContinue').addEventListener('click', () => this.startGame(true));
    $('btnResume').addEventListener('click', () => this.togglePause());
    $('btnQuitTitle').addEventListener('click', () => {
      this.state = 'title';
      $('pauseScreen').classList.add('hidden');
      $('hud').classList.add('hidden');
      $('startScreen').classList.remove('hidden');
    });
    $('btnRespawn').addEventListener('click', () => this.respawn());
  }

  loadSaveNote() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) {
        const save = JSON.parse(raw);
        $('btnContinue').classList.remove('hidden');
        $('saveNote').textContent = `Saved run found — $${save.cash} banked, ${save.missionIndex >= 4 ? 'story complete' : `mission ${save.missionIndex + 1} in progress`}.`;
        this.pendingSave = save;
      }
    } catch { /* storage unavailable: play without saves */ }
  }

  persist() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ cash: this.cash, missionIndex: this.missionIndex }));
    } catch { /* ignore */ }
  }

  startGame(resume) {
    if (resume && this.pendingSave) {
      this.cash = this.pendingSave.cash ?? this.cash;
      this.missionIndex = this.pendingSave.missionIndex ?? 0;
    } else {
      this.cash = 120;
      this.missionIndex = 0;
      try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
    }
    this.health = 100;
    this.heat = 0;
    this.missionStage = 0;
    this.hasPackage = false;
    this.crewAboard = false;
    this.state = 'playing';
    $('startScreen').classList.add('hidden');
    $('endScreen').classList.add('hidden');
    $('hud').classList.remove('hidden');
    this.setupMission();
    this.refreshHud();
  }

  togglePause() {
    if (this.state === 'playing') {
      this.state = 'paused';
      $('pauseScreen').classList.remove('hidden');
    } else if (this.state === 'paused') {
      this.state = 'playing';
      $('pauseScreen').classList.add('hidden');
    }
  }

  // ---------------------------------------------------------- missions
  say(name, text, seconds = 4.6) {
    this.dialogueQueue.push({ name, text, seconds });
  }

  skipDialogue() {
    this.dialogueT = Math.min(this.dialogueT, 0.01);
  }

  setObjective(title, text) {
    this.objectiveTitle = title;
    this.objectiveText = text;
    $('objectiveTitle').textContent = title;
    $('objectiveText').textContent = text;
  }

  setupMission() {
    const m = this.missionIndex;
    this.missionStage = 0;
    if (m === 0) {
      this.setObjective('Welcome to Vice Harbor', 'Meet Mara Voss by the harbour boardwalk — follow the gold beacon.');
      this.target = { ...MARA_POS, r: 4.5 };
    } else if (m === 1) {
      this.setObjective('Mission 1 — First Run', 'Take any car and collect the package at the west docks depot.');
      this.say('Mara', 'Simple first job, sweetheart. A package is waiting at the west depot. Bring it to the garage on the north side — and drive like you mean it.');
      this.target = { ...PICKUP_POS, r: 8 };
    } else if (m === 2) {
      this.setObjective('Mission 2 — Hot Wheels', 'Steal the magenta coupe by the marina offices and deliver it to the garage.');
      this.say('Mara', 'See that magenta coupe near the marina? Its owner owes me. Take it — the law will notice, so lose them or outrun them, then park it at the garage.');
      this.target = { x: this.specialCar.x, z: this.specialCar.z, r: 7 };
    } else if (m === 3) {
      this.setObjective('Mission 3 — Harbor Heat', 'Pick up Mara\u2019s crew at the pier, then shake the heat and report back to Mara.');
      this.say('Mara', 'Last one, and it pays big. My crew is waiting at the pier. Collect them, lose the cops, then come see me. Do not lead the heat to my door.');
      this.target = { ...PIER_POS, r: 9 };
    } else {
      this.setObjective('Free Roam — Story Complete', 'Vice Harbor is yours. Earn cash, dodge the law, rule the streets.');
      this.target = null;
    }
  }

  completeMission(reward, line) {
    this.cash += reward;
    this.toast(`MISSION COMPLETE`, `+$${reward} — ${line}`);
    this.missionIndex += 1;
    this.persist();
    this.setupMission();
    this.refreshHud();
  }

  missionTick(dt) {
    if (this.missionIndex >= 4 || !this.target) {
      this.beacon.visible = false;
      return;
    }
    const t = this.target;
    this.beacon.visible = true;
    this.beacon.position.set(t.x, 23, t.z);
    this.beaconRing.rotation.z = this.time * 1.4;
    const px = this.playerCar ? this.playerCar.x : this.player.x;
    const pz = this.playerCar ? this.playerCar.z : this.player.z;
    const d = dist2d(px, pz, t.x, t.z);
    if (d > t.r) return;
    const m = this.missionIndex;
    if (m === 0) {
      this.say('Mara', 'There you are. I\u2019m Mara Voss — I run the jobs nobody else will touch. Prove you can drive, and this city will make you rich.');
      this.say('Mara', 'Wheels first. Any car on my streets is yours if you\u2019re quick — press F by a door. Just know the law watches thieves.');
      this.missionIndex = 1;
      this.persist();
      this.setupMission();
    } else if (m === 1 && this.missionStage === 0) {
      if (!this.playerCar) {
        this.setObjective('Mission 1 — First Run', 'You need a car for the pickup. Press F by any car to take it.');
        return;
      }
      this.missionStage = 1;
      this.hasPackage = true;
      this.addHeat(1, 'The depot cameras caught the pickup.');
      this.setObjective('Mission 1 — First Run', 'Package aboard. Deliver it to the garage on the north side.');
      this.say('Radio — Mara', 'Package is hot — a camera caught you. Deliver it fast, and don\u2019t scratch the merchandise.');
      this.target = { ...GARAGE_POS, r: 9 };
    } else if (m === 1 && this.missionStage === 1) {
      if (!this.playerCar) return;
      this.hasPackage = false;
      this.completeMission(300, 'The garage crew signs for the package.');
    } else if (m === 2 && this.missionStage === 0) {
      if (this.playerCar === this.specialCar) {
        this.missionStage = 1;
        this.setObjective('Mission 2 — Hot Wheels', 'Coupe secured. Deliver it to the garage — the law is watching.');
        this.target = { ...GARAGE_POS, r: 9 };
      }
    } else if (m === 2 && this.missionStage === 1) {
      if (this.playerCar !== this.specialCar) {
        this.setObjective('Mission 2 — Hot Wheels', 'The coupe must reach the garage — get back in it.');
        this.target = { x: this.specialCar.x, z: this.specialCar.z, r: 7 };
        this.missionStage = 0;
        return;
      }
      this.completeMission(500, 'The coupe disappears into the garage chop shop.');
    } else if (m === 3 && this.missionStage === 0) {
      if (!this.playerCar) {
        this.setObjective('Mission 3 — Harbor Heat', 'The crew will only board a car. Bring wheels to the pier.');
        return;
      }
      this.missionStage = 1;
      this.crewAboard = true;
      for (const c of this.crew) c.mesh.visible = false;
      this.addHeat(3, 'Harbour patrol spotted the pickup.');
      this.setObjective('Mission 3 — Harbor Heat', 'Crew aboard and the heat is on. Lose the police — break their line of sight.');
      this.say('Crew — Dario', 'Go go go! Half the harbour patrol just lit up behind us!');
      this.target = null;
    } else if (m === 3 && this.missionStage === 1) {
      // handled in wanted tick: when heat reaches 0, advance
    }
  }

  // ---------------------------------------------------------- crime & heat
  stars() {
    return this.heat <= 0 ? 0 : clamp(Math.ceil(this.heat), 1, 5);
  }

  addHeat(amount, reason) {
    const before = this.stars();
    this.heat = clamp(this.heat + amount, 0, 5);
    if (reason && this.stars() > before) this.toast('WANTED LEVEL UP', reason);
  }

  tryEnterExit() {
    if (this.state !== 'playing') return;
    if (this.playerCar) {
      const car = this.playerCar;
      this.playerCar = null;
      car.parked = true;
      this.player.x = car.x + Math.cos(car.heading) * 2.4;
      this.player.z = car.z - Math.sin(car.heading) * 2.4;
      [this.player.x, this.player.z] = this.city.collide(this.player.x, this.player.z, this.player.radius);
      this.player.mesh.visible = true;
      $('speedBox').classList.add('hidden');
      return;
    }
    // find the nearest stealable car: parked, or traffic stopped dead
    let best = null;
    let bestD = 3.6;
    for (const car of [...this.parked, ...this.traffic]) {
      if (car.dead) continue;
      const d = dist2d(this.player.x, this.player.z, car.x, car.z);
      if (d < bestD && Math.abs(car.speed) < 1.2) {
        best = car;
        bestD = d;
      }
    }
    if (!best) return;
    const wasTraffic = this.traffic.includes(best);
    if (wasTraffic) {
      this.traffic.splice(this.traffic.indexOf(best), 1);
      this.parked.push(best);
    }
    best.parked = false;
    this.playerCar = best;
    this.player.mesh.visible = false;
    $('speedBox').classList.remove('hidden');
    if (!best.everStolen) {
      best.everStolen = true;
      this.addHeat(1, 'Grand theft auto — a witness called it in.');
      for (const w of this.walkers) {
        if (dist2d(w.x, w.z, best.x, best.z) < 14) w.flee(best.x, best.z, 3);
      }
    }
    if (best === this.specialCar && this.missionIndex === 2 && this.missionStage === 0) {
      this.addHeat(1, 'The coupe\u2019s tracker pinged the law.');
    }
  }

  playerPos() {
    return this.playerCar ? { x: this.playerCar.x, z: this.playerCar.z } : { x: this.player.x, z: this.player.z };
  }

  damagePlayer(amount, cause) {
    if (this.state !== 'playing') return;
    this.health -= amount;
    $('vignette').style.boxShadow = 'inset 0 0 120px rgba(255,0,40,0.55)';
    setTimeout(() => { $('vignette').style.boxShadow = 'inset 0 0 120px rgba(255,0,40,0)'; }, 130);
    if (this.health <= 0) {
      this.health = 0;
      this.endRun('wasted', cause ?? 'You were wasted on the streets of Vice Harbor.');
    }
    this.refreshHud();
  }

  endRun(kind, text) {
    this.state = kind;
    const fee = Math.min(this.cash, 60);
    this.cash -= fee;
    const title = $('endTitle');
    title.textContent = kind === 'busted' ? 'BUSTED' : 'WASTED';
    title.className = kind;
    $('endText').textContent = `${text} The clinic and the lawyers take $${fee}.`;
    $('endScreen').classList.remove('hidden');
    $('hud').classList.add('hidden');
    this.persist();
  }

  respawn() {
    $('endScreen').classList.add('hidden');
    $('hud').classList.remove('hidden');
    this.health = 100;
    this.heat = 0;
    this.bust = 0;
    this.policeDespawnAll();
    if (this.playerCar) {
      this.playerCar.parked = true;
      this.playerCar = null;
    }
    this.player.mesh.visible = true;
    this.player.x = CLINIC_POS.x;
    this.player.z = CLINIC_POS.z;
    this.player.dead = false;
    this.player.health = 100;
    this.state = 'playing';
    if (this.missionIndex === 3 && this.missionStage === 1) {
      // crew pickup must be redone after a bust/wasting
      this.missionStage = 0;
      this.crewAboard = false;
      for (const c of this.crew) c.mesh.visible = true;
      this.target = { ...PIER_POS, r: 9 };
      this.setObjective('Mission 3 — Harbor Heat', 'Pick up Mara\u2019s crew at the pier, then shake the heat and report back to Mara.');
    }
    this.refreshHud();
  }

  policeDespawnAll() {
    for (const p of this.police) this.scene.remove(p.mesh);
    this.police = [];
  }

  // ---------------------------------------------------------- per-frame systems
  update(dt) {
    this.time += dt;
    if (this.city.water) this.city.water.material.color.setHSL(0.52, 0.72, 0.42 + Math.sin(this.time * 0.7) * 0.03);
    if (this.state === 'title') {
      // slow harbour orbit behind the title screen
      const r = 215;
      const a = this.time * 0.045 + 2.2;
      this.camera.position.set(Math.sin(a) * r, 62, HARBOR_Z - 60 + Math.cos(a) * 60);
      this.camera.lookAt(0, 8, 40);
      for (const c of this.traffic) this.updateTrafficCar(c, dt);
      for (const w of this.walkers) w.update(dt, this.city);
      return;
    }
    if (this.state !== 'playing') return;

    this.updatePlayer(dt);
    for (const c of this.traffic) this.updateTrafficCar(c, dt);
    for (const w of this.walkers) w.update(dt, this.city);
    this.updatePolice(dt);
    this.updateRivals(dt);
    this.updateDialogue(dt);
    this.missionTick(dt);
    this.wantedTick(dt);
    this.updateTracers(dt);
    if (this.toastT > 0) {
      this.toastT -= dt;
      if (this.toastT <= 0) $('toast').classList.add('hidden');
    }
    this.updateCamera(dt);
    this.refreshHud();
    this.drawMinimap();
  }

  updatePlayer(dt) {
    const k = this.keys;
    if (this.playerCar) {
      const car = this.playerCar;
      let throttle = 0;
      if (k.has('KeyW') || k.has('ArrowUp')) throttle = 1;
      if (k.has('KeyS') || k.has('ArrowDown')) throttle = -1;
      let steer = 0;
      if (k.has('KeyA') || k.has('ArrowLeft')) steer = 1;
      if (k.has('KeyD') || k.has('ArrowRight')) steer = -1;
      if (k.has('Space')) car.speed -= car.speed * 3.2 * dt; // handbrake
      const all = [...this.traffic, ...this.parked, ...this.police];
      const impact = car.step(dt, { throttle, steer }, this.city, all);
      if (impact > 13) {
        this.damagePlayer((impact - 12) * 1.1, 'The crash finished you.');
        this.addHeat(0.6, 'A hit-and-run was reported.');
      } else if (impact > 6) {
        this.addHeat(0.35, 'Reckless driving downtown.');
      }
      // running someone down is the fastest way to fill the stars
      for (const w of [...this.walkers, ...this.rivals]) {
        if (w.dead) continue;
        if (dist2d(w.x, w.z, car.x, car.z) < 1.9 && Math.abs(car.speed) > 3) {
          w.hurt(100);
          this.addHeat(1.6, 'You ran someone down in broad daylight.');
          this.toast('PEDESTRIAN DOWN', 'The whole street saw that.');
        }
      }
      this.player.x = car.x;
      this.player.z = car.z;
      $('speedVal').textContent = String(Math.round(Math.abs(car.speed) * 2.24));
      return;
    }
    // on foot
    const sprint = k.has('ShiftLeft') || k.has('ShiftRight');
    const spd = sprint ? 8.6 : 5.2;
    let mx = 0;
    let mz = 0;
    const fwd = this.camYaw;
    if (k.has('KeyW') || k.has('ArrowUp')) { mx += Math.sin(fwd); mz += Math.cos(fwd); }
    if (k.has('KeyS') || k.has('ArrowDown')) { mx -= Math.sin(fwd); mz -= Math.cos(fwd); }
    if (k.has('KeyA') || k.has('ArrowLeft')) { mx += Math.cos(fwd); mz -= Math.sin(fwd); }
    if (k.has('KeyD') || k.has('ArrowRight')) { mx -= Math.cos(fwd); mz += Math.sin(fwd); }
    const firing = this.mouseDown || k.has('Space') || this.forceFire === true;
    const len = Math.hypot(mx, mz);
    if (len > 0.01) {
      mx /= len;
      mz /= len;
      this.player.heading = Math.atan2(mx, mz);
      this.player.speed = spd;
      let nx = this.player.x + mx * spd * dt;
      let nz = this.player.z + mz * spd * dt;
      [nx, nz] = this.city.collide(nx, nz, this.player.radius);
      this.player.x = nx;
      this.player.z = nz;
    } else {
      this.player.speed = 0;
    }
    this.player.aiming = firing;
    if (firing) {
      this.player.heading = this.camYaw;
      this.fireCd -= dt;
      if (this.fireCd <= 0) {
        this.fireCd = 0.16;
        this.shoot();
      }
    }
    this.player.animate(dt);
    // context prompt
    const near = [...this.parked, ...this.traffic].some((c) => !c.dead && Math.abs(c.speed) < 1.2 && dist2d(c.x, c.z, this.player.x, this.player.z) < 3.6);
    const prompt = $('prompt');
    if (near) {
      prompt.innerHTML = '<b>F</b> — Enter car';
      prompt.classList.remove('hidden');
    } else if (this.missionIndex === 0 && dist2d(this.player.x, this.player.z, MARA_POS.x, MARA_POS.z) < 6) {
      prompt.innerHTML = '<b>Walk up</b> — Talk to Mara';
      prompt.classList.remove('hidden');
    } else {
      prompt.classList.add('hidden');
    }
  }

  updateTrafficCar(car, dt) {
    const ai = car.ai;
    if (!ai || car.dead) return;
    ai.turnCd -= dt;
    // obstacle scan: anything solid within a car-length ahead slows us down
    const fx = Math.sin(car.heading);
    const fz = Math.cos(car.heading);
    let blocked = false;
    const test = (ox, oz, r) => {
      const dx = ox - car.x;
      const dz = oz - car.z;
      const ahead = dx * fx + dz * fz;
      const side = Math.abs(dx * fz - dz * fx);
      if (ahead > 0.5 && ahead < r && side < 2.1) blocked = true;
    };
    for (const o of this.traffic) if (o !== car) test(o.x, o.z, 8.5);
    for (const o of this.parked) test(o.x, o.z, 8);
    for (const o of this.police) test(o.x, o.z, 8.5);
    if (this.playerCar) test(this.playerCar.x, this.playerCar.z, 8.5);
    if (!this.playerCar) test(this.player.x, this.player.z, 6);
    let throttle = 0;
    if (blocked) throttle = car.speed > 1 ? -0.9 : 0;
    else if (car.speed < ai.speedWanted) throttle = 0.75;
    // intersections: when close to a crossing, sometimes swing onto the other road
    const rx = nearestRoadLine(car.x);
    const rz = nearestRoadLine(car.z);
    let steer = 0;
    if (ai.axis === 'x') {
      const laneZ = ai.road + (ai.dir > 0 ? 4.2 : -4.2);
      steer = clamp(angleDelta(car.heading, ai.dir > 0 ? Math.PI / 2 : -Math.PI / 2) * 2.2, -1, 1);
      if (Math.abs(car.z - laneZ) > 0.4) steer = clamp(steer + (laneZ - car.z) * 0.04 * ai.dir, -1, 1);
      if (ai.turnCd <= 0 && Math.abs(car.x - rx) < 2.4 && Math.abs(car.z - ai.road) < ROAD_HALF && this.rng.chance(0.45)) {
        ai.axis = 'z';
        ai.road = rx;
        ai.dir = this.rng.chance(0.5) ? 1 : -1;
        ai.turnCd = 3.5;
      }
    } else {
      const laneX = ai.road + (ai.dir > 0 ? -4.2 : 4.2);
      steer = clamp(angleDelta(car.heading, ai.dir > 0 ? 0 : Math.PI) * 2.2, -1, 1);
      if (Math.abs(car.x - laneX) > 0.4) steer = clamp(steer - (laneX - car.x) * 0.04 * ai.dir, -1, 1);
      if (ai.turnCd <= 0 && Math.abs(car.z - rz) < 2.4 && Math.abs(car.x - ai.road) < ROAD_HALF && this.rng.chance(0.45)) {
        ai.axis = 'x';
        ai.road = rz;
        ai.dir = this.rng.chance(0.5) ? 1 : -1;
        ai.turnCd = 3.5;
      }
    }
    // city edge: turn around rather than leaving the world
    if (Math.abs(car.x) > CITY_EDGE - 6 || Math.abs(car.z) > CITY_EDGE - 6) {
      ai.dir = -ai.dir;
      ai.turnCd = 4;
      if (ai.axis === 'x' && Math.abs(car.x) > CITY_EDGE - 6) { ai.axis = 'z'; ai.road = nearestRoadLine(car.z); }
      if (ai.axis === 'z' && Math.abs(car.z) > CITY_EDGE - 6) { ai.axis = 'x'; ai.road = nearestRoadLine(car.x); }
    }
    car.step(dt, { throttle, steer }, this.city, [...this.traffic, ...this.parked, ...this.police, ...(this.playerCar ? [this.playerCar] : [])]);
  }

  wantedTick(dt) {
    const stars = this.stars();
    // police presence: keep roughly stars+1 units hunting
    const want = stars === 0 ? 0 : Math.min(5, stars + 1);
    if (this.police.length < want) this.spawnPolice();
    if (this.police.length > want + 1) {
      const extra = this.police.pop();
      this.scene.remove(extra.mesh);
    }
    // line of sight: any police close enough counts as "seen"
    const p = this.playerPos();
    let seen = false;
    for (const cop of this.police) {
      if (dist2d(cop.x, cop.z, p.x, p.z) < 52) { seen = true; break; }
    }
    if (seen) this.unseenT = 0;
    else this.unseenT += dt;
    if (this.unseenT > 5 && this.heat > 0) {
      this.heat = Math.max(0, this.heat - dt * 0.055);
      if (this.heat === 0) {
        this.toast('HEAT LOST', 'The law gives up the chase — for now.');
        if (this.missionIndex === 3 && this.missionStage === 1) {
          this.missionStage = 2;
          this.target = { ...MARA_POS, r: 5 };
          this.setObjective('Mission 3 — Harbor Heat', 'Heat lost. Report back to Mara at the boardwalk.');
        }
      }
    }
    if (this.missionIndex === 3 && this.missionStage === 2 && this.target) {
      if (dist2d(p.x, p.z, MARA_POS.x, MARA_POS.z) < 5) {
        this.target = null;
        this.say('Mara', 'Clean work. Crew safe, cops empty-handed, and my cut already spent. Vice Harbor remembers a driver like you.');
        this.completeMission(800, 'Mara\u2019s crew made it home.');
      }
    }
  }

  spawnPolice() {
    const p = this.playerPos();
    const ang = this.rng.float(0, Math.PI * 2);
    const x = clamp(p.x + Math.sin(ang) * 65, -CITY_EDGE, CITY_EDGE);
    const z = clamp(p.z + Math.cos(ang) * 65, -CITY_EDGE, CITY_EDGE);
    const cop = new Car(this.scene, 'police', 0xffffff, x, z, ang);
    this.police.push(cop);
  }

  updatePolice(dt) {
    const p = this.playerPos();
    const all = [...this.traffic, ...this.parked, ...this.police, ...(this.playerCar ? [this.playerCar] : [])];
    let nearest = Infinity;
    for (const cop of this.police) {
      cop.updateLights(this.time);
      const lead = this.playerCar ? clamp(this.playerCar.speed, 0, 30) : 0;
      const tx = p.x + (this.playerCar ? Math.sin(this.playerCar.heading) * lead * 0.35 : 0);
      const tz = p.z + (this.playerCar ? Math.cos(this.playerCar.heading) * lead * 0.35 : 0);
      const impact = steerToward(cop, tx, tz, dt, this.city, all, 1);
      const d = dist2d(cop.x, cop.z, p.x, p.z);
      nearest = Math.min(nearest, d);
      if (impact > 10 && this.playerCar) this.damagePlayer(4, 'A police ram shattered the window.');
    }
    // bust pressure: caught on foot (or parked) with a unit right on you
    const playerSpeed = this.playerCar ? Math.abs(this.playerCar.speed) : Math.abs(this.player.speed);
    if (this.stars() > 0 && nearest < 7.5 && playerSpeed < 2.2) {
      this.bust += dt / 2.6;
      $('bustWrap').classList.remove('hidden');
      $('bustFill').style.width = `${Math.round(this.bust * 100)}%`;
      if (this.bust >= 1) {
        this.bust = 0;
        $('bustWrap').classList.add('hidden');
        this.endRun('busted', 'The Vice Harbor PD finally boxed you in.');
      }
    } else {
      this.bust = Math.max(0, this.bust - dt * 0.7);
      if (this.bust <= 0) $('bustWrap').classList.add('hidden');
      else $('bustFill').style.width = `${Math.round(this.bust * 100)}%`;
    }
  }

  // ---------------------------------------------------------- combat
  shoot() {
    const p = this.player;
    const from = new THREE.Vector3(p.x, 1.5, p.z);
    const dir = new THREE.Vector3(Math.sin(p.heading), 0, Math.cos(p.heading));
    this.flash.position.copy(from).addScaledVector(dir, 1);
    this.flash.intensity = 26;
    setTimeout(() => { this.flash.intensity = 0; }, 45);
    let bestT = 46;
    let bestTarget = null;
    const testFigure = (fig) => {
      if (fig.dead) return;
      const to = new THREE.Vector3(fig.x - p.x, 0, fig.z - p.z);
      const t = to.dot(dir);
      if (t < 1 || t > bestT) return;
      const side = Math.abs(to.x * dir.z - to.z * dir.x);
      if (side < 0.85) {
        bestT = t;
        bestTarget = fig;
      }
    };
    for (const r of this.rivals) testFigure(r);
    for (const w of this.walkers) testFigure(w);
    const end = from.clone().addScaledVector(dir, bestTarget ? bestT : 30);
    this.addTracer(from.clone().addScaledVector(dir, 0.7), end, 0xffe45e);
    if (bestTarget) {
      const killed = bestTarget.hurt(34);
      if (bestTarget.isRival) {
        if (killed) {
          this.cash += 25;
          this.toast('RIVAL DOWN', '+$25 lifted from the fallen.');
          this.addHeat(0.8, 'Shots fired in the plaza.');
        }
      } else if (killed) {
        this.addHeat(2, 'You gunned down a bystander.');
      } else {
        this.addHeat(1, 'You shot a bystander.');
        bestTarget.flee?.(p.x, p.z, 5);
      }
    } else {
      this.addHeat(0.45, 'Shots fired downtown.');
    }
    for (const w of this.walkers) {
      if (!w.dead && dist2d(w.x, w.z, p.x, p.z) < 16) w.flee(p.x, p.z, 3.5);
    }
    this.refreshHud();
  }

  addTracer(a, b, color) {
    const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95 }));
    this.scene.add(line);
    this.tracers.push({ line, life: 0.07 });
  }

  updateTracers(dt) {
    for (let i = this.tracers.length - 1; i >= 0; i -= 1) {
      const t = this.tracers[i];
      t.life -= dt;
      if (t.life <= 0) {
        this.scene.remove(t.line);
        t.line.geometry.dispose();
        this.tracers.splice(i, 1);
      }
    }
  }

  updateRivals(dt) {
    const p = this.player;
    for (const r of this.rivals) {
      if (r.dead) {
        r.animate(dt);
        continue;
      }
      const d = dist2d(r.x, r.z, p.x, p.z);
      const hostile = !this.playerCar && d < 30 && (this.player.aiming || d < 13 || this.missionIndex >= 1);
      r.aiming = hostile;
      if (hostile) {
        r.heading = Math.atan2(p.x - r.x, p.z - r.z);
        r.fireCd -= dt;
        if (r.fireCd <= 0 && d > 2) {
          r.fireCd = this.rng.float(0.55, 1.1);
          const from = new THREE.Vector3(r.x, 1.5, r.z);
          const to = new THREE.Vector3(p.x, 1.3, p.z);
          this.addTracer(from, to, 0xff5964);
          const hitChance = clamp(0.62 - d * 0.012, 0.18, 0.6);
          if (this.rng.chance(hitChance)) this.damagePlayer(this.rng.float(4, 9), 'Rival fire cut you down in the plaza.');
        }
      }
      r.animate(dt);
    }
  }

  // ---------------------------------------------------------- dialogue, toast, HUD
  updateDialogue(dt) {
    const box = $('dialogue');
    if (this.dialogueQueue.length === 0) {
      box.classList.add('hidden');
      return;
    }
    const cur = this.dialogueQueue[0];
    if (this.dialogueT <= 0) {
      $('dialogueName').textContent = cur.name;
      $('dialogueText').textContent = cur.text;
      this.dialogueT = cur.seconds;
    }
    box.classList.remove('hidden');
    this.dialogueT -= dt;
    if (this.dialogueT <= 0) this.dialogueQueue.shift();
  }

  toast(title, sub) {
    const el = $('toast');
    el.innerHTML = `${title}<small>${sub}</small>`;
    el.classList.remove('hidden');
    this.toastT = 3.4;
  }

  refreshHud() {
    $('cashVal').textContent = `$${Math.floor(this.cash)}`;
    $('healthFill').style.width = `${clamp(this.health, 0, 100)}%`;
    const s = this.stars();
    let html = '';
    for (let i = 0; i < 5; i += 1) html += i < s ? '★' : '<span class="off">★</span>';
    $('starsVal').innerHTML = html;
  }

  drawMinimap() {
    const cv = $('minimap');
    const g = cv.getContext('2d');
    const W = cv.width;
    const scale = W / 300; // 300 m across the map view
    const p = this.playerPos();
    const toMap = (x, z) => [W / 2 + (x - p.x) * scale, W / 2 + (z - p.z) * scale];
    g.fillStyle = '#17242f';
    g.fillRect(0, 0, W, W);
    // harbour water at the south
    g.fillStyle = '#1f7d99';
    const [, wy] = toMap(0, HARBOR_Z);
    if (wy < W) g.fillRect(0, Math.max(0, wy), W, W - Math.max(0, wy));
    // roads
    g.strokeStyle = '#4d6070';
    g.lineWidth = ROAD_HALF * 2 * scale * 0.6;
    for (const r of ROAD_LINES) {
      const [rx] = toMap(r, 0);
      g.beginPath(); g.moveTo(rx, 0); g.lineTo(rx, W); g.stroke();
      const [, ry] = toMap(0, r);
      g.beginPath(); g.moveTo(0, ry); g.lineTo(W, ry); g.stroke();
    }
    const dot = (x, z, color, size) => {
      const [mx, my] = toMap(x, z);
      if (mx < -4 || my < -4 || mx > W + 4 || my > W + 4) return;
      g.fillStyle = color;
      g.beginPath();
      g.arc(mx, my, size, 0, Math.PI * 2);
      g.fill();
    };
    for (const c of this.traffic) dot(c.x, c.z, '#aab6c0', 2);
    for (const c of this.parked) dot(c.x, c.z, '#77828c', 2);
    for (const c of this.police) dot(c.x, c.z, Math.sin(this.time * 10) > 0 ? '#ff4040' : '#4080ff', 3);
    for (const r of this.rivals) if (!r.dead) dot(r.x, r.z, '#ff5964', 2.4);
    if (this.target) {
      const [mx, my] = toMap(this.target.x, this.target.z);
      g.strokeStyle = '#ffd32a';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(clamp(mx, 8, W - 8), clamp(my, 8, W - 8), 5 + Math.sin(this.time * 5) * 1.4, 0, Math.PI * 2);
      g.stroke();
    }
    // player arrow at the centre, rotated to the facing in map space
    const heading = this.playerCar ? this.playerCar.heading : this.player.heading;
    g.save();
    g.translate(W / 2, W / 2);
    g.rotate(-heading + Math.PI);
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(0, -6);
    g.lineTo(4.4, 5);
    g.lineTo(-4.4, 5);
    g.closePath();
    g.fill();
    g.restore();
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.font = 'bold 10px Arial';
    g.fillText('N', W / 2 - 3, 12);
  }

  updateCamera(dt) {
    const inCar = !!this.playerCar;
    const target = inCar
      ? new THREE.Vector3(this.playerCar.x, 2.1, this.playerCar.z)
      : new THREE.Vector3(this.player.x, 1.7, this.player.z);
    if (inCar && Math.abs(this.playerCar.speed) > 3 && !this.mouseDown) {
      // drift the camera behind the car while it moves
      const delta = angleDelta(this.camYaw, this.playerCar.heading);
      this.camYaw += delta * Math.min(1, dt * 1.8);
    }
    const dist = inCar ? Math.max(this.camDist, 10.5) : this.camDist;
    const cx = target.x - Math.sin(this.camYaw) * Math.cos(this.camPitch) * dist;
    const cz = target.z - Math.cos(this.camYaw) * Math.cos(this.camPitch) * dist;
    const cy = target.y + Math.sin(this.camPitch) * dist;
    this.camera.position.set(cx, Math.max(cy, 1.6), cz);
    this.camera.lookAt(target);
    this.sun.position.set(target.x + 140, 210, target.z + 90);
    this.sun.target.position.set(target.x, 0, target.z);
    this.sun.target.updateMatrixWorld();
  }

  // ---------------------------------------------------------- screenshot staging
  /**
   * Deterministic scenes for the entry screenshots. Each one starts the
   * real game, moves the real actors into a readable moment, and lets the
   * simulation run for a fixed number of fixed-step frames before main.js
   * raises window.__shotReady.
   */
  stageShot(name) {
    this.readyFrame = 45;
    if (name === 'start') {
      this.readyFrame = 40;
      return; // title screen over the harbour orbit, exactly as players meet it
    }
    this.startGame(false);
    this.dialogueQueue = [];
    if (name === 'drive') {
      this.missionIndex = 1;
      this.setupMission();
      this.dialogueQueue = [];
      const car = this.parked[0];
      car.x = -96;
      car.z = HARBOR_Z - 12 + 4.2;
      car.heading = Math.PI / 2;
      car.speed = 17;
      car.parked = false;
      this.playerCar = car;
      this.player.mesh.visible = false;
      $('speedBox').classList.remove('hidden');
      this.camYaw = Math.PI / 2;
      this.camPitch = 0.3;
      this.readyFrame = 52;
    } else if (name === 'chase') {
      this.player.x = 14;
      this.player.z = 16;
      this.player.heading = Math.atan2(8 - 14, 27 - 16);
      this.camYaw = this.player.heading;
      this.camPitch = 0.36;
      this.camDist = 10.5;
      this.health = 82;
      this.heat = 3;
      this.policeDespawnAll();
      const cop1 = new Car(this.scene, 'police', 0xffffff, 8, 27, Math.PI);
      cop1.speed = 2;
      const cop2 = new Car(this.scene, 'police', 0xffffff, 27, 9, -Math.PI / 2);
      cop2.speed = 3;
      this.police.push(cop1, cop2);
      this.setObjective('WANTED — 3 STARS', 'The Vice Harbor PD has you cornered at the central crossing. Run, or be busted.');
      this.readyFrame = 38;
    } else if (name === 'mission') {
      // the delivery leg: package aboard, northbound through the tower
      // canyon toward the garage beacon — objective, dialogue and minimap
      // marker all live in one frame.
      this.missionIndex = 1;
      this.missionStage = 1;
      this.hasPackage = true;
      this.setupMission();
      this.missionStage = 1;
      this.hasPackage = true;
      this.target = { ...GARAGE_POS, r: 9 };
      this.setObjective('Mission 1 — First Run', 'Package aboard. Deliver it to the garage on the north side.');
      this.dialogueQueue = [];
      this.say('Radio — Mara', 'Garage is straight up the avenue, gold beacon marks the door. Package first, questions later.');
      const car = this.parked[3];
      car.x = 76 - 4.2;
      car.z = -158;
      car.heading = Math.PI;
      car.speed = 13;
      car.parked = false;
      this.playerCar = car;
      this.player.mesh.visible = false;
      $('speedBox').classList.remove('hidden');
      this.camYaw = Math.PI;
      this.camPitch = 0.32;
      this.readyFrame = 46;
    } else if (name === 'combat') {
      this.missionIndex = 1;
      this.setupMission();
      this.dialogueQueue = [];
      this.player.x = 63;
      this.player.z = 63;
      this.player.heading = Math.PI / 4;
      this.camYaw = Math.PI / 4;
      this.camPitch = 0.3;
      this.camDist = 8;
      this.health = 64;
      this.heat = 1;
      this.forceFire = true;
      this.rivals[0].hurt(100); // one rival already down in the crossfire
      this.setObjective('Turf War', 'The Ash Street crew holds the east-central crossing. Clear them out.');
      this.readyFrame = 58;
    }
    this.refreshHud();
  }
}
