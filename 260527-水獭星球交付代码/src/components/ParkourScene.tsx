import React, { useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
// 本文件现在只做「编排」：把各子系统组件组合进 <Canvas> 场景 + 资源 preload。
// 非组件常量/类型来自 parkourConstants，视觉/布局配置来自 parkour/config，各子系统在 parkour/ 下。
import {
  SHOW_COORDS, CREEK_STAR_POSITIONS, creekStarsAsCollectibles, PK, NPC_URLS,
  type Vec2, type NpcPos, type DebugInfo, type WorldPrompt, type SkyPhase,
  type StaticCollectible, type CreekStarPos,
} from './parkourConstants';
import {
  DEBUG_MODE, CHARACTER_URL, FAKE_MOON_URL, REAL_MOON_URL, TERRAIN_URL,
  TREE_ROUND_URL, BUSH_URL, FLOWER_DAISY_URL, FLOWER_YELLOW_URL, PLANT_GREEN_URL,
} from './parkour/config';
import { StarsGroup } from './parkour/Stars';
import { ObstacleField, type ActiveObstacle } from './parkour/Obstacles';
import { TerrainModel, Cloud, CLOUD_DATA } from './parkour/Scenery';
import { NpcGroup } from './parkour/Npc';
import { Character } from './parkour/Character';
import { CameraRig, SkyAndLights, FakeMoon, RealMoon, DebugTracker } from './parkour/CameraSkyMoon';


// ── main ───────────────────────────────────────────────────────────────────
interface ParkourSceneProps {
  velocityRef: React.RefObject<Vec2>;
  playerPosRef: React.RefObject<Vec2>;
  camYawRef: React.RefObject<number>;
  collectedIds: Set<number>;
  hitEffect: string | null;
  paused?: boolean; // NPC 对话弹出时暂停障碍生成（玩家也冻结）
  skyPhase?: SkyPhase;        // 天空阶段（白天/黄昏/夜晚）
  fakeMoonPos?: Vec2 | null;  // 非空则刷出假月亮于此世界坐标
  realMoonPos?: Vec2 | null;  // 非空则真月亮升起于此世界坐标
  onCollect: (id: number, type: StaticCollectible['type']) => void;
  focusStarId?: number | null;
  guideStarId?: number | null;
  obstacleBurstId?: number | null;
  softFocusInteractives?: boolean;
  onObstacleHit: (id: number, variant: ActiveObstacle['variant'], position: Vec2) => void;
  onWorldPromptChange?: (prompt: WorldPrompt) => void;
  onNpcApproach: (index: number) => void;
  onFakeMoonReach?: () => void; // 玩家走近假月亮
  onRealMoonRisen?: () => void; // 真月亮升起完成
  onDebugUpdate?: (info: DebugInfo) => void;
  debugYRef?: React.RefObject<number | null>;
  creekStarPositions?: CreekStarPos[];
  npcPositions?: NpcPos[];
  landStarPositions?: { id: number; x: number; z: number }[];
}

export default function ParkourScene({ velocityRef, playerPosRef, camYawRef, collectedIds, hitEffect, paused = false, skyPhase = 'day', fakeMoonPos = null, realMoonPos = null, focusStarId = null, guideStarId = null, obstacleBurstId = null, softFocusInteractives = false, onCollect, onObstacleHit, onNpcApproach, onWorldPromptChange, onFakeMoonReach, onRealMoonRisen, onDebugUpdate, debugYRef, creekStarPositions, npcPositions, landStarPositions }: ParkourSceneProps) {
  const creekItems = useMemo(
    () => creekStarsAsCollectibles(creekStarPositions ?? CREEK_STAR_POSITIONS),
    [creekStarPositions]
  );
  const onPromptChange = useMemo(() => (prompt: WorldPrompt) => onWorldPromptChange?.(prompt), [onWorldPromptChange]);
  return (
    <>
      <SkyAndLights phase={skyPhase} />

      <CameraRig playerPosRef={playerPosRef} camYawRef={camYawRef} cinematic={!!realMoonPos} />

      <React.Suspense fallback={null}>
        <TerrainModel />
      </React.Suspense>

      <React.Suspense fallback={null}>
        <Character velocityRef={velocityRef} playerPosRef={playerPosRef} hitEffect={hitEffect} debugYRef={debugYRef} />
      </React.Suspense>

      <React.Suspense fallback={null}>
        <StarsGroup
          collected={collectedIds}
          playerPosRef={playerPosRef}
          focusStarId={focusStarId}
          guideStarId={guideStarId}
          softFocus={softFocusInteractives}
          onCollect={onCollect}
          extraItems={creekItems}
          landOverrides={landStarPositions}
          onPromptChange={onPromptChange}
        />
      </React.Suspense>

      <NpcGroup playerPosRef={playerPosRef} softFocus={softFocusInteractives} onNpcApproach={onNpcApproach} positions={npcPositions} />

      <ObstacleField
        velocityRef={velocityRef}
        playerPosRef={playerPosRef}
        hitBurstId={obstacleBurstId}
        softFocus={softFocusInteractives}
        onHit={onObstacleHit}
        onPromptChange={onPromptChange}
        paused={paused}
      />

      {fakeMoonPos && (
        <React.Suspense fallback={null}>
          <FakeMoon pos={fakeMoonPos} playerPosRef={playerPosRef} onReach={() => onFakeMoonReach?.()} />
        </React.Suspense>
      )}

      {realMoonPos && (
        <React.Suspense fallback={null}>
          <RealMoon pos={realMoonPos} onRisen={() => onRealMoonRisen?.()} />
        </React.Suspense>
      )}


      {(DEBUG_MODE || SHOW_COORDS) && onDebugUpdate && (
        <DebugTracker playerPosRef={playerPosRef} onDebugUpdate={onDebugUpdate} npcPositions={npcPositions} />
      )}

      {CLOUD_DATA.map((c, i) => <Cloud key={i} pos={c.pos} spd={c.spd} />)}
    </>
  );
}

useGLTF.preload(`${PK}/star.glb`);
useGLTF.preload(`${PK}/rocks.glb`);
useGLTF.preload(`${PK}/barrel.glb`);
useGLTF.preload(`${PK}/crate.glb`);
useGLTF.preload(CHARACTER_URL);
useGLTF.preload(TERRAIN_URL); // scene-terrain-opt.glb（Meshopt 压缩版，234MB→10MB）
useGLTF.preload(TREE_ROUND_URL);
useGLTF.preload(BUSH_URL);
useGLTF.preload(FLOWER_DAISY_URL);
useGLTF.preload(FLOWER_YELLOW_URL);
useGLTF.preload(PLANT_GREEN_URL);
useGLTF.preload(FAKE_MOON_URL);
useGLTF.preload(REAL_MOON_URL);
NPC_URLS.forEach(url => useGLTF.preload(url));
