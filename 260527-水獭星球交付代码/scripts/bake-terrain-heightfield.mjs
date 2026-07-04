import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import draco3d from 'draco3dgltf';

const SRC = 'public/model-site/scene-terrain-opt.glb';
const OUT_JSON = 'public/model-site/terrain-heightfield.json';
const OUT_BIN = 'public/model-site/terrain-heightfield.bin';

const TERRAIN_SIZE = 240;
const CHAR_FOOT_Y = 0;
const TERRAIN_ANCHOR_TO = { x: 0, z: 112 };
const TERRAIN_X_OFFSET = 0;
const TERRAIN_Y_OFFSET = 0;
const TERRAIN_Z_OFFSET = 0;
const GROUND_MAX_Y = 4;

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, value = ''] = arg.replace(/^--/, '').split('=');
  return [key, value];
}));
const cellSize = Number(args.get('cell') || 1);
if (!Number.isFinite(cellSize) || cellSize <= 0) {
  throw new Error(`Invalid --cell value: ${args.get('cell')}`);
}

const minX = -TERRAIN_SIZE / 2;
const maxX = TERRAIN_SIZE / 2;
const minZ = -TERRAIN_SIZE / 2;
const maxZ = TERRAIN_SIZE / 2;
const width = Math.round((maxX - minX) / cellSize) + 1;
const height = Math.round((maxZ - minZ) / cellSize) + 1;
const heights = new Float32Array(width * height);
heights.fill(Number.NaN);

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    'meshopt.decoder': MeshoptDecoder,
    'meshopt.encoder': MeshoptEncoder,
    'draco3d.decoder': await draco3d.createDecoderModule(),
    'draco3d.encoder': await draco3d.createEncoderModule(),
  });

function applyMatrix(m, x, y, z) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

function applyTerrainTransform(p, scale, offset) {
  return [
    offset[0] + p[0] * scale,
    offset[1] + p[1] * scale,
    offset[2] + p[2] * scale,
  ];
}

function triNormalY(a, b, c) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz);
  return len > 0 ? ny / len : 0;
}

function barycentricXZ(px, pz, a, b, c) {
  const v0x = b[0] - a[0], v0z = b[2] - a[2];
  const v1x = c[0] - a[0], v1z = c[2] - a[2];
  const v2x = px - a[0], v2z = pz - a[2];
  const den = v0x * v1z - v1x * v0z;
  if (Math.abs(den) < 1e-8) return null;
  const v = (v2x * v1z - v1x * v2z) / den;
  const w = (v0x * v2z - v2x * v0z) / den;
  const u = 1 - v - w;
  if (u < -1e-5 || v < -1e-5 || w < -1e-5) return null;
  return [u, v, w];
}

function readPosition(pos, index, out) {
  pos.getElement(index, out);
  return out;
}

function getIndex(indices, i) {
  return indices ? indices.getScalar(i) : i;
}

function objectLabel(node, prim) {
  return `${node.getName() || ''} ${prim.getMaterial()?.getName() || ''}`.toLowerCase();
}

const doc = await io.read(SRC);
const root = doc.getRoot();
const meshInfos = [];

for (const node of root.listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  const wm = node.getWorldMatrix();
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION');
    if (!pos) continue;
    const point = [0, 0, 0];
    const info = {
      node,
      prim,
      label: objectLabel(node, prim),
      minX: Infinity,
      maxX: -Infinity,
      minY: Infinity,
      maxY: -Infinity,
      minZ: Infinity,
      maxZ: -Infinity,
    };
    for (let i = 0; i < pos.getCount(); i++) {
      readPosition(pos, i, point);
      const p = applyMatrix(wm, point[0], point[1], point[2]);
      info.minX = Math.min(info.minX, p[0]);
      info.maxX = Math.max(info.maxX, p[0]);
      info.minY = Math.min(info.minY, p[1]);
      info.maxY = Math.max(info.maxY, p[1]);
      info.minZ = Math.min(info.minZ, p[2]);
      info.maxZ = Math.max(info.maxZ, p[2]);
    }
    meshInfos.push(info);
  }
}

let rawMinX = Infinity, rawMaxX = -Infinity, rawMinZ = Infinity, rawMaxZ = -Infinity;
for (const info of meshInfos) {
  rawMinX = Math.min(rawMinX, info.minX);
  rawMaxX = Math.max(rawMaxX, info.maxX);
  rawMinZ = Math.min(rawMinZ, info.minZ);
  rawMaxZ = Math.max(rawMaxZ, info.maxZ);
}

const longestAxis = Math.max(rawMaxX - rawMinX, rawMaxZ - rawMinZ);
const autoScale = longestAxis > 0 ? TERRAIN_SIZE / longestAxis : 1;

const slabs = meshInfos
  .filter((info) => (info.node.getName() || '').startsWith('NURBS') && info.maxY - info.minY < 0.4)
  .map((info) => ({
    cx: (info.minX + info.maxX) / 2,
    cz: (info.minZ + info.maxZ) / 2,
    topY: info.maxY,
  }));

