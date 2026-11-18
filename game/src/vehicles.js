// Cars for Vice Harbor: chunky low-poly builds with readable silhouettes —
// sedan, sports coupe, taxi, van and the black-and-white police interceptor
// with a working light bar. Physics is arcade: strong acceleration, eager
// brakes, steering that bites harder the faster you go (up to a point).
import * as THREE from 'three';
import { clamp, angleDelta } from './rng.js';

const CAR_COLORS = [0xe74c3c, 0x3498db, 0xf1c40f, 0x2ecc71, 0xe67e22, 0x9b59b6, 0xecf0f1, 0x1abc9c, 0xfd79a8, 0x00cec9];

export function carPaint(i) {
  return CAR_COLORS[i % CAR_COLORS.length];
}

const bodyMatCache = new Map();
function paintMat(hex) {
  if (!bodyMatCache.has(hex)) bodyMatCache.set(hex, new THREE.MeshLambertMaterial({ color: hex }));
  return bodyMatCache.get(hex);
}
const glassMat = new THREE.MeshLambertMaterial({ color: 0x1b2a3a });
const tyreMat = new THREE.MeshLambertMaterial({ color: 0x15161a });
const chromeMat = new THREE.MeshLambertMaterial({ color: 0xd7dde3 });
const headMat = new THREE.MeshBasicMaterial({ color: 0xfff6c9 });
const tailMat = new THREE.MeshBasicMaterial({ color: 0xff3b30 });

export function buildCarMesh(kind, colorHex) {
  const g = new THREE.Group();
  const sports = kind === 'sports';
  const van = kind === 'van';
  const police = kind === 'police';
  const taxi = kind === 'taxi';
  const len = van ? 5.4 : sports ? 4.6 : 4.9;
  const wid = van ? 2.2 : 2.05;
  const bodyH = van ? 1.5 : sports ? 0.62 : 0.78;
  const bodyY = van ? 1.15 : 0.72;
  const paint = police ? 0xf4f6f6 : taxi ? 0xf7b731 : colorHex;
  const body = new THREE.Mesh(new THREE.BoxGeometry(wid, bodyH, len), paintMat(paint));
  body.position.y = bodyY;
  body.castShadow = true;
  g.add(body);
  if (police) {
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(wid + 0.04, bodyH * 0.52, len * 0.94), paintMat(0x14181f));
    stripe.position.y = bodyY - 0.05;
    g.add(stripe);
  }
  if (!van) {
    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(wid * 0.82, sports ? 0.5 : 0.62, len * (sports ? 0.42 : 0.48)),
      glassMat,
    );
    cabin.position.set(0, bodyY + bodyH / 2 + (sports ? 0.22 : 0.28), sports ? -0.2 : -0.1);
    cabin.castShadow = true;
    g.add(cabin);
  } else {
    const cabGlass = new THREE.Mesh(new THREE.BoxGeometry(wid * 0.9, 0.6, 0.2), glassMat);
    cabGlass.position.set(0, bodyY + 0.35, len / 2 - 0.35);
    g.add(cabGlass);
  }
  if (sports) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(wid * 0.95, 0.09, 0.5), paintMat(0x14181f));
    wing.position.set(0, bodyY + bodyH / 2 + 0.28, -len / 2 + 0.3);
    g.add(wing);
  }
  if (taxi) {
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.28, 0.4), new THREE.MeshBasicMaterial({ color: 0xffe45e }));
    sign.position.set(0, bodyY + bodyH / 2 + 0.5, -0.1);
    g.add(sign);
  }
  // wheels
  const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.3, 10);
  const wheels = [];
  const wx = wid / 2 - 0.05;
  const wz = len / 2 - 0.95;
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const w = new THREE.Mesh(wheelGeo, tyreMat);
    w.rotation.z = Math.PI / 2;
    w.position.set(sx * wx, 0.42, sz * wz);
    w.castShadow = true;
    g.add(w);
    wheels.push(w);
  }
  // lights
  for (const sx of [-1, 1]) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.18, 0.08), headMat);
    h.position.set(sx * wid * 0.32, bodyY + 0.05, len / 2 + 0.02);
    g.add(h);
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.08), tailMat);
    t.position.set(sx * wid * 0.32, bodyY + 0.05, -len / 2 - 0.02);
    g.add(t);
    const bumper = new THREE.Mesh(new THREE.BoxGeometry(wid * 0.98, 0.22, 0.18), chromeMat);
    bumper.position.set(0, 0.42, len / 2 + 0.02);
    g.add(bumper);
  }
  let lightBar = null;
  if (police) {
    lightBar = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.14, 0.5), paintMat(0x14181f));
    lightBar.add(base);
    const red = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.2, 0.44), new THREE.MeshBasicMaterial({ color: 0xff2222 }));
    red.position.set(-0.36, 0.16, 0);
    lightBar.add(red);
    const blue = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.2, 0.44), new THREE.MeshBasicMaterial({ color: 0x2255ff }));
    blue.position.set(0.36, 0.16, 0);
    lightBar.add(blue);
    lightBar.position.set(0, bodyY + bodyH / 2 + 0.42, -0.1);
    g.add(lightBar);
    lightBar.userData.red = red;
    lightBar.userData.blue = blue;
  }
  g.userData.wheels = wheels;
  g.userData.lightBar = lightBar;
  g.userData.len = len;
  return g;
}

