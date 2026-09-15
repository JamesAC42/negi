import assert from 'node:assert/strict';

// Test the actual rendered meshes, including the raised center that a flat-disc
// collision proxy misses. No app state, music library, or playback is involved.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const origin = process.env.MUSIC_OS_RENDERER_ORIGIN ?? 'http://127.0.0.1:5173';
const browser = await chromium.launch({ headless: true,
  ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}),
  args: ['--no-sandbox', '--disable-features=LocalNetworkAccessChecks'] });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route(`${origin}/__record_sleeve_smoke`, route => route.fulfill({ contentType: 'text/html', body: `<!doctype html>
    <script type="module">
      const THREE = await import('/node_modules/.vite/deps/three.js');
      const { buildInstrument, disposeObject } = await import('/src/renderer/ui/turntable/instrument.ts');
      const { arrangements } = await import('/src/renderer/ui/turntable/choreography.ts');
      const { layoutRig, recordScenePose } = await import('/src/renderer/ui/turntable/scene-poses.ts');
      window.checkSleeve = () => {
        const instrument = buildInstrument();
        try {
          const jacket = instrument.sleeve.children.find(child => Array.isArray(child.material) && child.material.includes(instrument.jacketFace));
          jacket.geometry.computeBoundingBox();
          const envelope = jacket.geometry.boundingBox;
          instrument.vinyl.updateMatrixWorld(true);
          const vertices = [];
          instrument.vinyl.traverse(child => {
            if (!child.isMesh) return;
            const positions = child.geometry.getAttribute('position');
            for (let i = 0; i < positions.count; i++) vertices.push(new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(child.matrixWorld));
          });
          const failures = [], layouts = [];
          let checked = 0, minFrontClearance = Infinity, minBackClearance = Infinity;
          for (const layout of Object.keys(arrangements)) {
            const rig = layoutRig(layout);
            let entering = 0, exiting = 0;
            for (let elapsed = 0; elapsed <= 3900; elapsed += 10) {
              const pose = recordScenePose(rig, elapsed, .5);
              if (!pose.recordVisible || pose.insertion <= 0) continue;
              if (elapsed < 1850) entering++; else exiting++;
              const inverseSleeve = pose.sleeveQuaternion.clone().invert();
              for (const vertex of vertices) {
                const point = vertex.clone().applyQuaternion(pose.recordQuaternion).add(pose.recordPosition).sub(pose.sleevePosition).applyQuaternion(inverseSleeve);
                if (point.x <= envelope.min.x || point.x >= envelope.max.x || point.y <= envelope.min.y || point.y >= envelope.max.y) continue;
                checked++;
                const front = envelope.max.z - point.z, back = point.z - envelope.min.z;
                minFrontClearance = Math.min(minFrontClearance, front);
                minBackClearance = Math.min(minBackClearance, back);
                if ((front < .001 || back < .001) && failures.length < 12) failures.push({ layout, elapsed, front, back, point: point.toArray() });
              }
            }
            layouts.push({ layout, entering, exiting });
          }
          return { failures, layouts, checked, minFrontClearance, minBackClearance };
        } finally {
          disposeObject(instrument.vinyl); disposeObject(instrument.sleeve); disposeObject(instrument.deck);
        }
      };
    </script>` }));
  await page.goto(`${origin}/__record_sleeve_smoke`);
  await page.waitForFunction(() => window.checkSleeve);
  const result = await page.evaluate(() => window.checkSleeve());
  assert.deepEqual(errors, []);
  assert.equal(result.layouts.length, 6);
  assert.ok(result.checked > 1000, 'exercise real vinyl, label, and center vertices behind the artwork');
  assert.ok(result.layouts.every(layout => layout.entering > 0 && layout.exiting > 0), 'check both directions in every layout');
  assert.deepEqual(result.failures, [], 'the whole record must remain between the front and back sleeve faces');
  console.log('PASS sleeve occlusion: actual vinyl, label, and raised center meshes fit behind both cover faces in all six layouts during insertion and removal', JSON.stringify(result));
} finally {
  await browser.close();
}