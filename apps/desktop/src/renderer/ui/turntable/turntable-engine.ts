import * as THREE from 'three';
import type { RecordAlbum } from '@music-os/core';
import { getArtworkObjectUrl } from '../../artwork-requests';
import { buildInstrument, disposeObject } from './instrument';
import { arrangements, type TurntableLayout } from './choreography';
import { layoutRig, recordScenePose } from './scene-poses';
import { phase } from '../../record-player-state';

export type TurntableSceneProps = { album: RecordAlbum; artworkUrl(id: string): string; playing: boolean; progress: number; empty?: boolean;
  elapsed?: number; layout: TurntableLayout; reducedMotion?: boolean; suspended?: boolean; preloadAlbum?: RecordAlbum };

type SceneListener = (state: 'lost' | 'restored') => void;
export type TurntableEngine = {
  attach(host: HTMLDivElement, props: TurntableSceneProps, listener: SceneListener): void;
  update(props: TurntableSceneProps): void;
  park(): void;
  reusable(): boolean;
  dispose(): void;
};

let enginesCurrent = true;
if (import.meta.hot) import.meta.hot.dispose(() => { enginesCurrent = false; });

export function createTurntableEngine(props: TurntableSceneProps): TurntableEngine | null {
  const latest = { current: props };
  let element: HTMLDivElement | null = null;
  let notify: SceneListener | undefined;
  let renderer: THREE.WebGLRenderer;
  try { renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' }); }
  catch { return null; }
  let contextLost = false;
  let disposed = false, frame = 0, visible = true, previous = performance.now(), width = 1, height = 1;
  let spin = 0, speed = 0, rendered = 0;
  let shadowPose = '';
  const root = new THREE.Scene();
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true; renderer.shadowMap.autoUpdate = false; renderer.shadowMap.type = THREE.VSMShadowMap;
  const canvas = renderer.domElement; canvas.setAttribute('aria-hidden', 'true');
  const camera = new THREE.OrthographicCamera(-5, 5, 3.25, -3.25, .1, 70);
  camera.position.set(3.0, 10.0, 12.8); camera.lookAt(.1, 1.35, 0);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = new THREE.Scene(); environment.background = new THREE.Color('#111824');
  const softbox = (w: number, h: number, position: [number, number, number], color: THREE.Color) => {
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
    panel.position.fromArray(position); panel.lookAt(0, 0, 0); environment.add(panel);
  };
  softbox(5, 3, [-3, 6, 3], new THREE.Color(6, 5.6, 5.1));
  softbox(1.2, 7, [5, 2, 1], new THREE.Color(3.8, 4.6, 6));
  softbox(6, 1.2, [0, 4, -5], new THREE.Color(4, 4.6, 6));
  softbox(3, 2, [-5, 1, -1], new THREE.Color(1.5, 1.2, .85));
  const environmentMap = pmrem.fromScene(environment, .035);
  root.environment = environmentMap.texture; root.environmentIntensity = .85;
  disposeObject(environment); pmrem.dispose();
  root.add(new THREE.HemisphereLight('#d4e7ff', '#675040', .85));
  const key = new THREE.DirectionalLight('#fff0d9', 2.5); key.position.set(-3.5, 8, 5); key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024); key.shadow.camera.left = -8; key.shadow.camera.right = 8;
  key.shadow.camera.top = 8; key.shadow.camera.bottom = -8; key.shadow.normalBias = .028; key.shadow.bias = -.0001; key.shadow.radius = 6; key.shadow.blurSamples = 8;
  root.add(key);
  const rim = new THREE.DirectionalLight('#b7d7ff', 2.0); rim.position.set(5, 4, -5); root.add(rim);
  const fill = new THREE.DirectionalLight('#ffffff', .8); fill.position.set(0, 3, 8); root.add(fill);
  const world = new THREE.Group(); root.add(world);
  const instrument = buildInstrument();
  world.add(instrument.deck, instrument.vinyl, instrument.sleeve);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.ShadowMaterial({ color: '#02050c', opacity: .22 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = .005; floor.receiveShadow = true; root.add(floor);
  // Soft near-field contact shading; not a giant opaque floor in the surrounding UI.
  const contactMaterial = new THREE.ShaderMaterial({ transparent: true, depthWrite: false,
    uniforms: { strength: { value: .35 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: 'varying vec2 vUv; uniform float strength; void main(){ vec2 p=(vUv-.5)*2.; vec2 edge=max(abs(p)-vec2(.59,.54),vec2(0.)); float a=exp(-dot(edge,edge)*65.)*strength; gl_FragColor=vec4(.005,.009,.018,a); }'
  });
  const contact = new THREE.Mesh(new THREE.PlaneGeometry(7.5, 5.5), contactMaterial); contact.rotation.x = -Math.PI / 2; contact.position.y = .008; root.add(contact);
  const initial = arrangements[latest.current.layout] ?? arrangements.classic;
  instrument.deck.position.fromArray(initial.deck); instrument.deck.rotation.fromArray([...initial.deckRotation, 'XYZ']);
  const baseSleeve = new THREE.Vector3().fromArray(initial.sleeve);
  const baseSleeveQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(...initial.sleeveRotation));
  let viewHeight = initial.viewHeight, viewX = 0, viewY = 0;
  let fitAspect = 0;
  const fits = new Map<string, { height: number; x: number; y: number }>();
  function fit(layout: TurntableLayout, exchange = false) {
    const aspect = width / height;
    if (fitAspect !== aspect) { fits.clear(); fitAspect = aspect; }
    const cacheKey = `${layout}:${exchange}`; const cached = fits.get(cacheKey); if (cached) return cached;
    const a = arrangements[layout]; camera.updateMatrixWorld();
    let left = Infinity, right = -Infinity, bottom = Infinity, top = -Infinity;
    const corners = (size: number[], center: number[], rotation: number[], shiftY: number) => {
      const transform = new THREE.Matrix4().compose(new THREE.Vector3(...center), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation as [number, number, number])), new THREE.Vector3(1, 1, 1));
      for (const x of [-.5, .5]) for (const y of [-.5, .5]) for (const z of [-.5, .5]) {
        const point = new THREE.Vector3(x * size[0], y * size[1] + shiftY, z * size[2]).applyMatrix4(transform).applyMatrix4(camera.matrixWorldInverse);
        left = Math.min(left, point.x); right = Math.max(right, point.x); bottom = Math.min(bottom, point.y); top = Math.max(top, point.y);
      }
    };
    corners([4.95, 1.3, 3.82], a.deck, a.deckRotation, .65);
    corners([3.58, 3.58, .08], a.sleeve, a.sleeveRotation, 0);
    if (exchange) {
      // Frame the whole working envelope once; never chase a sleeve offstage.
      const rig = layoutRig(layout);
      const include = (point: THREE.Vector3) => {
        point.applyMatrix4(camera.matrixWorldInverse);
        left = Math.min(left, point.x); right = Math.max(right, point.x);
        bottom = Math.min(bottom, point.y); top = Math.max(top, point.y);
      };
      for (let t = 0; t <= 3900; t += 50) {
        const motion = recordScenePose(rig, t, 0);
        if (Math.abs(motion.travel) > .05) continue;
        for (const x of [-1.79, 1.79]) for (const y of [-1.79, 1.79]) {
          include(new THREE.Vector3(x, y, .03).applyQuaternion(motion.sleeveQuaternion).add(motion.sleevePosition));
        }
        if (motion.recordVisible) for (let i = 0; i < 32; i++) {
          const angle = i * Math.PI / 16;
          include(new THREE.Vector3(Math.cos(angle) * 1.645, .04, Math.sin(angle) * 1.645).applyQuaternion(motion.recordQuaternion).add(motion.recordPosition));
        }
      }
    }
    const result = { height: Math.max(top - bottom, (right - left) / aspect) * 1.13, x: (left + right) / 2, y: (bottom + top) / 2 };
    fits.set(cacheKey, result); return result;
  }
  const pointer = new THREE.Vector2(); const pointerNow = new THREE.Vector2();
  const q = new THREE.Quaternion();
  const textures = new Map<string, THREE.Texture>(); const loading = new Set<string>();
  const controllers = new Set<AbortController>(); let applied = '';
  const fallback = document.createElement('canvas'); fallback.width = fallback.height = 256;
  const ctx = fallback.getContext('2d')!; ctx.fillStyle = '#17303e'; ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = '#ac9e78'; ctx.lineWidth = 1; ctx.strokeRect(20, 20, 216, 216);
  ctx.fillStyle = '#d4c3a4'; ctx.textAlign = 'center'; ctx.font = '18px sans-serif'; ctx.fillText('n e g i', 128, 126);
  ctx.font = '9px sans-serif'; ctx.fillText('THE LISTENING ROOM', 128, 151);
  const placeholder = new THREE.CanvasTexture(fallback); placeholder.colorSpace = THREE.SRGBColorSpace;

  function wake() {
    if (element && !disposed && !contextLost && !frame && visible && !document.hidden && !latest.current.suspended) frame = requestAnimationFrame(draw);
  }
  function artwork(album: RecordAlbum) {
    if (!album.fileId || disposed) return;
    const source = latest.current.artworkUrl(album.fileId);
    if (textures.has(source) || loading.has(source)) return;
    loading.add(source); const controller = new AbortController(); controllers.add(controller);
    void getArtworkObjectUrl(source, true, controller.signal).then((url) => {
      if (disposed) return;
      new THREE.TextureLoader().load(url, (texture) => {
        if (disposed) { texture.dispose(); return; }
        texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 8;
        textures.set(source, texture); loading.delete(source); controllers.delete(controller);
        // Bound GPU artwork retention during long listening sessions.
        if (textures.size > 4) for (const [old, value] of textures) {
          const p = latest.current;
          if (old !== p.artworkUrl(p.album.fileId) && old !== (p.preloadAlbum ? p.artworkUrl(p.preloadAlbum.fileId) : '')) {
            textures.delete(old); value.dispose(); break;
          }
        }
        applied = ''; wake();
      }, undefined, () => { loading.delete(source); controllers.delete(controller); });
    }).catch(() => { loading.delete(source); controllers.delete(controller); });
  }
  function resize() {
    // CSS transforms only move/composite the canvas. Allocate for its full layout size.
    if (!element) return;
    const nextWidth = element.clientWidth, nextHeight = element.clientHeight;
    if (!nextWidth || !nextHeight) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    if (width !== nextWidth || height !== nextHeight || renderer.getPixelRatio() !== ratio) {
      width = nextWidth; height = nextHeight;
      renderer.setPixelRatio(ratio); renderer.setSize(width, height, false);
    }
    wake();
  }
  function draw(now: number) {
    frame = 0;
    if (!element || disposed || contextLost || !visible || document.hidden || latest.current.suspended) { previous = now; return; }
    const p = latest.current; const dt = Math.min(.05, Math.max(.001, (now - previous) / 1000)); previous = now;
    const layout = arrangements[p.layout] ?? arrangements.classic;
    // Match the settled inline framing on the first focused frame. Easing from
    // the construction camera makes the instrument jump as the portal opens.
    const blend = p.reducedMotion || rendered === 0 ? 1 : 1 - Math.exp(-dt * 10);
    const deckTarget = new THREE.Vector3().fromArray(layout.deck);
    instrument.deck.position.lerp(deckTarget, blend);
    q.setFromEuler(new THREE.Euler(...layout.deckRotation)); instrument.deck.quaternion.slerp(q, blend);
    baseSleeve.lerp(new THREE.Vector3().fromArray(layout.sleeve), blend);
    q.setFromEuler(new THREE.Euler(...layout.sleeveRotation)); baseSleeveQ.slerp(q, blend);
    const restingFit = fit(p.layout);
    const exchangeFit = p.elapsed != null && !p.reducedMotion ? fit(p.layout, true) : restingFit;
    const framing = p.elapsed == null || p.reducedMotion ? 0 : phase(p.elapsed, 0, 500) * (1 - phase(p.elapsed, 3830, 3900));
    const fitted = { height: THREE.MathUtils.lerp(restingFit.height, exchangeFit.height, framing),
      x: THREE.MathUtils.lerp(restingFit.x, exchangeFit.x, framing), y: THREE.MathUtils.lerp(restingFit.y, exchangeFit.y, framing) };
    viewHeight = THREE.MathUtils.lerp(viewHeight, fitted.height, blend); viewX = THREE.MathUtils.lerp(viewX, fitted.x, blend); viewY = THREE.MathUtils.lerp(viewY, fitted.y, blend);
    pointerNow.lerp(p.reducedMotion ? new THREE.Vector2() : pointer, blend);
    world.rotation.set(pointerNow.y * .025, pointerNow.x * .035, 0);
    camera.top = viewY + viewHeight / 2; camera.bottom = viewY - viewHeight / 2;
    camera.left = viewX - viewHeight * width / height / 2; camera.right = viewX + viewHeight * width / height / 2; camera.updateProjectionMatrix();
    const pose = recordScenePose({ deckPosition: instrument.deck.position, deckQuaternion: instrument.deck.quaternion,
      sleevePosition: baseSleeve, sleeveQuaternion: baseSleeveQ }, p.reducedMotion && p.elapsed != null ? 3900 : p.elapsed, p.progress, p.empty);
    const breathe = !p.reducedMotion && p.layout === 'float' && p.elapsed == null && p.playing ? Math.sin(now / 1450) * .04 : 0;
    pose.sleevePosition.y += breathe;
    instrument.sleeve.position.copy(pose.sleevePosition); instrument.sleeve.quaternion.copy(pose.sleeveQuaternion);
    instrument.sleeve.visible = !p.empty;
    instrument.vinyl.position.copy(pose.recordPosition); instrument.vinyl.quaternion.copy(pose.recordQuaternion);
    instrument.vinyl.visible = pose.recordVisible;
    // The arm moves farther inward as elapsed album time increases.
    const grooveYaw = -.35 - pose.groove * .23;
    const targetYaw = THREE.MathUtils.lerp(grooveYaw, .22, pose.armPark);
    instrument.arm.rotation.y = p.reducedMotion || p.elapsed != null ? targetYaw : THREE.MathUtils.lerp(instrument.arm.rotation.y, targetYaw, blend);
    instrument.tilt.rotation.x = -pose.armLift * .115;
    const targetSpeed = p.reducedMotion || p.empty ? 0 : p.playing ? Math.PI * 2 / 1.8 : 0;
    speed = THREE.MathUtils.lerp(speed, targetSpeed, 1 - Math.exp(-dt * 7)); spin += speed * dt;
    instrument.labelSpin.rotation.y = spin;
    instrument.ledMaterial.color.set(p.playing ? '#ffbd6a' : '#62533e');
    contact.position.x = instrument.deck.position.x; contact.position.z = instrument.deck.position.z;
    contactMaterial.uniforms.strength.value = p.layout === 'float' ? .25 : .55;
    const source = p.album.fileId ? p.artworkUrl(p.album.fileId) : '';
    const texture = textures.get(source) ?? placeholder;
    const artKey = `${source}:${texture.uuid}`;
    if (applied !== artKey) {
      applied = artKey;
      instrument.jacketFace.map = texture; instrument.jacketBack.map = texture; instrument.labelMaterial.map = texture;
      instrument.jacketFace.needsUpdate = instrument.jacketBack.needsUpdate = instrument.labelMaterial.needsUpdate = true;
    }
    // Label rotation does not change any shadow. Reuse the shadow map during
    // ordinary playback; update it when the actual mechanism or layout moves.
    const nextShadowPose = [p.empty, ...instrument.deck.position, ...instrument.deck.quaternion,
      ...instrument.sleeve.position, ...instrument.sleeve.quaternion, ...instrument.vinyl.position,
      ...instrument.vinyl.quaternion, instrument.arm.rotation.y, instrument.tilt.rotation.x,
      world.rotation.x, world.rotation.y].map(value => typeof value === 'number' ? value.toFixed(3) : String(value)).join(',');
    renderer.shadowMap.needsUpdate = nextShadowPose !== shadowPose;
    shadowPose = nextShadowPose;
    renderer.render(root, camera); rendered++;
    if (rendered % 60 === 0) { canvas.dataset.drawCalls = String(renderer.info.render.calls); canvas.dataset.triangles = String(renderer.info.render.triangles); }
    const moving = instrument.deck.position.distanceTo(deckTarget) > .001 || baseSleeve.distanceTo(new THREE.Vector3(...layout.sleeve)) > .001 || Math.abs(viewHeight - fitted.height) > .001 || Math.abs(viewX - fitted.x) > .001 || Math.abs(viewY - fitted.y) > .001 || (!p.reducedMotion && pointerNow.distanceTo(pointer) > .001) || Math.abs(instrument.arm.rotation.y - targetYaw) > .001 || instrument.deck.quaternion.angleTo(new THREE.Quaternion().setFromEuler(new THREE.Euler(...layout.deckRotation))) > .001 || baseSleeveQ.angleTo(new THREE.Quaternion().setFromEuler(new THREE.Euler(...layout.sleeveRotation))) > .001;
    if ((!p.reducedMotion && (p.playing || speed > .002)) || moving) wake();
  }
  function move(event: PointerEvent) {
    const bounds = element!.getBoundingClientRect(); pointer.set((event.clientX - bounds.left) / bounds.width * 2 - 1, (event.clientY - bounds.top) / bounds.height * 2 - 1); wake();
  }
  function leave() { pointer.set(0, 0); wake(); }
  function visibility() { previous = performance.now(); wake(); }
  function lost(event: Event) { event.preventDefault(); contextLost = true; notify?.('lost'); if (frame) cancelAnimationFrame(frame); frame = 0; }
  function restored() { notify?.('restored'); }
  canvas.addEventListener('webglcontextlost', lost); canvas.addEventListener('webglcontextrestored', restored);
  const resizeObserver = new ResizeObserver(resize);
  const intersection = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; previous = performance.now(); wake(); });

  function park() {
    cancelAnimationFrame(frame); frame = 0; visible = false; notify = undefined;
    resizeObserver.disconnect(); intersection.disconnect();
    element?.removeEventListener('pointermove', move); element?.removeEventListener('pointerleave', leave);
    document.removeEventListener('visibilitychange', visibility);
    window.removeEventListener('resize', resize);
    canvas.remove(); element = null;
    pointer.set(0, 0); pointerNow.set(0, 0);
  }
  function update(props: TurntableSceneProps) {
    latest.current = props;
    artwork(props.album); if (props.preloadAlbum) artwork(props.preloadAlbum);
    wake();
  }
  return {
    attach(host, props, listener) {
      element = host; notify = listener; latest.current = props;
      visible = true; previous = performance.now(); rendered = 0; element.appendChild(canvas);
      element.addEventListener('pointermove', move); element.addEventListener('pointerleave', leave);
      document.addEventListener('visibilitychange', visibility); window.addEventListener('resize', resize);
      resizeObserver.observe(element); intersection.observe(element);
      update(props); resize();
      // Warm scenes already have compiled shaders. Draw the current record
      // before the reopening paint instead of waiting for initialization frames.
      cancelAnimationFrame(frame); frame = 0; draw(performance.now());
    },
    update,
    park,
    reusable: () => enginesCurrent && !disposed && !contextLost,
    dispose() {
      if (disposed) return;
      disposed = true; park(); controllers.forEach(controller => controller.abort());
      canvas.removeEventListener('webglcontextlost', lost); canvas.removeEventListener('webglcontextrestored', restored);
      disposeObject(root); textures.forEach(texture => texture.dispose()); placeholder.dispose(); environmentMap.dispose();
      key.shadow.map?.dispose(); renderer.dispose(); renderer.forceContextLoss();
    }
  };
}