export class Car {
  constructor(scene, kind, colorHex, x, z, heading) {
    this.kind = kind;
    this.mesh = buildCarMesh(kind, colorHex);
    this.mesh.position.set(x, 0, z);
    this.mesh.rotation.y = heading;
    scene.add(this.mesh);
    this.x = x;
    this.z = z;
    this.heading = heading;
    this.speed = 0;
    this.steerVis = 0;
    this.radius = 1.7;
    this.maxSpeed = kind === 'sports' ? 43 : kind === 'police' ? 40 : kind === 'van' ? 27 : 34;
    this.accel = kind === 'sports' ? 17 : kind === 'police' ? 16 : 12.5;
    this.health = 100;
    this.dead = false;
  }

  get pos() {
    return this.mesh.position;
  }

  /**
   * Advance the car. input: {throttle -1..1, steer -1..1}. Returns impact
   * speed lost to collisions this step (0 when clean) so callers can price
   * crashes into wanted/health.
   */
  step(dt, input, city, others) {
    if (this.dead) return 0;
    const throttle = clamp(input.throttle, -1, 1);
    const steer = clamp(input.steer, -1, 1);
    if (throttle > 0) this.speed += this.accel * throttle * dt * (1 - Math.max(0, this.speed) / (this.maxSpeed * 1.15));
    else if (throttle < 0) {
      if (this.speed > 0.5) this.speed -= 26 * dt; // brake
      else this.speed = Math.max(-11, this.speed - 9 * dt); // reverse
    }
    // rolling drag + handbrake-ish decay
    this.speed -= this.speed * 0.55 * dt;
    if (Math.abs(this.speed) < 0.04 && throttle === 0) this.speed = 0;
    const steerAuthority = clamp(Math.abs(this.speed) / 7, 0, 1) * (this.speed >= 0 ? 1 : -1);
    this.heading += steer * 1.65 * steerAuthority * dt * -1;
    this.steerVis = steer;
    let nx = this.x + Math.sin(this.heading) * this.speed * dt;
    let nz = this.z + Math.cos(this.heading) * this.speed * dt;
    let impact = 0;
    const [cx, cz, hitWall] = city.collide(nx, nz, this.radius);
    if (hitWall && Math.abs(this.speed) > 3) impact = Math.abs(this.speed);
    nx = cx;
    nz = cz;
    if (hitWall) this.speed *= 0.35;
    // other cars: soft circle push, hard speed cut on a real shunt
    for (const o of others) {
      if (o === this || o.dead) continue;
      const dx = nx - o.x;
      const dz = nz - o.z;
      const d = Math.hypot(dx, dz);
      const min = this.radius + o.radius - 0.25;
      if (d > 0.001 && d < min) {
        const push = (min - d) / 2;
        nx += (dx / d) * push;
        nz += (dz / d) * push;
        if (Math.abs(this.speed) > 4) impact = Math.max(impact, Math.abs(this.speed) * 0.7);
        this.speed *= 0.55;
      }
    }
    this.x = nx;
    this.z = nz;
    this.mesh.position.set(this.x, 0, this.z);
    this.mesh.rotation.y = this.heading;
    // wheel spin + front steer visuals
    const wheels = this.mesh.userData.wheels;
    const spin = (this.speed * dt) / 0.42;
    for (let i = 0; i < wheels.length; i += 1) {
      wheels[i].rotation.x += spin;
      if (i < 2) wheels[i].rotation.y = -this.steerVis * 0.42;
    }
    // body lean into corners, squat under acceleration
    this.mesh.rotation.z = -this.steerVis * clamp(Math.abs(this.speed) / 40, 0, 1) * 0.05;
    return impact;
  }

  /** Flash the police light bar (call every frame for police cars). */
  updateLights(t) {
    const bar = this.mesh.userData.lightBar;
    if (!bar) return;
    const phase = Math.sin(t * 14) > 0;
    bar.userData.red.material.color.setHex(phase ? 0xff2222 : 0x551111);
    bar.userData.blue.material.color.setHex(phase ? 0x1133aa : 0x3377ff);
  }
}

/** Lane offset for right-hand traffic given a travel direction (dx, dz). */
export function laneOffset(dx, dz) {
  // driving east (+x): keep to the south lane; west: north lane; etc.
  if (dx > 0) return [0, 4.2];
  if (dx < 0) return [0, -4.2];
  if (dz > 0) return [-4.2, 0];
  return [4.2, 0];
}

/** Steer a free-driving car (police) toward a target point. */
export function steerToward(car, tx, tz, dt, city, others, throttleScale = 1) {
  const want = Math.atan2(tx - car.x, tz - car.z);
  const delta = angleDelta(car.heading, want);
  const steer = clamp(delta * 1.9, -1, 1);
  const dist = Math.hypot(tx - car.x, tz - car.z);
  const throttle = dist > 4 ? throttleScale : 0.2;
  return car.step(dt, { throttle, steer }, city, others);
}
