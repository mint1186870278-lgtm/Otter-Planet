// src/components/parkour/Obstacles.tsx
// 跑酷动态障碍物子系统——从 ParkourScene.tsx 抽出。
//   ObstacleField：每帧回收远处障碍、按节流在玩家前方扇形补生成，维持 OB_TARGET 个。
//   ObstacleObject：单个障碍（石头/木桶/箱子），落地吸附、撞击迟滞、箱子带"撞一下"提示。
// 依赖共享层：runtime（occluderRef/snapGroundY/障碍射线单例）、widgets（FloatingLabel/QuestionBoxBadge）。

import React, { useState, useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import {
  ACTOR_SCALE, TERRAIN_SIZE, STAR_POSITIONS, NPC_POSITIONS, PK,
  type Vec2, type WorldPrompt,
} from '../parkourConstants';
import { occluderRef, snapGroundY, _obstacleCaster, _obstacleOrigin, _obstacleDown } from './runtime';
import { FloatingLabel, QuestionBoxBadge } from './widgets';
import { loadTerrainHeightfield, sampleTerrainHeight } from './navmesh/terrainHeightfield';

// 碰到触发红屏（带迟滞防重复）。生成时避开星星/NPC，不盖道具。
export type ActiveObstacle = { id: number; variant: 0 | 1 | 2; x: number; z: number };

const OB_TARGET = 10;       // 维持的活跃障碍数（少于此值就补）
const OB_MAX_PER_TICK = 2;  // 每次生成节流：单 tick 最多补几个，避免一帧涌出
const OB_TICK = 0.25;       // 生成节流间隔（秒）
const OB_SPAWN_MIN = 15 * ACTOR_SCALE;    // 生成最近距离（太近会怼脸）
const OB_SPAWN_MAX = 30 * ACTOR_SCALE;    // 生成最远距离（太远看不见）
const OB_RECYCLE = 40 * ACTOR_SCALE;      // 超出此距离即回收（已跑过去）
const OB_SPREAD = Math.PI / 3; // 朝向前方的扇形半角（±60°）
const OB_CLEAR = 3 * ACTOR_SCALE;         // 与星星/NPC/其它障碍的最小间距（小于则换点重选）

function RocksModel() {
  const { scene } = useGLTF(`${PK}/rocks.glb`);
  return <primitive object={scene.clone()} scale={0.288} />;
}
function BarrelModel() {
  const { scene } = useGLTF(`${PK}/barrel.glb`);
  return <primitive object={scene.clone()} scale={0.256} />;
}
function CrateModel() {
  const { scene } = useGLTF(`${PK}/crate.glb`);
  return <primitive object={scene.clone()} scale={0.256} />;
}

function ObstacleObject({ obstacle, playerPosRef, hitBurstId, softFocus, onHit, onPromptChange }: {
  obstacle: ActiveObstacle;
  playerPosRef: React.RefObject<Vec2>;
  hitBurstId: number | null;
  softFocus: boolean;
  onHit: (id: number, variant: ActiveObstacle['variant'], position: Vec2) => void;
  onPromptChange: (prompt: WorldPrompt) => void;
}) {
  const groupRef = useRef<THREE.Group>(null!);
  const inRange = useRef(false); // 冷却：进入范围触发一次，离开后才能再触发
  const HIT_RANGE = 1.2 * ACTOR_SCALE;
  const PROMPT_RANGE = obstacle.variant === 2 ? 5.2 * ACTOR_SCALE : 0;
  const promptedRef = useRef(false);
  const [shakeUntil, setShakeUntil] = useState(0);
  const [promptVisible, setPromptVisible] = useState(false);

  // 生成时吸附到真实地面高度，避免在斜坡上浮空或陷地
  useEffect(() => {
    let cancelled = false;
    if (!groupRef.current) return;
    const heightfieldY = sampleTerrainHeight(obstacle.x, obstacle.z);
    if (heightfieldY !== null) {
      groupRef.current.position.y = heightfieldY;
      return;
    }
    const terrain = occluderRef.current;
    if (!terrain) {
      void loadTerrainHeightfield().then((heightfield) => {
        const y = heightfield?.sampleHeight(obstacle.x, obstacle.z);
        if (!cancelled && y !== null && y !== undefined && groupRef.current) {
          groupRef.current.position.y = y;
        }
      });
      return () => { cancelled = true; };
    }
    _obstacleOrigin.set(obstacle.x, 50, obstacle.z);
    _obstacleCaster.set(_obstacleOrigin, _obstacleDown);
    _obstacleCaster.far = 100;
    const hits = _obstacleCaster.intersectObject(terrain, true);
    const groundY = snapGroundY(hits);
    groupRef.current.position.y = groundY;
    return () => { cancelled = true; };
  }, [obstacle.x, obstacle.z]);

  useEffect(() => {
    void loadTerrainHeightfield();
  }, []);

  useEffect(() => {
    if (hitBurstId === obstacle.id) setShakeUntil(Date.now() + 320);
  }, [hitBurstId, obstacle.id]);

  useEffect(() => () => {
    if (promptedRef.current) onPromptChange(null);
  }, [onPromptChange]);

  useFrame((st) => {
    if (groupRef.current) {
      const breathe = obstacle.variant === 2 ? 1 + Math.sin(st.clock.elapsedTime * 3.2 + obstacle.id) * 0.07 : 1;
      groupRef.current.scale.setScalar(breathe * (softFocus ? 0.72 : 1));
      if (Date.now() < shakeUntil) {
        groupRef.current.position.x = obstacle.x + Math.sin(st.clock.elapsedTime * 70) * 0.18;
      } else {
        groupRef.current.position.x = obstacle.x;
      }
    }
    const p = playerPosRef.current;
    const dx = p.x - obstacle.x;
    const dz = p.z - obstacle.z;
    const dist2 = dx * dx + dz * dz;
    if (!softFocus && obstacle.variant === 2 && dist2 < PROMPT_RANGE * PROMPT_RANGE) {
      if (!promptedRef.current) {
        promptedRef.current = true;
        setPromptVisible(true);
        onPromptChange({ kind: 'box', id: obstacle.id, text: '撞一下箱子！', position: { x: obstacle.x, z: obstacle.z } });
      }
    } else if (promptedRef.current) {
      promptedRef.current = false;
      setPromptVisible(false);
      onPromptChange(null);
    }
    const hit = dist2 < HIT_RANGE * HIT_RANGE;
    if (hit && !inRange.current) {
      inRange.current = true;
      onHit(obstacle.id, obstacle.variant, { x: obstacle.x, z: obstacle.z });
    } else if (!hit && inRange.current) {
      inRange.current = false;
    }
  });

  return (
    <group ref={groupRef} position={[obstacle.x, 0, obstacle.z]}>
      {obstacle.variant === 2 && (
        <>
          {promptVisible && !softFocus && <pointLight color="#FFB732" intensity={1.7} distance={5} decay={1.5} />}
          {promptVisible && !softFocus && <FloatingLabel text="撞一下箱子！" y={2.45} color="#FF9100" scale={0.07} />}
          {!softFocus && <QuestionBoxBadge />}
        </>
      )}
      {obstacle.variant === 0 && <RocksModel />}
      {obstacle.variant === 1 && <BarrelModel />}
      {obstacle.variant === 2 && <CrateModel />}
    </group>
  );
}

// 动态障碍管理器：每帧回收远处、按节流补生成，维持 OB_TARGET 个。
// 生成点在玩家「移动方向（静止则默认 -z 前进方向）」前方扇形内，避开星星/NPC/其它障碍。
export function ObstacleField({ velocityRef, playerPosRef, hitBurstId, softFocus, onHit, onPromptChange, paused }: {
  velocityRef: React.RefObject<Vec2>;
  playerPosRef: React.RefObject<Vec2>;
  hitBurstId: number | null;
  softFocus: boolean;
  onHit: (id: number, variant: ActiveObstacle['variant'], position: Vec2) => void;
  onPromptChange: (prompt: WorldPrompt) => void;
  paused: boolean;
}) {
  const [obstacles, setObstacles] = useState<ActiveObstacle[]>([]);
  const nextId = useRef(0);
  const tickAccum = useRef(0);
  // 当前活跃障碍坐标的镜像，供生成时做"不要太近"检测（避免读 state 闭包过期）
  const liveRef = useRef<ActiveObstacle[]>([]);
  liveRef.current = obstacles;

  useFrame((_s, d) => {
    if (paused) return;
    const p = playerPosRef.current;

    // 1) 回收：跑过去（超出 OB_RECYCLE）的障碍销毁，腾名额
    const kept = liveRef.current.filter(o => {
      const dx = o.x - p.x, dz = o.z - p.z;
      return dx * dx + dz * dz <= OB_RECYCLE * OB_RECYCLE;
    });
    let changed = kept.length !== liveRef.current.length;

    // 2) 生成节流：累计到 OB_TICK 才尝试补，单次最多 OB_MAX_PER_TICK 个
    tickAccum.current += d;
    const toAdd: ActiveObstacle[] = [];
    if (tickAccum.current >= OB_TICK) {
      tickAccum.current = 0;
      const deficit = OB_TARGET - kept.length;
      const spawnCount = Math.min(OB_MAX_PER_TICK, Math.max(0, deficit));

      // 朝向：移动方向；静止时默认 -z（前进方向）
      const vel = velocityRef.current;
      const moving = Math.hypot(vel.x, vel.z) > 0.01;
      const baseAng = moving ? Math.atan2(vel.x, vel.z) : Math.PI; // 与角色 heading 同公式
      const lim = TERRAIN_SIZE / 2 - 4;

      for (let n = 0; n < spawnCount; n++) {
        let placed: ActiveObstacle | null = null;
        for (let attempt = 0; attempt < 8; attempt++) {
          const ang = baseAng + (Math.random() * 2 - 1) * OB_SPREAD;
          const dist = OB_SPAWN_MIN + Math.random() * (OB_SPAWN_MAX - OB_SPAWN_MIN);
          const x = THREE.MathUtils.clamp(p.x + Math.sin(ang) * dist, -lim, lim);
          const z = THREE.MathUtils.clamp(p.z + Math.cos(ang) * dist, -lim, lim);
          // 避让：星星 / NPC / 已有障碍（含本 tick 刚加的）都不能太近
          const tooClose =
            STAR_POSITIONS.some(s => (s.x - x) ** 2 + (s.z - z) ** 2 < OB_CLEAR * OB_CLEAR) ||
            NPC_POSITIONS.some(npc => (npc.x - x) ** 2 + (npc.z - z) ** 2 < OB_CLEAR * OB_CLEAR) ||
            kept.some(o => (o.x - x) ** 2 + (o.z - z) ** 2 < OB_CLEAR * OB_CLEAR) ||
            toAdd.some(o => (o.x - x) ** 2 + (o.z - z) ** 2 < OB_CLEAR * OB_CLEAR);
          if (tooClose) continue;
          placed = { id: nextId.current++, variant: (Math.floor(Math.random() * 3) as 0 | 1 | 2), x, z };
          break;
        }
        if (placed) toAdd.push(placed);
      }
      if (toAdd.length) changed = true;
    }

    if (changed) setObstacles([...kept, ...toAdd]);
  });

  return (
    <>
      {obstacles.map(obs => (
        <React.Suspense key={obs.id} fallback={null}>
          <ObstacleObject
            obstacle={obs}
            playerPosRef={playerPosRef}
            hitBurstId={hitBurstId}
            softFocus={softFocus}
            onHit={onHit}
            onPromptChange={prompt => {
              if (!prompt || prompt.id === obs.id) onPromptChange(prompt);
            }}
          />
        </React.Suspense>
      ))}
    </>
  );
}
