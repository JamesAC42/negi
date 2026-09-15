import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export function buildInstrument() {
  const deck = new THREE.Group();
  const vinyl = new THREE.Group();
  const sleeve = new THREE.Group();
  const chrome = new THREE.MeshStandardMaterial({ color: '#dce3e5', metalness: .95, roughness: .2 });
  const brushed = new THREE.MeshStandardMaterial({ color: '#b9c0c6', metalness: .84, roughness: .32 });
  const black = new THREE.MeshStandardMaterial({ color: '#030507', metalness: .3, roughness: .48, envMapIntensity: .09 });
  const platterWall = new THREE.MeshStandardMaterial({ color: '#525b62', metalness: .9, roughness: .27 });
  const rubber = new THREE.MeshStandardMaterial({ color: '#080c10', roughness: .8 });
  const brass = new THREE.MeshStandardMaterial({ color: '#dfa75d', metalness: .76, roughness: .25 });
  const wood = new THREE.MeshPhysicalMaterial({ color: '#d9b898', metalness: 0, roughness: .38, clearcoat: .35, clearcoatRoughness: .32 });
  const woodTexture = new THREE.TextureLoader().load('/textures/turntable-walnut.jpg');
  woodTexture.colorSpace = THREE.SRGBColorSpace;
  woodTexture.anisotropy = 4;
  wood.map = woodTexture;
  wood.bumpMap = woodTexture;
  wood.bumpScale = .009;
  const metalTexture = new THREE.TextureLoader().load('/textures/turntable-metal.jpg');
  metalTexture.colorSpace = THREE.SRGBColorSpace; metalTexture.anisotropy = 8;
  const topPlate = new THREE.MeshStandardMaterial({ color: '#8a919a', map: metalTexture, bumpMap: metalTexture, bumpScale: .006, roughness: .46, metalness: .28, envMapIntensity: .22 });

  function mesh(parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[], x = 0, y = 0, z = 0) {
    const object = new THREE.Mesh(geometry, material);
    object.position.set(x, y, z); object.castShadow = true; object.receiveShadow = true; parent.add(object); return object;
  }
  function box(parent: THREE.Object3D, w: number, h: number, d: number, material: THREE.Material, x: number, y: number, z: number, radius = .025) {
    return mesh(parent, new RoundedBoxGeometry(w, h, d, 2, radius), material, x, y, z);
  }
  function cylinder(parent: THREE.Object3D, radius: number, h: number, material: THREE.Material, x: number, y: number, z: number, segments = 96) {
    return mesh(parent, new THREE.CylinderGeometry(radius, radius, h, segments), material, x, y, z);
  }
  function ring(parent: THREE.Object3D, radius: number, thickness: number, material: THREE.Material, x: number, y: number, z: number) {
    const object = mesh(parent, new THREE.TorusGeometry(radius, thickness, 6, 128), material, x, y, z); object.rotation.x = Math.PI / 2; return object;
  }
  function decal(parent: THREE.Object3D, text: string, width: number, height: number, x: number, y: number, z: number, size = 32, color = '#c4cbd0') {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128;
    const context = canvas.getContext('2d')!; context.fillStyle = color; context.textAlign = 'center';
    context.textBaseline = 'middle'; context.font = `${size}px sans-serif`;
    const measured = context.measureText(text).width; context.font = `${Math.min(110, size * 450 / Math.max(1, measured))}px sans-serif`; context.fillText(text, 256, 64);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    const object = mesh(parent, new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }), x, y, z);
    object.rotation.x = -Math.PI / 2; object.castShadow = false; return object;
  }

  // Four isolated suspension feet, each with a rubber foot and brushed collar.
  for (const x of [-2.03, 2.03]) for (const z of [-1.65, 1.65]) {
    cylinder(deck, .22, .13, rubber, x, .075, z, 32);
    cylinder(deck, .23, .12, brushed, x, .175, z, 32);
    ring(deck, .22, .012, black, x, .2, z);
  }
  box(deck, 4.95, .31, 3.82, wood, 0, .345, 0, .075);
  box(deck, 4.78, .012, 3.66, brushed, 0, .505, 0, .035);
  box(deck, 4.74, .065, 3.62, topPlate, 0, .545, 0, .05);
  // Crisp inset top plate corner screws with real slotted heads.
  for (const x of [-2.22, 2.22]) for (const z of [-1.65, 1.65]) {
    cylinder(deck, .035, .009, chrome, x, .583, z, 16);
    const slit = box(deck, .045, .003, .006, rubber, x, .590, z, .001); slit.rotation.y = -.6;
  }
  const px = -.57, pz = .05;
  cylinder(deck, 1.72, .055, rubber, px, .59, pz);
  cylinder(deck, 1.7, .15, platterWall, px, .675, pz);
  ring(deck, 1.697, .012, chrome, px, .738, pz);
  ring(deck, 1.698, .012, chrome, px, .61, pz);
  const dots = new THREE.InstancedMesh(new THREE.SphereGeometry(.013, 6, 4), chrome, 360);
  const matrix = new THREE.Matrix4();
  for (let i = 0; i < 360; i++) {
    const a = (i % 180) / 180 * Math.PI * 2;
    matrix.makeTranslation(px + Math.cos(a) * 1.704, .65 + Math.floor(i / 180) * .045, pz + Math.sin(a) * 1.704);
    dots.setMatrixAt(i, matrix);
  }
  deck.add(dots);
  cylinder(deck, 1.66, .028, rubber, px, .761, pz);
  for (const radius of [1.55, 1.35, 1.15, .95, .75, .55]) ring(deck, radius, .007, black, px, .779, pz);
  cylinder(deck, .045, .18, chrome, px, .856, pz, 24);
  mesh(deck, new THREE.SphereGeometry(.045, 16, 8), chrome, px, .946, pz).scale.y = .5;

  // Pressed vinyl: a physical edge, concentric cut grooves and a dynamic environment reflection.
  const grooves = document.createElement('canvas'); grooves.width = grooves.height = 1024;
  const context = grooves.getContext('2d')!; context.fillStyle = '#26292d'; context.fillRect(0, 0, 1024, 1024);
  for (let i = 150; i < 505; i += 2.2) {
    context.beginPath(); context.arc(512, 512, i, 0, Math.PI * 2);
    context.strokeStyle = Math.floor(i) % 4 === 0 ? '#050609' : '#6a6d74'; context.lineWidth = .7; context.stroke();
  }
  for (const r of [234, 305, 375, 437, 485]) {
    context.beginPath(); context.arc(512, 512, r, 0, Math.PI * 2); context.strokeStyle = '#101216'; context.lineWidth = 5; context.stroke();
  }
  const grooveMap = new THREE.CanvasTexture(grooves); grooveMap.colorSpace = THREE.SRGBColorSpace; grooveMap.anisotropy = 8;
  const recordMaterial = new THREE.MeshPhysicalMaterial({ color: '#181b20', map: grooveMap, bumpMap: grooveMap, bumpScale: .012,
    metalness: .05, roughness: .38, clearcoat: .02, clearcoatRoughness: .3, envMapIntensity: .045 });
  cylinder(vinyl, 1.645, .038, black, 0, 0, 0, 128);
  const surface = mesh(vinyl, new THREE.CircleGeometry(1.645, 160), recordMaterial, 0, .021, 0); surface.rotation.x = -Math.PI / 2;
  ring(vinyl, 1.638, .008, brushed, 0, .011, 0);
  const labelSpin = new THREE.Group(); vinyl.add(labelSpin);
  const labelMaterial = new THREE.MeshStandardMaterial({ color: '#ebe5d7', roughness: .72 });
  const label = mesh(labelSpin, new THREE.CircleGeometry(.49, 96), labelMaterial, 0, .024, 0); label.rotation.x = -Math.PI / 2;
  ring(labelSpin, .487, .0035, brass, 0, .026, 0);
  cylinder(labelSpin, .108, .006, brass, 0, .027, 0, 32);
  ring(labelSpin, .075, .006, black, 0, .032, 0);
  cylinder(labelSpin, .036, .008, rubber, 0, .035, 0, 24);
  // Silvery radial sheen follows the light rather than spinning with the printed label.
  recordMaterial.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      vec2 grooveUv = vMapUv - vec2(0.5);
      float angular = atan(grooveUv.y, grooveUv.x);
      roughnessFactor *= 0.76 + 0.24 * abs(sin(angular * 2.0));`);
  };
  const originalCompile = recordMaterial.onBeforeCompile;
  recordMaterial.onBeforeCompile = (shader, renderer) => {
    originalCompile(shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
      float sheen = pow(abs(sin(angular - 0.48)), 32.0);
      float grooveRadius = length(grooveUv);
      float fine = cos(grooveRadius * 940.0) * (1.0 - smoothstep(2.5, 5.0, fwidth(grooveRadius) * 940.0));
      float etched = 0.76 + 0.24 * fine;
      outgoingLight = min(outgoingLight * 0.4, vec3(0.012, 0.014, 0.017)) + vec3(0.23, 0.26, 0.30) * sheen * etched * smoothstep(0.14,0.21,grooveRadius);
      #include <opaque_fragment>`);
  };
  recordMaterial.customProgramCacheKey = () => 'negi-grooved-vinyl-v3';

  // Genuine paperboard volume. The record travels behind its front face through the left opening.
  const jacketEdge = new THREE.MeshStandardMaterial({ color: '#96866a', roughness: .9 });
  const jacketFace = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: .68, metalness: 0 });
  const jacketBack = new THREE.MeshStandardMaterial({ color: '#acb1b4', roughness: .82 });
  // Enclose the raised center as well as the disc: the center reaches .034
  // toward the cover in the insertion plane. Keep clearance on both faces.
  mesh(sleeve, new THREE.BoxGeometry(3.58, 3.58, .08), [jacketEdge, black, jacketEdge, jacketEdge, jacketFace, jacketBack]);
  // An almost invisible laminate catches the edge light without washing out cover art.
  const edgeLine = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(3.58, 3.58, .083)), new THREE.LineBasicMaterial({ color: '#dddfdb', transparent: true, opacity: .16 }));
  sleeve.add(edgeLine);

  // Tonearm assembly: machined bearing, gimbal, counterweight and curved chrome tube.
  cylinder(deck, .275, .06, rubber, 1.75, .61, -1.15, 48);
  cylinder(deck, .22, .27, brushed, 1.75, .77, -1.15, 48);
  ring(deck, .215, .018, chrome, 1.75, .92, -1.15);
  for (const x of [1.58, 1.92]) box(deck, .045, .24, .13, brushed, x, .98, -1.15, .018);
  const bearing = cylinder(deck, .055, .35, chrome, 1.75, 1.09, -1.15, 24); bearing.rotation.z = Math.PI / 2;
  const arm = new THREE.Group(); arm.position.set(1.75, .972, -1.15); deck.add(arm);
  const tilt = new THREE.Group(); arm.add(tilt);
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, .08, -.36), new THREE.Vector3(0, .08, .25), new THREE.Vector3(-.06, .05, .75), new THREE.Vector3(-.27, .025, 1.16), new THREE.Vector3(-.39, .02, 1.75), new THREE.Vector3(-.39, .02, 2.02)]);
  mesh(tilt, new THREE.TubeGeometry(curve, 48, .043, 10, false), chrome);
  const weight = cylinder(tilt, .14, .3, brushed, 0, .08, -.47, 48); weight.rotation.x = Math.PI / 2;
  for (let i = 0; i < 6; i++) { const r = ring(tilt, .14, .008, black, 0, .08, -.58 + i * .044); r.rotation.x = 0; }
  cylinder(tilt, .075, .17, black, 0, .025, 0, 24);
  box(tilt, .18, .065, .38, black, -.39, .015, 2.11, .025);
  for (const x of [-.44, -.39, -.34]) box(tilt, .012, .006, .24, brushed, x, .051, 2.1, .002);
  box(tilt, .135, .07, .15, brass, -.39, -.05, 2.21, .016);
  const needle = mesh(tilt, new THREE.ConeGeometry(.008, .052, 8), chrome, -.39, -.111, 2.235); needle.rotation.z = Math.PI;
  const finger = new THREE.CatmullRomCurve3([new THREE.Vector3(-.29, .02, 2.0), new THREE.Vector3(-.13, .045, 2.02), new THREE.Vector3(-.09, .16, 2.08)]);
  mesh(tilt, new THREE.TubeGeometry(finger, 12, .014, 6, false), chrome);
  box(deck, .08, .24, .08, brushed, 1.96, .7, .29);
  box(deck, .23, .045, .085, black, 1.96, .835, .29);
  const cue = cylinder(deck, .028, .25, chrome, 2.02, .72, -.65, 16); cue.rotation.z = -.3;

  cylinder(deck, .135, .03, black, -2.07, .59, 1.4, 32);
  ring(deck, .133, .015, chrome, -2.07, .62, 1.4);
  cylinder(deck, .09, .035, brushed, -2.07, .63, 1.4, 32);
  const ledMaterial = new THREE.MeshBasicMaterial({ color: '#ffbb66' });
  cylinder(deck, .023, .009, ledMaterial, -1.85, .591, 1.5, 16);
  box(deck, .58, .016, .29, rubber, 1.8, .59, 1.42, .02);
  box(deck, .23, .035, .23, brushed, 1.67, .612, 1.42, .015);
  decal(deck, '33', .20, .10, 1.94, .613, 1.42, 47);
  decal(deck, 'n e g i', .9, .21, 1.55, .59, .92, 40, '#aeb8b7');
  decal(deck, 'PRECISION  /  01', .9, .105, 1.55, .592, 1.1, 22, '#7f9297');
  decal(deck, 'START / STOP', .7, .085, -1.98, .592, 1.69, 18, '#9ba9ae');

  return { deck, vinyl, sleeve, arm, tilt, labelSpin, jacketFace, jacketBack, labelMaterial, ledMaterial, px, pz };
}

export function disposeObject(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    if (mesh.material) for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(material);
  });
  for (const material of materials) for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
  textures.forEach((texture) => texture.dispose()); geometries.forEach((geometry) => geometry.dispose()); materials.forEach((material) => material.dispose());
}
