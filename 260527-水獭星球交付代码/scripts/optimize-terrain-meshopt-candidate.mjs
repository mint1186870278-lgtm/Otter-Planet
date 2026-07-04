// Build a Meshopt terrain candidate from the current deployed GLB.
// This does not overwrite scene-terrain-opt.glb; it writes a side-by-side file
// so Draco vs Meshopt can be compared before changing runtime URLs.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import draco3d from 'draco3dgltf';
import fs from 'node:fs';

await MeshoptEncoder.ready;

const SRC = 'public/model-site/scene-terrain-opt.glb';
const OUT = '_archive-large-source/scene-terrain-meshopt-candidate.glb';
const BACKUP = '_archive-large-source/scene-terrain-opt.before-meshopt-candidate.glb';

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    'meshopt.encoder': MeshoptEncoder,
    'draco3d.decoder': await draco3d.createDecoderModule(),
  });

const signature = (doc) =>
  doc.getRoot().listNodes()
    .filter((node) => (node.getName() || '').startsWith('NURBS'))
    .map((node) => ({
      name: node.getName() || '',
      t: node.getTranslation(),
      r: node.getRotation(),
      s: node.getScale(),
    }));

const nearlyEqualArray = (a, b, tolerance = 0.001) =>
  a.length === b.length && a.every((value, index) => Math.abs(value - b[index]) <= tolerance);

const sameSignature = (a, b) =>
  a.name === b.name &&
  nearlyEqualArray(a.t, b.t) &&
  nearlyEqualArray(a.r, b.r) &&
  nearlyEqualArray(a.s, b.s);

if (!fs.existsSync(SRC)) {
  console.error(`Missing source: ${SRC}`);
  process.exit(1);
}

fs.mkdirSync('_archive-large-source', { recursive: true });
if (!fs.existsSync(BACKUP)) {
  fs.copyFileSync(SRC, BACKUP);
  console.log(`Backup created: ${BACKUP}`);
}

const beforeBytes = fs.statSync(SRC).size;
const doc = await io.read(SRC);
const dracoExtension = doc.getRoot().listExtensionsUsed()
  .find((extension) => extension.extensionName === 'KHR_draco_mesh_compression');
dracoExtension?.dispose();
const sigBefore = signature(doc);

await doc.transform(
  dedup(),
  prune({ keepLeaves: true }),
  meshopt({ encoder: MeshoptEncoder }),
);

const sigAfter = signature(doc);
let diffs = 0;
const diffSamples = [];
if (sigBefore.length !== sigAfter.length) {
  diffs = -1;
} else {
  for (let index = 0; index < sigBefore.length; index++) {
    if (!sameSignature(sigBefore[index], sigAfter[index])) {
      diffs++;
      if (diffSamples.length < 5) {
        diffSamples.push({ index, before: sigBefore[index], after: sigAfter[index] });
      }
    }
  }
}

if (diffs !== 0) {
  console.error(`NURBS signature changed: ${sigBefore.length}->${sigAfter.length}, transform diffs=${diffs}. Aborting.`);
  console.error(JSON.stringify(diffSamples, null, 2));
  process.exit(1);
}

await io.write(OUT, doc);

const afterBytes = fs.statSync(OUT).size;
console.log(`NURBS nodes preserved: ${sigBefore.length}`);
console.log(`Size: ${(beforeBytes / 1048576).toFixed(2)} MB -> ${(afterBytes / 1048576).toFixed(2)} MB`);
console.log(`Candidate written: ${OUT}`);