let anchorX;
let anchorZ;
let surfaceTopY;
if (slabs.length) {
  const zMax = Math.max(...slabs.map((slab) => slab.cz));
  const entry = slabs.filter((slab) => slab.cz >= zMax - 0.5);
  const seg = entry.length ? entry : slabs;
  anchorX = seg.reduce((sum, slab) => sum + slab.cx, 0) / seg.length;
  anchorZ = zMax;
  surfaceTopY = Math.max(...seg.map((slab) => slab.topY));
} else {
  anchorX = (rawMinX + rawMaxX) / 2;
  anchorZ = (rawMinZ + rawMaxZ) / 2;
  surfaceTopY = Math.max(...meshInfos.map((info) => info.maxY));
}

const offset = [
  TERRAIN_ANCHOR_TO.x - autoScale * anchorX + TERRAIN_X_OFFSET,
  CHAR_FOOT_Y - autoScale * surfaceTopY + TERRAIN_Y_OFFSET,
  TERRAIN_ANCHOR_TO.z - autoScale * anchorZ + TERRAIN_Z_OFFSET,
];

let acceptedTriangles = 0;
let skippedTriangles = 0;
const local = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
const model = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
const world = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];

for (const info of meshInfos) {
  if (/cloud/.test(info.label)) continue;
  const pos = info.prim.getAttribute('POSITION');
  const indices = info.prim.getIndices();
  if (!pos) continue;
  const wm = info.node.getWorldMatrix();
  const vertexCount = indices ? indices.getCount() : pos.getCount();
  for (let i = 0; i + 2 < vertexCount; i += 3) {
    for (let corner = 0; corner < 3; corner++) {
      readPosition(pos, getIndex(indices, i + corner), local[corner]);
      model[corner] = applyMatrix(wm, local[corner][0], local[corner][1], local[corner][2]);
      world[corner] = applyTerrainTransform(model[corner], autoScale, offset);
    }
    const maxTriY = Math.max(world[0][1], world[1][1], world[2][1]);
    const minTriY = Math.min(world[0][1], world[1][1], world[2][1]);
    if (minTriY > GROUND_MAX_Y || maxTriY > GROUND_MAX_Y + 3) {
      skippedTriangles++;
      continue;
    }
    if (triNormalY(world[0], world[1], world[2]) < 0.18) {
      skippedTriangles++;
      continue;
    }

    const bx0 = Math.max(0, Math.floor((Math.min(world[0][0], world[1][0], world[2][0]) - minX) / cellSize));
    const bx1 = Math.min(width - 1, Math.ceil((Math.max(world[0][0], world[1][0], world[2][0]) - minX) / cellSize));
    const bz0 = Math.max(0, Math.floor((Math.min(world[0][2], world[1][2], world[2][2]) - minZ) / cellSize));
    const bz1 = Math.min(height - 1, Math.ceil((Math.max(world[0][2], world[1][2], world[2][2]) - minZ) / cellSize));
    if (bx1 < bx0 || bz1 < bz0) {
      skippedTriangles++;
      continue;
    }

    acceptedTriangles++;
    for (let iz = bz0; iz <= bz1; iz++) {
      const z = minZ + iz * cellSize;
      for (let ix = bx0; ix <= bx1; ix++) {
        const x = minX + ix * cellSize;
        const bc = barycentricXZ(x, z, world[0], world[1], world[2]);
        if (!bc) continue;
        const y = bc[0] * world[0][1] + bc[1] * world[1][1] + bc[2] * world[2][1];
        const outIndex = iz * width + ix;
        if (Number.isNaN(heights[outIndex]) || y > heights[outIndex]) {
          heights[outIndex] = y;
        }
      }
    }
  }
}

let filled = 0;
for (let i = 0; i < heights.length; i++) {
  if (!Number.isNaN(heights[i])) filled++;
}

fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
fs.writeFileSync(OUT_BIN, Buffer.from(heights.buffer));

const sourceBuffer = fs.readFileSync(SRC);
const metadata = {
  version: 1,
  source: path.basename(SRC),
  sourceSha256: crypto.createHash('sha256').update(sourceBuffer).digest('hex'),
  generatedAt: new Date().toISOString(),
  cellSize,
  minX,
  maxX,
  minZ,
  maxZ,
  width,
  height,
  bin: path.basename(OUT_BIN),
  transform: {
    autoScale,
    offset,
    anchorX,
    anchorZ,
    surfaceTopY,
  },
  stats: {
    samples: heights.length,
    filled,
    coverage: Number((filled / heights.length).toFixed(4)),
    acceptedTriangles,
    skippedTriangles,
  },
};

fs.writeFileSync(OUT_JSON, `${JSON.stringify(metadata, null, 2)}\n`);

const binSize = fs.statSync(OUT_BIN).size;
console.log(`HeightField: ${width} x ${height}, cell=${cellSize}`);
console.log(`Filled: ${filled}/${heights.length} (${(filled / heights.length * 100).toFixed(1)}%)`);
console.log(`Triangles: accepted=${acceptedTriangles}, skipped=${skippedTriangles}`);
console.log(`Wrote: ${OUT_JSON}`);
console.log(`Wrote: ${OUT_BIN} (${(binSize / 1024).toFixed(1)} KB)`);
