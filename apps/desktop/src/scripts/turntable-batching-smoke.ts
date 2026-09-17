import assert from 'node:assert/strict';
import * as THREE from 'three';
import { batchStaticMeshes } from '../renderer/ui/turntable/static-meshes';

const parent = new THREE.Group();
const material = new THREE.MeshStandardMaterial();
const parts = [new THREE.BoxGeometry(1, 2, 3).toNonIndexed(), new THREE.TorusGeometry(1, .1, 6, 32)];
const expected: number[][] = [];
for (const [index, geometry] of parts.entries()) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(index * 3, index, -index);
  mesh.rotation.set(.2, .3 * index, -.1); mesh.scale.set(1, 2, .7);
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.updateMatrix();
  const position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++) expected.push(new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(mesh.matrix).toArray());
  parent.add(mesh);
}
const dynamic = new THREE.Group(); dynamic.add(new THREE.Mesh(new THREE.BoxGeometry(), material)); parent.add(dynamic);
const transparent = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial({ transparent: true })); parent.add(transparent);
const differentShadow = new THREE.Mesh(new THREE.BoxGeometry(), material); parent.add(differentShadow);
const trianglesBefore = parts.reduce((sum, geometry) => sum + (geometry.index?.count ?? geometry.getAttribute('position').count) / 3, 0);
batchStaticMeshes(parent);
assert.equal(parent.children.length, 4, 'only the two compatible siblings are batched');
assert.ok(parent.children.includes(dynamic) && parent.children.includes(transparent) && parent.children.includes(differentShadow));
const merged = parent.children.find(child => child !== dynamic && child !== transparent && child !== differentShadow) as THREE.Mesh;
assert.equal(merged.material, material); assert.equal(merged.castShadow, true); assert.equal(merged.receiveShadow, true);
assert.equal(merged.geometry.index!.count / 3, trianglesBefore, 'triangle count is unchanged');
const positions = merged.geometry.getAttribute('position');
assert.equal(positions.count, expected.length, 'indexed vertex reuse is preserved');
for (let i = 0; i < positions.count; i++) {
  assert.ok(new THREE.Vector3().fromBufferAttribute(positions, i).distanceTo(new THREE.Vector3(...expected[i])) < 1e-6, 'baked transforms preserve every vertex');
}
console.log(JSON.stringify({ triangles: trianglesBefore, vertices: positions.count, result: 'passed' }));
