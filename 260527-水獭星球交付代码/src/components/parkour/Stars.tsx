// src/components/parkour/Stars.tsx
// 跑酷星星（钥匙）子系统——从 ParkourScene.tsx 抽出。
//   StarObject：单颗星（浮动/呼吸/聚焦光圈），走近弹提示、碰到即收集。
//   StarsGroup：按 STAR_POSITIONS + extraItems 渲染未收集的星，支持 landOverrides 覆盖坐标。
// 依赖共享层：widgets（StarMesh/StarGuideMarker/FloatingLabel/TeachingPointer）。

import React, { useRef, useEffect, useMemo, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { ACTOR_SCALE, STAR_POSITIONS, type Vec2, type WorldPrompt, type StaticCollectible } from '../parkourConstants';
import { StarMesh, StarGuideMarker, FloatingLabel, TeachingPointer } from './widgets';

function StarObject({ item, playerPosRef, focus, guide, softFocus, onCollect, onPromptChange }: {
  item: StaticCollectible;
  playerPosRef: React.RefObject<Vec2>;
  focus: boolean;
  guide: boolean;
  softFocus: boolean;
  onCollect: (id: number, type: StaticCollectible['type']) => void;
  onPromptChange: (prompt: WorldPrompt) => void;
}) {
  const groupRef = useRef<THREE.Group>(null!);
  const collected = useRef(false);
  const COLLECT_RANGE = 1.5 * ACTOR_SCALE;
  const PROMPT_RANGE = (item.id === 0 ? 10 : 6) * ACTOR_SCALE;
  const isRequired = item.isRequired;
  const promptedRef = useRef(false);
  const [promptVisible, setPromptVisible] = useState(!softFocus && item.id === 0);

  useEffect(() => () => {
    if (promptedRef.current) onPromptChange(null);
  }, [onPromptChange]);

  useFrame((st) => {
    if (!groupRef.current || collected.current) return;
    const pulse = Math.sin(st.clock.elapsedTime * (item.id === 0 ? 4 : 2.4) + item.id);
    const focusPulse = focus || guide ? Math.sin(st.clock.elapsedTime * 8) * 0.22 : 0;
    const tutorialScale = (softFocus && !guide ? 0.64 : 1) * ACTOR_SCALE;
    const baseY = item.y != null ? item.y : 0.55 * ACTOR_SCALE;
    groupRef.current.position.y = baseY + Math.sin(st.clock.elapsedTime * 2.6 + item.id) * 0.15 + (focus || guide ? Math.max(0, focusPulse) : 0);
    groupRef.current.scale.setScalar(((isRequired ? 1 : 0.86) + (isRequired ? 0.08 : 0.04) * pulse + Math.max(0, focusPulse)) * tutorialScale);
    const p = playerPosRef.current;
    const dx = p.x - item.x;
    const dz = p.z - item.z;
    const dist2 = dx * dx + dz * dz;
    if (!softFocus && dist2 < PROMPT_RANGE * PROMPT_RANGE) {
      if (!promptedRef.current) {
        promptedRef.current = true;
        setPromptVisible(true);
        onPromptChange({
          kind: 'star',
          id: item.id,
          text: item.id === 0 ? '撞我！' : '碰到星星！',
          first: item.id === 0,
          position: { x: item.x, z: item.z },
        });
      }
    } else if (promptedRef.current) {
      promptedRef.current = false;
      setPromptVisible(!softFocus && item.id === 0);
      onPromptChange(null);
    }
    if (dist2 < COLLECT_RANGE * COLLECT_RANGE) {
      collected.current = true;
      promptedRef.current = false;
      onPromptChange(null);
      onCollect(item.id, item.type);
    }
  });

  return (
    <group ref={groupRef} position={[item.x, item.y != null ? item.y : 0.55 * ACTOR_SCALE, item.z]}>
      {isRequired && (!softFocus || guide) && (
        <>
          {(focus || guide || item.id === 0) && (
            <pointLight color="#FFE45C" intensity={focus || guide ? 4.5 : 2.2} distance={7} decay={1.6} />
          )}
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
            <ringGeometry args={[1.15, 1.36, 32]} />
            <meshBasicMaterial color="#FFE45C" transparent opacity={focus || guide ? 0.78 : 0.48} depthWrite={false} />
          </mesh>
        </>
      )}
      <StarMesh />
      {guide && <StarGuideMarker />}
      {promptVisible && !softFocus && <FloatingLabel text={item.id === 0 ? '撞我！' : '碰到星星！'} y={item.id === 0 ? 3.1 : 2.85} color="#FF9100" />}
      {item.id === 0 && !softFocus && <TeachingPointer />}
    </group>
  );
}

export function StarsGroup({ collected, playerPosRef, focusStarId, guideStarId, softFocus, onCollect, onPromptChange, extraItems = [], landOverrides }: {
  collected: Set<number>;
  playerPosRef: React.RefObject<Vec2>;
  focusStarId: number | null;
  guideStarId: number | null;
  softFocus: boolean;
  onCollect: (id: number, type: StaticCollectible['type']) => void;
  onPromptChange: (prompt: WorldPrompt) => void;
  extraItems?: StaticCollectible[];
  landOverrides?: { id: number; x: number; z: number }[];
}) {
  const allItems = useMemo(() => {
    const base = landOverrides
      ? STAR_POSITIONS.map(s => {
          const ov = landOverrides.find(o => o.id === s.id);
          return ov ? { ...s, x: ov.x, z: ov.z } : s;
        })
      : STAR_POSITIONS;
    return [...base, ...extraItems];
  }, [extraItems, landOverrides]);
  return (
    <>
      {allItems.filter(item => !collected.has(item.id)).map(item => (
        <StarObject
          key={item.id}
          item={item}
          playerPosRef={playerPosRef}
          focus={focusStarId === item.id}
          guide={guideStarId === item.id}
          softFocus={softFocus}
          onCollect={onCollect}
          onPromptChange={prompt => {
            if (!prompt || prompt.id === item.id) onPromptChange(prompt);
          }}
        />
      ))}
    </>
  );
}
