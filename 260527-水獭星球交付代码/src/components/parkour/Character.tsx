// src/components/parkour/Character.tsx
// 跑酷主角子系统——从 ParkourScene.tsx 抽出。
// Character 是唯一写 playerPosRef 的组件（每帧积分 velocityRef）；其它组件只读。
// 负责：八向移动积分 + 边界 clamp、朝向翻转、地形跟随（射线找脚下地面 + 上坡即贴/下坡平滑）、
//       idle/run 权重状态机动画、受击横抖，并把主角真实世界 Y 写入 playerYRef 供相机/调试读。
// 依赖共享层：config（CHARACTER_URL/动画索引/出生点/脚底高度）、parkourConstants（尺寸/缩放/类型）、
//            runtime（occluderRef/playerYRef/地形射线单例）。

import React, { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { ACTOR_SCALE, TERRAIN_SIZE, type Vec2 } from '../parkourConstants';
import { CHARACTER_URL, IDLE_CLIP_INDEX, RUN_CLIP_INDEX, CHAR_FOOT_Y, PLAYER_START } from './config';
import { occluderRef, playerYRef, _terrainCaster, _terrainDown, _terrainOrigin } from './runtime';

export function Character({ velocityRef, playerPosRef, hitEffect, debugYRef }: {
  velocityRef: React.RefObject<Vec2>;
  playerPosRef: React.RefObject<Vec2>;
  hitEffect: string | null;
  debugYRef?: React.RefObject<number | null>;
}) {
  const { scene, animations } = useGLTF(CHARACTER_URL);
  const groupRef = useRef<THREE.Group>(null!);
  const headingRef = useRef(Math.PI);
  const wasMoving = useRef(false);
  const FADE = 0.25;
  const terrainYRef    = useRef(CHAR_FOOT_Y);
  const terrainTargetY = useRef(CHAR_FOOT_Y);
  const terrainSnapped = useRef(false);
  const terrainFrame   = useRef(0);

  const footOffset = useMemo(() => {
    if (!scene) return 0;
    const box = new THREE.Box3().setFromObject(scene);
    return isFinite(box.min.y) ? -box.min.y : 0;
  }, [scene]);

  useEffect(() => {
    scene.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  }, [scene]);

  // ── 手搓 AnimationMixer，直接绑到 scene（619 发布包验证过的方式）─────────────
  // 不用 drei useAnimations：它把 mixer 绑在 groupRef、用 lazy getter + 自己的 useFrame，
  // 首帧绑定时序不可控，导致"出生即 T-pose、移动后才正常"。直接绑 scene 最稳。
  // 策略：idle + run 两个 action 都常驻播放（play 一次），靠每帧 lerp 权重切换，
  // 不用 crossFadeTo（它和自愈/时序互相打架）。权重和恒为 1 → 永远有动画驱动骨骼。
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const idleActionRef = useRef<THREE.AnimationAction | null>(null);
  const runActionRef  = useRef<THREE.AnimationAction | null>(null);
  const runWeightRef = useRef(0); // 0=纯idle 1=纯run，每帧朝目标 lerp

  useEffect(() => {
    if (!scene || !animations.length) return;
    const idleIdx = IDLE_CLIP_INDEX;
    const mixer = new THREE.AnimationMixer(scene);
    mixerRef.current = mixer;
    const idleClip = animations[idleIdx] ?? animations[0];
    const runClip  = animations[RUN_CLIP_INDEX] ?? animations[0];
    const idle = idleClip ? mixer.clipAction(idleClip) : null;
    const run  = runClip  ? mixer.clipAction(runClip)  : null;
    idleActionRef.current = idle;
    runActionRef.current  = run;
    // 两个 action 都常驻播放，初始 idle 权重 1、run 权重 0
    if (idle) {
      idle.setLoop(THREE.LoopRepeat, Infinity);
      idle.reset();
      idle.time = (idleClip.duration ?? 2) * 0.5;
      idle.enabled = true;
      idle.setEffectiveWeight(1);
      idle.play();
    }
    if (run) {
      run.setLoop(THREE.LoopRepeat, Infinity);
      run.reset();
      run.enabled = true;
      run.setEffectiveWeight(0);
      run.play();
    }
    runWeightRef.current = 0;
    wasMoving.current = false;
    return () => {
      mixer.stopAllAction();
      mixer.uncacheRoot(scene);
      mixerRef.current = null;
      idleActionRef.current = null;
      runActionRef.current = null;
    };
  }, [scene, animations]);

  useFrame((_s, d) => {
    if (!groupRef.current) return;
    const vel = velocityRef.current;
    const pos = playerPosRef.current;

    // 积分位移
    pos.x += vel.x * d;
    pos.z += vel.z * d;
    // 限制在地图内（简单 clamp，留 4 单位边距）
    const lim = TERRAIN_SIZE / 2 - 4;
    pos.x = THREE.MathUtils.clamp(pos.x, -lim, lim);
    pos.z = THREE.MathUtils.clamp(pos.z, -lim, lim);
    groupRef.current.position.x = pos.x;
    groupRef.current.position.z = pos.z;

    // 地形跟随：每帧射一次线找脚下真实地面（不再隔 3 帧——隔帧 + lerp 滞后是穿模主因）。
    terrainFrame.current++;
    {
      const terrain = occluderRef.current;
      if (terrain) {
        _terrainOrigin.set(pos.x, terrainYRef.current + 30, pos.z);
        _terrainCaster.set(_terrainOrigin, _terrainDown);
        _terrainCaster.far = 60;
        const hits = _terrainCaster.intersectObject(terrain, true);
        if (hits.length > 0) {
          // ── 高度扫射判定 ──────────────────────────────────────────────────
          // 树永远长在地面之上：向下射线在同一 XZ 会命中 树冠>树干侧面>地面。
          // 取「最低的实心(非水)命中 = 地面」，树/树冠/树干在数学上必在其之上，永不被选中。
          // → 彻底摆脱"靠材质名认树"的脆弱方案，新地形加任何树/山都不会再被爬。
          let lowestSolidY: number | null = null; // 最低实心命中 = 地面
          let waterY: number | null = null;        // 水面命中（单独处理脚踝入水）
          for (const hit of hits) {
            let isWater = false;
            let obj: THREE.Object3D | null = hit.object;
            while (obj) {
              if (obj.name && /water|sea/i.test(obj.name)) { isWater = true; break; }
              obj = obj.parent;
            }
            if (isWater) {
              if (waterY === null || hit.point.y < waterY) waterY = hit.point.y;
            } else {
              if (lowestSolidY === null || hit.point.y < lowestSolidY) lowestSolidY = hit.point.y;
            }
          }
          const groundHitY = lowestSolidY;
          const waterHitY = waterY;
          const wet = waterHitY !== null && groundHitY !== null && groundHitY < waterHitY;
          // wet: 脚踝入水 0.3 单位，但不低于河底；陆地: 贴最低实心地面
          const targetHitY = wet
            ? Math.max(groundHitY!, waterHitY! - 0.3)
            : (groundHitY ?? hits[hits.length - 1].point.y);
          terrainTargetY.current = targetHitY;
          if (!terrainSnapped.current) {
            terrainYRef.current = targetHitY;
            terrainSnapped.current = true;
          }
        }
      }
    }
    // ── 防穿模 ground-snap：上坡立即贴合，下坡平滑下落 ────────────────────────
    // 地面升高（上坡/上台阶）→ 立即把 Y 顶到地面，脚绝不陷进上升的地形（根除上坡穿模）。
    // 地面降低（下坡/下台阶/落水）→ 平滑下落，避免从高处瞬移闪现。
    if (terrainSnapped.current) {
      const target = terrainTargetY.current;
      if (target >= terrainYRef.current) {
        terrainYRef.current = target;                                           // 上升：立即贴合
      } else {
        terrainYRef.current = THREE.MathUtils.lerp(terrainYRef.current, target, Math.min(1, d * 12)); // 下降：平滑
      }
    }
    // 调试 Y 覆盖：debugYRef 非空时直接用它（地形跟随被旁路，方便手动调高度）
    const dbgY = debugYRef?.current;
    groupRef.current.position.y = (dbgY != null) ? dbgY : terrainYRef.current;
    playerYRef.current = groupRef.current.position.y;

    const speed = Math.hypot(vel.x, vel.z);
    const moving = speed > 0.01;

    // 朝向：移动时面朝移动方向（简单翻转，无平滑插值）；静止保持上一朝向
    if (moving) {
      headingRef.current = Math.atan2(vel.x, vel.z);
    }
    groupRef.current.rotation.y = headingRef.current;

    // 受击横抖（眩晕惩罚是第2梯队的事，这里先保留视觉反馈）
    if (hitEffect === 'rock') {
      groupRef.current.position.x += Math.sin(Date.now() * 0.05) * 0.15;
    }

    // ── 动画切换：纯权重状态机（不用 crossFadeTo，避免时序打架）──────────────────
    // run 权重朝目标(移动=1/静止=0)每帧 lerp；idle 权重 = 1 - run 权重。
    // 两个 action 常驻播放，权重和恒为 1 → 永远有动画驱动骨骼，绝不 T-pose。
    const run = runActionRef.current;
    const idle = idleActionRef.current;
    if (run && idle) {
      const target = moving ? 1 : 0;
      runWeightRef.current = THREE.MathUtils.lerp(runWeightRef.current, target, Math.min(1, d / FADE));
      const rw = runWeightRef.current;
      run.enabled = true;
      idle.enabled = true;
      run.setEffectiveWeight(rw);
      idle.setEffectiveWeight(1 - rw);
      if (!run.isRunning()) run.play();
      if (!idle.isRunning()) idle.play();
      wasMoving.current = moving;
    }
    mixerRef.current?.update(d);
  });

  return (
    <group ref={groupRef} position={[PLAYER_START.x, CHAR_FOOT_Y, PLAYER_START.z]} scale={ACTOR_SCALE}>
      {/* 内层 group 把脚底顶到 y=0（落地补偿）。scene 必须挂在 groupRef 子树内，
          useAnimations 的 mixer 才能按骨骼名绑定到它。外层 groupRef 的 Y 由地形跟随每帧更新 */}
      <group position={[0, footOffset, 0]}>
        <primitive object={scene} />
      </group>
    </group>
  );
}
