// Vice Harbor city generation: a sunlit coastal grid of streets, pastel
// towers, palms and a working harbour to the south. Everything is placed
// from one seeded stream, and every solid building registers an AABB
// collider the physics step can push against.
import * as THREE from 'three';
import { Rng } from './rng.js';

export const ROAD_LINES = [-228, -152, -76, 0, 76, 152, 228];
export const ROAD_HALF = 9; // asphalt half width
export const CITY_EDGE = 262; // playable ground half extent
export const HARBOR_Z = 268; // waterline: land ends, harbour begins

const PALETTE = [0xffd9a0, 0xffb4a2, 0xa2d2ff, 0xb9fbc0, 0xffc6ff, 0xfdfcdc, 0x90e0c8, 0xffadad];

function facadeTexture(rng, baseHex) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 256;
  const g = c.getContext('2d');
  const base = new THREE.Color(baseHex);
  g.fillStyle = `#${base.getHexString()}`;
  g.fillRect(0, 0, 128, 256);
  // subtle vertical shading so flat walls still read as architecture
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, 'rgba(255,255,255,0.14)');
  grad.addColorStop(1, 'rgba(0,0,0,0.16)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 256);
  const cols = 6;
  const rows = 12;
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const lit = rng.chance(0.24);
      g.fillStyle = lit ? 'rgba(255,236,170,0.95)' : 'rgba(24,42,66,0.85)';
      g.fillRect(8 + x * 20, 10 + y * 20, 12, 13);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export class City {
  constructor(scene, seed) {
    this.rng = new Rng(seed * 7919 + 13);
    this.colliders = []; // {minX, maxX, minZ, maxZ}
    this.group = new THREE.Group();
    scene.add(this.group);
    this.water = null;
    this.buildGround();
    this.buildRoads();
    this.buildBlocks();
    this.buildHarbor();
    this.buildProps();
  }

  addCollider(x, z, w, d) {
    this.colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
  }

  buildGround() {
    const rng = this.rng;
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(CITY_EDGE * 2 + 240, CITY_EDGE * 2 + 240),
      new THREE.MeshLambertMaterial({ color: 0x8fbf6f }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.05;
    ground.receiveShadow = true;
    this.group.add(ground);
    // sidewalk slabs under every block: pale concrete between the roads
    const slabMat = new THREE.MeshLambertMaterial({ color: 0xcfd4d8 });
    for (let i = 0; i < ROAD_LINES.length - 1; i += 1) {
      for (let j = 0; j < ROAD_LINES.length - 1; j += 1) {
        const cx = (ROAD_LINES[i] + ROAD_LINES[i + 1]) / 2;
        const cz = (ROAD_LINES[j] + ROAD_LINES[j + 1]) / 2;
        const span = ROAD_LINES[i + 1] - ROAD_LINES[i] - ROAD_HALF * 2;
        const slab = new THREE.Mesh(new THREE.BoxGeometry(span + 2, 0.24, span + 2), slabMat);
        slab.position.set(cx, 0.07, cz);
        slab.receiveShadow = true;
        this.group.add(slab);
      }
    }
    void rng;
  }

  buildRoads() {
    const asphalt = new THREE.MeshLambertMaterial({ color: 0x35383e });
    const dashMat = new THREE.MeshBasicMaterial({ color: 0xf5eeda });
    // A plane laid flat (rotation.x only) keeps its width along x and its
    // height along z — so east-west roads use a wide-short plane and
    // north-south roads a narrow-long one. (Adding rotation.z here would
    // silently swap the axes; the first build learned that the hard way.)
    const ewGeo = new THREE.PlaneGeometry(560, ROAD_HALF * 2);
    const nsGeo = new THREE.PlaneGeometry(ROAD_HALF * 2, 560);
    const dashEW = new THREE.PlaneGeometry(7, 1.1);
    const dashNS = new THREE.PlaneGeometry(1.1, 7);
    for (const r of ROAD_LINES) {
      const ew = new THREE.Mesh(ewGeo, asphalt);
      ew.rotation.x = -Math.PI / 2;
      ew.position.set(0, 0.02, r);
      ew.receiveShadow = true;
      this.group.add(ew);
      const ns = new THREE.Mesh(nsGeo, asphalt);
      ns.rotation.x = -Math.PI / 2;
      ns.position.set(r, 0.02, 0);
      ns.receiveShadow = true;
      this.group.add(ns);
      // dashed centre lines, skipping the intersection boxes
      for (let s = -266; s < 266; s += 16) {
        if (ROAD_LINES.some((o) => Math.abs(o - s) < 13)) continue;
        const d1 = new THREE.Mesh(dashEW, dashMat);
        d1.rotation.x = -Math.PI / 2;
        d1.position.set(s + 4, 0.05, r);
        this.group.add(d1);
        const d2 = new THREE.Mesh(dashNS, dashMat);
        d2.rotation.x = -Math.PI / 2;
        d2.position.set(r, 0.05, s + 4);
        this.group.add(d2);
      }
    }
    // the coast road runs along the harbour (plane's long axis is already x)
    const coast = new THREE.Mesh(new THREE.PlaneGeometry(560, ROAD_HALF * 2), asphalt);
    coast.rotation.x = -Math.PI / 2;
    coast.position.set(0, 0.02, HARBOR_Z - 12);
    coast.receiveShadow = true;
    this.group.add(coast);
  }

  buildBlocks() {
    const rng = this.rng;
    const textures = PALETTE.map((hex) => facadeTexture(rng, hex));
    const roofMat = new THREE.MeshLambertMaterial({ color: 0x6b5d54 });
    for (let i = 0; i < ROAD_LINES.length - 1; i += 1) {
      for (let j = 0; j < ROAD_LINES.length - 1; j += 1) {
        const cx = (ROAD_LINES[i] + ROAD_LINES[i + 1]) / 2;
        const cz = (ROAD_LINES[j] + ROAD_LINES[j + 1]) / 2;
        const span = ROAD_LINES[i + 1] - ROAD_LINES[i] - ROAD_HALF * 2 - 8;
        const towers = rng.chance(0.45) ? 1 : 4;
        const spots = towers === 1
          ? [{ x: cx, z: cz, w: span * 0.82, d: span * 0.82 }]
          : [
              { x: cx - span / 4, z: cz - span / 4, w: span * 0.4, d: span * 0.4 },
              { x: cx + span / 4, z: cz - span / 4, w: span * 0.4, d: span * 0.4 },
              { x: cx - span / 4, z: cz + span / 4, w: span * 0.4, d: span * 0.4 },
              { x: cx + span / 4, z: cz + span / 4, w: span * 0.4, d: span * 0.4 },
            ];
        for (const s of spots) {
          if (towers === 4 && rng.chance(0.18)) continue; // a plaza gap here and there
          const h = rng.float(12, 52) * (towers === 1 ? 1.25 : 1);
          const tex = rng.pick(textures);
          const mat = new THREE.MeshLambertMaterial({ map: tex });
          const box = new THREE.Mesh(new THREE.BoxGeometry(s.w, h, s.d), mat);
          box.position.set(s.x, h / 2 + 0.2, s.z);
          box.castShadow = true;
          box.receiveShadow = true;
          this.group.add(box);
          const roof = new THREE.Mesh(new THREE.BoxGeometry(s.w + 0.6, 0.7, s.d + 0.6), roofMat);
          roof.position.set(s.x, h + 0.55, s.z);
          this.group.add(roof);
          // rooftop clutter on some towers: tank + AC box silhouettes
          if (rng.chance(0.5)) {
            const tank = new THREE.Mesh(
              new THREE.CylinderGeometry(1.6, 1.6, 3.4, 8),
              new THREE.MeshLambertMaterial({ color: 0x9c8d7a }),
            );
            tank.position.set(s.x + rng.float(-s.w / 4, s.w / 4), h + 2.4, s.z + rng.float(-s.d / 4, s.d / 4));
            tank.castShadow = true;
            this.group.add(tank);
          }
          this.addCollider(s.x, s.z, s.w + 0.4, s.d + 0.4);
        }
      }
    }
  }

  buildHarbor() {
    // sand strip, then open water with a slow swell of colour
    const sand = new THREE.Mesh(
      new THREE.PlaneGeometry(640, 26),
      new THREE.MeshLambertMaterial({ color: 0xf2ddab }),
    );
    sand.rotation.x = -Math.PI / 2;
    sand.position.set(0, 0.03, HARBOR_Z + 8);
    sand.receiveShadow = true;
    this.group.add(sand);
    const waterMat = new THREE.MeshLambertMaterial({ color: 0x1f9db4, transparent: true, opacity: 0.92 });
    const water = new THREE.Mesh(new THREE.PlaneGeometry(900, 300), waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, 0.12, HARBOR_Z + 160);
    this.group.add(water);
    this.water = water;
    // pier: deck planks on posts reaching into the bay, crates at its end
    const deckMat = new THREE.MeshLambertMaterial({ color: 0x8a6f4d });
    const pier = new THREE.Mesh(new THREE.BoxGeometry(10, 0.8, 64), deckMat);
    pier.position.set(38, 0.7, HARBOR_Z + 40);
    pier.castShadow = true;
    this.group.add(pier);
    this.addCollider(38, HARBOR_Z + 40, 10, 64);
    const crateMat = new THREE.MeshLambertMaterial({ color: 0xd97b2f });
    for (let k = 0; k < 5; k += 1) {
      const crate = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.6, 2.6), crateMat);
      crate.position.set(34 + (k % 2) * 5, 2.3, HARBOR_Z + 58 - Math.floor(k / 2) * 6);
      crate.castShadow = true;
      this.group.add(crate);
    }
    // two moored boats bobbing by the pier
    const hullMat = new THREE.MeshLambertMaterial({ color: 0xf4f6f6 });
    const trimMat = new THREE.MeshLambertMaterial({ color: 0xe74c3c });
    for (const bx of [16, 62]) {
      const boat = new THREE.Group();
      const hull = new THREE.Mesh(new THREE.BoxGeometry(4.4, 1.6, 11), hullMat);
      hull.position.y = 0.6;
      boat.add(hull);
      const trim = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.5, 11.2), trimMat);
      trim.position.y = 1.3;
      boat.add(trim);
      const cabin = new THREE.Mesh(new THREE.BoxGeometry(3, 1.8, 4), hullMat);
      cabin.position.set(0, 2, -1);
      boat.add(cabin);
      boat.position.set(bx, 0.1, HARBOR_Z + 52);
      this.group.add(boat);
    }
  }

  buildProps() {
    const rng = this.rng;
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x8a6f4d });
    const frondMat = new THREE.MeshLambertMaterial({ color: 0x2e9e4f });
    const poleMat = new THREE.MeshLambertMaterial({ color: 0x3c4048 });
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff2b0 });
    const trunkGeo = new THREE.CylinderGeometry(0.22, 0.34, 5.4, 6);
    const frondGeo = new THREE.ConeGeometry(2.6, 1.6, 7);
    const poleGeo = new THREE.CylinderGeometry(0.12, 0.12, 6.4, 6);
    const lampGeo = new THREE.SphereGeometry(0.42, 8, 6);
    const spots = [];
    for (const rx of ROAD_LINES) {
      for (let s = -250; s <= 250; s += 38) {
        spots.push([rx + ROAD_HALF + 2.2, s + rng.float(-4, 4)]);
        spots.push([s + rng.float(-4, 4), rx - ROAD_HALF - 2.2]);
      }
    }
    for (const [x, z] of spots) {
      if (Math.abs(x) > CITY_EDGE || Math.abs(z) > CITY_EDGE) continue;
      if (rng.chance(0.55)) {
        const palm = new THREE.Group();
        const trunk = new THREE.Mesh(trunkGeo, trunkMat);
        trunk.position.y = 2.7;
        trunk.rotation.z = rng.float(-0.09, 0.09);
        trunk.castShadow = true;
        palm.add(trunk);
        const fronds = new THREE.Mesh(frondGeo, frondMat);
        fronds.position.y = 5.7;
        fronds.scale.y = 0.55;
        fronds.castShadow = true;
        palm.add(fronds);
        palm.position.set(x, 0.15, z);
        this.group.add(palm);
        this.addCollider(x, z, 0.9, 0.9);
      } else {
        const lamp = new THREE.Group();
        const pole = new THREE.Mesh(poleGeo, poleMat);
        pole.position.y = 3.2;
        lamp.add(pole);
        const bulb = new THREE.Mesh(lampGeo, lampMat);
        bulb.position.y = 6.5;
        lamp.add(bulb);
        lamp.position.set(x, 0.15, z);
        this.group.add(lamp);
        this.addCollider(x, z, 0.5, 0.5);
      }
    }
  }

  /** Keep a point (with radius) out of every building AABB; returns corrected [x, z, hit]. */
  collide(x, z, radius) {
    let hit = false;
    for (const c of this.colliders) {
      const nx = Math.max(c.minX - radius, Math.min(x, c.maxX + radius));
      const nz = Math.max(c.minZ - radius, Math.min(z, c.maxZ + radius));
      const dx = x - nx;
      const dz = z - nz;
      const d2 = dx * dx + dz * dz;
      if (d2 < radius * radius) {
        hit = true;
        if (d2 > 1e-6) {
          const d = Math.sqrt(d2);
          x = nx + (dx / d) * radius;
          z = nz + (dz / d) * radius;
        } else {
          // centre inside the box: push out along the smallest penetration
          const left = x - (c.minX - radius);
          const right = (c.maxX + radius) - x;
          const top = z - (c.minZ - radius);
          const bottom = (c.maxZ + radius) - z;
          const m = Math.min(left, right, top, bottom);
          if (m === left) x = c.minX - radius;
          else if (m === right) x = c.maxX + radius;
          else if (m === top) z = c.minZ - radius;
          else z = c.maxZ + radius;
        }
      }
    }
    const lim = CITY_EDGE + 40;
    x = Math.max(-lim, Math.min(lim, x));
    z = Math.max(-lim, Math.min(HARBOR_Z + 18, z));
    return [x, z, hit];
  }
}
