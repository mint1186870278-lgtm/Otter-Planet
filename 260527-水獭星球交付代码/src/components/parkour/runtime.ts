// src/components/parkour/runtime.ts
// 跑酷 3D 场景的「共享运行时」——模块级可变状态 + 每帧复用的工具。
//
// 为什么单独放这里：这些是整个场景的「粘合层」，被多个子系统组件读写：
//   - occluderRef：TerrainModel 挂载时写入地形组，相机 + 地面吸附 + 障碍/花草落位都读它做向下射线。
//   - playerYRef：Character 每帧写主角真实世界 Y，CameraRig / DebugTracker 读。
//   - 单例 Raycaster / Vector3：避免每帧 new 分配。
//   - snapGroundY：从向下射线命中里挑真正的地面顶面。
// ES 模块单例语义保证：各子系统文件 import 到的是同一个引用，运行时行为与原来同文件完全一致。

import * as THREE from 'three';

// 相机遮挡体：terrain（树/石/地面）挂到这里，供相机每帧射线检测——
// 被树挡住主角时把相机拉到树前，主角始终可见。由 TerrainModel 挂载时赋值。
export const occluderRef: { current: THREE.Object3D | null } = { current: null };
export const cameraOccluderRef: { current: THREE.Object3D | null } = { current: null };
// 地形跟随后主角的真实世界 Y，供 CameraRig 用（让相机始终在玩家正上方固定高度，不贴地）
export const playerYRef: { current: number } = { current: 0 };

// 地形跟随 — 共享 raycaster 对象，避免每帧分配
export const _terrainCaster = new THREE.Raycaster();
export const _terrainDown   = new THREE.Vector3(0, -1, 0);
export const _terrainOrigin = new THREE.Vector3();

// 障碍物复用的射线，模块级单例避免每次 mount 分配
export const _obstacleCaster = new THREE.Raycaster();
export const _obstacleOrigin = new THREE.Vector3();
export const _obstacleDown   = new THREE.Vector3(0, -1, 0);

// 从向下射线的命中里挑「真正的地面顶面」高度。
// ⚠️ 关键坑：地形组里烤进了树冠(y≈8)和云(y≈26~43)，命中按距离从近到远(=从高到低)排序，
//    直接取 hits[0] 会把花吸到树顶/云里 → 地面没花、半空一堆。改为从【低到高】找第一个
//    低于 GROUND_SNAP_MAX_Y 的命中，即跳过树冠/云、落到真实地面。找不到则回退最低命中或 0。
export const GROUND_SNAP_MAX_Y = 4; // 地面顶面高度上限（草地/石板都在此以下；树冠/云远高于此）
export function snapGroundY(hits: THREE.Intersection[]): number {
  if (!hits.length) return 0;
  // 命中默认按距离升序（从高到低）。从最低开始找第一个 ≤ 阈值的，即地面。
  for (let i = hits.length - 1; i >= 0; i--) {
    if (hits[i].point.y <= GROUND_SNAP_MAX_Y) return hits[i].point.y;
  }
  return hits[hits.length - 1].point.y; // 全在阈值之上（罕见）→ 取最低那个
}
