import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Merge the direct Mesh children of every Group in the tree by material (and
 * shadow flags), recursing into sub-groups. Animated hierarchy (bones, weapon
 * parts, anchors) is preserved; draw calls drop by an order of magnitude.
 */
export function mergeStatic(root) {
  const visit = (node) => {
    const buckets = new Map();
    for (const ch of [...node.children]) {
      if (ch.isMesh && !ch.userData.keep && ch.children.length === 0) {
        const key = `${ch.material.uuid}|${ch.castShadow}|${ch.receiveShadow}|${ch.renderOrder}`;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(ch);
      } else if (!ch.isMesh) visit(ch);
    }
    for (const list of buckets.values()) {
      if (list.length < 2) continue;
      const geos = [];
      for (const m of list) {
        m.updateMatrix();
        let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
        for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
        if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
        g.applyMatrix4(m.matrix);
        geos.push(g);
      }
      const merged = mergeGeometries(geos, false);
      geos.forEach((g) => g.dispose());
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, list[0].material);
      mesh.castShadow = list[0].castShadow; mesh.receiveShadow = list[0].receiveShadow; mesh.renderOrder = list[0].renderOrder;
      mesh.userData.merged = true;
      for (const m of list) node.remove(m);
      node.add(mesh);
    }
  };
  visit(root);
  return root;
}
