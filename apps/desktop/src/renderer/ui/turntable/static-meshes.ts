import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Batch only siblings: parent groups keep their independent animation pivots. */
export function batchStaticMeshes(parent: THREE.Group): void {
  const batches = new Map<string, THREE.Mesh[]>();
  for (const child of parent.children) {
    if (!(child instanceof THREE.Mesh) || child instanceof THREE.InstancedMesh || Array.isArray(child.material)
      || child.material.transparent || child.morphTargetInfluences || child.children.length) continue;
    const key = `${child.material.uuid}:${child.castShadow}:${child.receiveShadow}:${child.renderOrder}`;
    const batch = batches.get(key) ?? [];
    batch.push(child); batches.set(key, batch);
  }
  for (const batch of batches.values()) {
    if (batch.length < 2) continue;
    const parts = batch.map(mesh => {
      mesh.updateMatrix();
      // Mixed primitive types use different indexing. Normalize once at setup.
      const geometry = mesh.geometry.clone();
      if (!geometry.index) geometry.setIndex(Array.from({ length: geometry.getAttribute('position').count }, (_, index) => index));
      return geometry.applyMatrix4(mesh.matrix);
    });
    const geometry = mergeGeometries(parts, false);
    parts.forEach(part => part.dispose());
    if (!geometry) continue;
    const first = batch[0];
    const merged = new THREE.Mesh(geometry, first.material);
    merged.castShadow = first.castShadow; merged.receiveShadow = first.receiveShadow; merged.renderOrder = first.renderOrder;
    geometry.computeBoundingSphere();
    for (const mesh of batch) { parent.remove(mesh); mesh.geometry.dispose(); }
    parent.add(merged);
  }
}
