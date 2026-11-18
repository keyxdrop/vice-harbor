// People of Vice Harbor: one articulated low-poly figure builder drives the
// player, the sidewalk crowds, Mara the fixer, the harbour crew and the
// rival crew. Limbs swing from a walk phase; a figure can also aim (combat
// stance), take damage, and go down.
import * as THREE from 'three';
import { clamp } from './rng.js';

const skinTones = [0xf2c79b, 0xc68863, 0x8d5524, 0xffdbac];
const shirtColors = [0xff5964, 0x38618c, 0x43aa8b, 0xf9c74f, 0x9b5de5, 0x00bbf9, 0xf15bb5, 0x90be6d];
const pantsColors = [0x2b2d42, 0x555b6e, 0x6d597a, 0x355070, 0x22333b];

export function buildPerson(rng, opts = {}) {
  const g = new THREE.Group();
  const skin = new THREE.MeshLambertMaterial({ color: opts.skin ?? rng.pick(skinTones) });
  const shirt = new THREE.MeshLambertMaterial({ color: opts.shirt ?? rng.pick(shirtColors) });
  const pants = new THREE.MeshLambertMaterial({ color: opts.pants ?? rng.pick(pantsColors) });
  const hairMat = new THREE.MeshLambertMaterial({ color: opts.hair ?? 0x241a12 });

  const legGeo = new THREE.BoxGeometry(0.21, 0.78, 0.24);
  legGeo.translate(0, -0.39, 0);
  const legL = new THREE.Mesh(legGeo, pants);
  legL.position.set(-0.14, 0.82, 0);
  const legR = new THREE.Mesh(legGeo, pants);
  legR.position.set(0.14, 0.82, 0);
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.68, 0.3), shirt);
  torso.position.y = 1.16;
  torso.castShadow = true;
  const armGeo = new THREE.BoxGeometry(0.16, 0.66, 0.18);
  armGeo.translate(0, -0.3, 0);
  const armL = new THREE.Mesh(armGeo, shirt);
  armL.position.set(-0.37, 1.44, 0);
  const armR = new THREE.Mesh(armGeo, shirt);
  armR.position.set(0.37, 1.44, 0);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.38, 0.34), skin);
  head.position.y = 1.72;
  head.castShadow = true;
  const hair = new THREE.Mesh(new THREE.BoxGeometry(0.37, 0.12, 0.37), hairMat);
  hair.position.y = 1.94;
  // a simple pistol the figure can raise: hidden until aiming
  const gun = new THREE.Group();
  const gunBody = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.14, 0.42), new THREE.MeshLambertMaterial({ color: 0x191c20 }));
  gunBody.position.set(0, -0.62, 0.18);
  gun.add(gunBody);
  gun.position.copy(armR.position);
  gun.visible = false;
  g.add(legL, legR, torso, armL, armR, head, hair, gun);
  g.userData = { legL, legR, armL, armR, gun, torso };
  return g;
}

export class Person {
  constructor(scene, rng, opts = {}) {
    this.mesh = buildPerson(rng, opts);
    scene.add(this.mesh);
    this.x = opts.x ?? 0;
    this.z = opts.z ?? 0;
    this.heading = opts.heading ?? 0;
    this.speed = 0;
    this.walkPhase = 0;
    this.health = opts.health ?? 100;
    this.dead = false;
    this.aiming = false;
    this.radius = 0.55;
    this.syncMesh();
  }

  syncMesh() {
    this.mesh.position.set(this.x, 0.18, this.z);
    this.mesh.rotation.y = this.heading;
  }

  /** Animate limbs for the current speed; aiming raises the gun arm. */
  animate(dt) {
    const u = this.mesh.userData;
    if (this.dead) {
      this.mesh.rotation.x = -Math.PI / 2;
      this.mesh.position.y = 0.35;
      return;
    }
    this.mesh.rotation.x = 0;
    this.mesh.position.y = 0.18;
    this.walkPhase += dt * (2.2 + Math.abs(this.speed) * 1.9);
    const swing = clamp(Math.abs(this.speed) / 3.4, 0, 1) * 0.62;
    const s = Math.sin(this.walkPhase * 3.1) * swing;
    u.legL.rotation.x = s;
    u.legR.rotation.x = -s;
    if (this.aiming) {
      u.armR.rotation.x = -Math.PI / 2 + 0.08;
      u.armL.rotation.x = s * 0.4;
      u.gun.visible = true;
    } else {
      u.armL.rotation.x = -s * 0.8;
      u.armR.rotation.x = s * 0.8;
      u.gun.visible = false;
    }
    this.syncMesh();
  }

  hurt(amount) {
    if (this.dead) return true;
    this.health -= amount;
    if (this.health <= 0) {
      this.health = 0;
      this.dead = true;
      return true;
    }
    return false;
  }
}

/**
 * A sidewalk walker: follows the pavement ring around one city block,
 * turning at corners, forever. Flee mode sends them sprinting away from a
 * threat point for a few seconds.
 */
export class Walker extends Person {
  constructor(scene, rng, ring) {
    super(scene, rng, { x: ring.x0, z: ring.z0 });
    this.ring = ring; // {x0,z0,x1,z1} pavement rectangle corners
    this.corner = 0;
    this.baseSpeed = rng.float(1.1, 2.0);
    this.fleeT = 0;
    this.fleeFrom = null;
  }

  corners() {
    const r = this.ring;
    return [[r.x0, r.z0], [r.x1, r.z0], [r.x1, r.z1], [r.x0, r.z1]];
  }

  flee(fromX, fromZ, seconds = 4) {
    this.fleeT = seconds;
    this.fleeFrom = [fromX, fromZ];
  }

  update(dt, city) {
    if (this.dead) {
      this.animate(dt);
      return;
    }
    let tx;
    let tz;
    let spd = this.baseSpeed;
    if (this.fleeT > 0 && this.fleeFrom) {
      this.fleeT -= dt;
      const dx = this.x - this.fleeFrom[0];
      const dz = this.z - this.fleeFrom[1];
      const d = Math.hypot(dx, dz) || 1;
      tx = this.x + (dx / d) * 12;
      tz = this.z + (dz / d) * 12;
      spd = 5.4;
    } else {
      const cs = this.corners();
      const [cx, cz] = cs[this.corner];
      tx = cx;
      tz = cz;
      if (Math.hypot(cx - this.x, cz - this.z) < 0.7) {
        this.corner = (this.corner + 1) % 4;
        return;
      }
    }
    const want = Math.atan2(tx - this.x, tz - this.z);
    let dh = want - this.heading;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    this.heading += clamp(dh, -3.4 * dt, 3.4 * dt);
    this.speed = spd;
    let nx = this.x + Math.sin(this.heading) * spd * dt;
    let nz = this.z + Math.cos(this.heading) * spd * dt;
    [nx, nz] = city.collide(nx, nz, this.radius);
    this.x = nx;
    this.z = nz;
    this.animate(dt);
  }
}
