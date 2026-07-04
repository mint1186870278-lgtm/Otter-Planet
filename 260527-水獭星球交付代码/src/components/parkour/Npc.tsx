// src/components/parkour/Npc.tsx
// 跑酷 NPC 子系统——从 ParkourScene.tsx 抽出。
//   NpcModel：加载并克隆 NPC 骨骼模型（缩放/朝向/落地补偿/投影）。
//   NpcSlot：单个 NPC 站位（射线吸附地面或手动 y、走近半径触发对话，带迟滞）。
//   NpcGroup：按 positions（或默认 NPC_POSITIONS）渲染三个 NPC。
// 依赖共享层：parkourConstants（NPC 配置 + 类型）、runtime（occluderRef/snapGroundY）。

import React, { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { ACTOR_SCALE, NPC_URLS, NPC_SCALES, NPC_ROTATIONS, NPC_POSITIONS, type Vec2, type NpcPos } from '../parkourConstants';
import { occluderRef, snapGroundY } from './runtime';
import { loadTerrainHeightfield, sampleTerrainHeight } from './navmesh/terrainHeightfield';

function NpcModel({ url, scale, rotationY, npcIndex }: { url: string; scale: number; rotationY: number; npcIndex: number }) {
  const { scene } = useGLTF(url);
  const cloned = useMemo(() => {
    const c = cloneSkinned(scene) as THREE.Object3D;
    const s = scale * ACTOR_SCALE;
    c.scale.set(s, s, s);
    c.rotation.set(0, rotationY, 0);
    c.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(c);
    const footY = isFinite(box.min.y) ? -box.min.y : 0;
    c.position.set(0, footY, 0);
    c.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return c;
  }, [scene, scale, rotationY, npcIndex]);
  return <primitive object={cloned} />;
}

function NpcSlot({ pos, url, scale, rotationY, npcIndex, playerPosRef, onApproach, loadModel = true }: {
  pos: NpcPos; url: string; scale: number; rotationY: number;
  npcIndex: number; playerPosRef: React.RefObject<Vec2>; onApproach: (index: number) => void;
  loadModel?: boolean;
}) {
  const triggered = useRef(false);
  const groupRef = useRef<THREE.Group>(null!);
  const snapped = useRef(false);
  const posRef = useRef(pos);
  posRef.current = pos; // 每次渲染都更新，useFrame 始终读到最新值
  const casterRef = useRef(new THREE.Raycaster());
  const originRef = useRef(new THREE.Vector3());
  const downRef = useRef(new THREE.Vector3(0, -1, 0));
  const APPROACH_RANGE = 4 * ACTOR_SCALE;
  const RELEASE_RANGE = 6 * ACTOR_SCALE;

  useEffect(() => {
    return () => {};
  }, [npcIndex, pos.x, pos.z]);

  useEffect(() => {
    void loadTerrainHeightfield();
  }, []);

  // pos.y 手动指定时每帧直接写入（实时响应 slider）；否则走一次性射线吸附
  useFrame(() => {
    if (!groupRef.current) return;
    const p = posRef.current;
    if (p.y != null) {
      groupRef.current.position.y = p.y;
      return;
    }
    if (snapped.current) return;
    const heightfieldY = sampleTerrainHeight(p.x, p.z);
    if (heightfieldY !== null) {
      groupRef.current.position.y = heightfieldY;
      snapped.current = true;
      return;
    }
    const terrain = occluderRef.current;
    if (!terrain) return;
    originRef.current.set(p.x, 50, p.z);
    casterRef.current.set(originRef.current, downRef.current);
    casterRef.current.far = 100;
    const hits = casterRef.current.intersectObject(terrain, true);
    const groundY = snapGroundY(hits);
    groupRef.current.position.y = groundY;
    snapped.current = true;
  });

  // x/z 变化时重新触发射线吸附
  useEffect(() => {
    snapped.current = false;
    if (groupRef.current) groupRef.current.position.set(pos.x, pos.y ?? 0, pos.z);
  }, [pos.x, pos.z]);

  useFrame(() => {
    const p = posRef.current;
    const pl = playerPosRef.current;
    const dx = pl.x - p.x;
    const dz = pl.z - p.z;
    const dist2 = dx * dx + dz * dz;
    if (!triggered.current && dist2 < APPROACH_RANGE * APPROACH_RANGE) {
      triggered.current = true;
      onApproach(npcIndex);
    } else if (triggered.current && dist2 > RELEASE_RANGE * RELEASE_RANGE) {
      triggered.current = false;
    }
  });

  return (
    <group ref={groupRef} position={[pos.x, pos.y ?? 0, pos.z]}>
      {loadModel ? (
        <React.Suspense fallback={
          <mesh position={[0, 1, 0]}>
            <sphereGeometry args={[0.5, 8, 8]} />
            <meshLambertMaterial color="#FF9100" />
          </mesh>
        }>
          <NpcModel url={url} scale={scale} rotationY={rotationY} npcIndex={npcIndex} />
        </React.Suspense>
      ) : (
        <mesh position={[0, 1, 0]}>
          <sphereGeometry args={[0.45, 8, 8]} />
          <meshLambertMaterial color="#FF9100" />
        </mesh>
      )}
    </group>
  );
}

export function NpcGroup({ playerPosRef, softFocus, onNpcApproach, positions, loadModels = true }: {
  playerPosRef: React.RefObject<Vec2>;
  softFocus: boolean;
  onNpcApproach: (index: number) => void;
  positions?: NpcPos[];
  loadModels?: boolean;
}) {
  const pts = positions ?? NPC_POSITIONS;
  return (
    <group scale={softFocus ? 0.78 : 1}>
      {pts.map((pos, i) => (
        <NpcSlot key={`${i}-${pos.x}-${pos.z}`} pos={pos} url={NPC_URLS[i]} scale={NPC_SCALES[i]} rotationY={NPC_ROTATIONS[i]} npcIndex={i} playerPosRef={playerPosRef} onApproach={onNpcApproach} loadModel={loadModels} />
      ))}
    </group>
  );
}
