// Vice Harbor bootstrap: renderer, scene, camera and the frame loop.
// Live play runs on a clamped real clock; screenshot scenes (?shot=name)
// run on a fixed 1/30 step so the staged frame is the same on every run,
// and raise window.__shotReady once the scene has settled.
import * as THREE from 'three';
import { Game } from './play.js';

const params = new URLSearchParams(location.search);
const shotName = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

const canvas = document.querySelector('#game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 1200);
camera.position.set(0, 60, 320);

const game = new Game(scene, camera, { seed, shot: shotName });
window.__viceHarbor = game;
if (shotName) game.stageShot(shotName);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const clock = new THREE.Clock();
let frames = 0;
function loop() {
  requestAnimationFrame(loop);
  const dt = shotName ? 1 / 30 : Math.min(clock.getDelta(), 0.05);
  game.update(dt);
  renderer.render(scene, camera);
  if (shotName) {
    frames += 1;
    if (frames >= (game.readyFrame ?? 45)) window.__shotReady = true;
  }
}
loop();
