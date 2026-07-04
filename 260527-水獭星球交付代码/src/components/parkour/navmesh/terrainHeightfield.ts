import { publicAssetUrl } from '../../../lib/publicAssetUrl';

type TerrainHeightfieldMeta = {
  version: number;
  cellSize: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  width: number;
  height: number;
  bin: string;
};

export type TerrainHeightfield = {
  meta: TerrainHeightfieldMeta;
  sampleHeight: (x: number, z: number) => number | null;
};

let pending: Promise<TerrainHeightfield | null> | null = null;
let loaded: TerrainHeightfield | null = null;

const JSON_URL = publicAssetUrl('/model-site/terrain-heightfield.json');
const BIN_URL = publicAssetUrl('/model-site/terrain-heightfield.bin');

const isValidHeight = (value: number) => Number.isFinite(value);

function makeHeightfield(meta: TerrainHeightfieldMeta, data: Float32Array): TerrainHeightfield {
  const at = (ix: number, iz: number) => data[iz * meta.width + ix];

  return {
    meta,
    sampleHeight(x, z) {
      if (x < meta.minX || x > meta.maxX || z < meta.minZ || z > meta.maxZ) return null;

      const fx = (x - meta.minX) / meta.cellSize;
      const fz = (z - meta.minZ) / meta.cellSize;
      const ix = Math.floor(fx);
      const iz = Math.floor(fz);
      const tx = fx - ix;
      const tz = fz - iz;

      if (ix < 0 || iz < 0 || ix >= meta.width || iz >= meta.height) return null;
      if (ix >= meta.width - 1 || iz >= meta.height - 1) {
        const edge = at(Math.min(ix, meta.width - 1), Math.min(iz, meta.height - 1));
        return isValidHeight(edge) ? edge : null;
      }

      const h00 = at(ix, iz);
      const h10 = at(ix + 1, iz);
      const h01 = at(ix, iz + 1);
      const h11 = at(ix + 1, iz + 1);
      if (![h00, h10, h01, h11].every(isValidHeight)) return null;

      const hx0 = h00 + (h10 - h00) * tx;
      const hx1 = h01 + (h11 - h01) * tx;
      return hx0 + (hx1 - hx0) * tz;
    },
  };
}

export function getTerrainHeightfield() {
  return loaded;
}

export function sampleTerrainHeight(x: number, z: number) {
  return loaded?.sampleHeight(x, z) ?? null;
}

export function loadTerrainHeightfield() {
  if (loaded) return Promise.resolve(loaded);
  if (pending) return pending;

  pending = fetch(JSON_URL)
    .then(async (metaResponse) => {
      if (!metaResponse.ok) throw new Error(`Failed to load ${JSON_URL}: ${metaResponse.status}`);
      const meta = await metaResponse.json() as TerrainHeightfieldMeta;
      const binUrl = meta.bin === 'terrain-heightfield.bin' ? BIN_URL : new URL(meta.bin, metaResponse.url).toString();
      const binResponse = await fetch(binUrl);
      if (!binResponse.ok) throw new Error(`Failed to load ${binUrl}: ${binResponse.status}`);
      const buffer = await binResponse.arrayBuffer();
      const data = new Float32Array(buffer);
      if (data.length !== meta.width * meta.height) {
        throw new Error(`Heightfield size mismatch: ${data.length} != ${meta.width * meta.height}`);
      }
      loaded = makeHeightfield(meta, data);
      return loaded;
    })
    .catch((error) => {
      console.warn('[parkour] terrain heightfield unavailable, falling back to raycast', error);
      return null;
    });

  return pending;
}
