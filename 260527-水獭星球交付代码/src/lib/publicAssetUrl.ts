const ASSET_ORIGIN = (import.meta.env.VITE_OTTERLANTIS_ASSET_ORIGIN || '').replace(/\/$/, '');

export const publicAssetUrl = (path: string) => `${ASSET_ORIGIN}${path}`;
