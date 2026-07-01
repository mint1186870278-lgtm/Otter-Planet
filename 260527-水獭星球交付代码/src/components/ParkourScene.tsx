import React, { useRef, useMemo, useEffect, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
// 非组件的常量/类型/工具已抽到 parkourConstants.ts —— 让本文件只导出组件，保住 Fast Refresh 边界。
import {
  ACTOR_SCALE, SHOW_COORDS, STAR_POSITIONS, CREEK_STAR_POSITIONS,
  creekStarsAsCollectibles, PK, TERRAIN_SIZE,
  NPC_URLS, NPC_SCALES, NPC_ROTATIONS, NPC_POSITIONS,
  type Vec2, type NpcPos, type DebugInfo, type WorldPrompt, type SkyPhase,
  type StaticCollectible, type CreekStarPos,
} from './parkourConstants';
// 共享运行时（模块级可变 ref / 单例射线 / 地面吸附）与 3D 小部件、障碍子系统均已拆分。
import {
  occluderRef, playerYRef, snapGroundY,
  _terrainCaster, _terrainDown, _terrainOrigin,
} from './parkour/runtime';
import { StarsGroup } from './parkour/Stars';
import { ObstacleField, type ActiveObstacle } from './parkour/Obstacles';
// 视觉/画质 + 布局配置常量已抽到 parkour/config.ts。
import {
  LIGHTING, SKY, DEBUG_MODE,
  CHARACTER_URL, IDLE_CLIP_INDEX, RUN_CLIP_INDEX, CHAR_FOOT_Y, PLAYER_START,
  FAKE_MOON_URL, REAL_MOON_URL, TERRAIN_URL,
  TREE_ROUND_URL, BUSH_URL, FLOWER_DAISY_URL, FLOWER_YELLOW_URL, PLANT_GREEN_URL,
} from './parkour/config';
// 环境静态子系统（TerrainModel / Cloud+CLOUD_DATA / 树林花草散布）已移到 parkour/Scenery.tsx。
import { TerrainModel, Cloud, CLOUD_DATA } from './parkour/Scenery';
import { NpcGroup } from './parkour/Npc';
import { Character } from './parkour/Character';

// character 主角子系统（Character）已移到 parkour/Character.tsx。

// ── stars — 钥匙，钉死世界坐标 {x,z}，2D 平面距离收集 ─────────────────────────
// StaticCollectible 类型 + STAR_POSITIONS 星位数据已移到 parkourConstants.ts（想调星星位置去那里改）。

// 共享 3D 小部件（StarMesh / FloatingLabel / TextSprite / QuestionBoxBadge /
// TeachingPointer / StarGuideMarker / makePointerCanvas）已移到 parkour/widgets.tsx。

// stars 子系统（StarObject / StarsGroup）已移到 parkour/Stars.tsx。

// obstacles 子系统（ActiveObstacle / OB_* / RocksModel / BarrelModel / CrateModel /
//   ObstacleObject / ObstacleField）已移到 parkour/Obstacles.tsx。

// ── NPCs — 钉死世界坐标，走近半径触发（带迟滞，离开后可再触发）────────────────
// NPC_URLS / NPC_SCALES / NPC_ROTATIONS / NPC_POSITIONS（模型/缩放/朝向/坐标）已移到 parkourConstants.ts。

// 树林/地面花草散布（TREE_SCATTER / GroundDetail / GLBFlowers / TreeScatter）已移到 parkour/Scenery.tsx。

// NPC 子系统（NpcModel / NpcSlot / NpcGroup）已移到 parkour/Npc.tsx。


// ── debug tracker — 报玩家坐标 + 到各 NPC 距离 ───────────────────────────────
function DebugTracker({ playerPosRef, onDebugUpdate, npcPositions }: {
  playerPosRef: React.RefObject<Vec2>;
  onDebugUpdate: (info: DebugInfo) => void;
  npcPositions?: NpcPos[];
}) {
  useFrame(() => {
    const p = playerPosRef.current;
    const pts = npcPositions ?? NPC_POSITIONS;
    const dist = pts.map(n => Math.hypot(p.x - n.x, p.z - n.z)) as [number, number, number];
    onDebugUpdate({ player: { x: p.x, z: p.z }, playerY: playerYRef.current, npcDist: dist });
  });
  return null;
}

// ── camera — 后方固定机位跟随 + 前瞻（看向移动方向）+ 树木遮挡自动拉近 ──────────
// 「前瞻跟随」：机位始终在主角正后方（不旋转坐标系 → 方向键含义恒定，孩子不会按晕），
// 但「看向哪里」会朝移动方向前移：拐弯时镜头提前偏向前进方向、把前方的路露出来，消盲区。
// 俯角≈7°（近乎平视，不俯视）：高度 2.6 仍高于熊头(≈1.7)，能越过近处草木防糊脸；
// 视线抬到 1.6 让俯角变小回到平视——「平视」靠抬高视线实现，不是靠把相机压到贴地。
const CAM_OFFSET = new THREE.Vector3(0, 2.6, 8.5).multiplyScalar(ACTOR_SCALE);
const LOOK_Y = 1.6 * ACTOR_SCALE;             // 视线落点高度（抬到主角头部 → 俯角小、近平视）
const CAM_MIN_DIST = 1.6 * ACTOR_SCALE;       // 遮挡拉近时相机离主角的最近距离（再近会怼进身体）
const CAM_OCCLUDE_MARGIN = 0.4 * ACTOR_SCALE; // 停在遮挡物前一点点，避免相机贴面穿模
// 终点演出运镜：拉远 + 抬高，并把视线抬向升起的月亮，否则月亮升上去会飞出画面顶。
const CAM_OFFSET_CINEMATIC = new THREE.Vector3(0, 13, 30);
const LOOK_Y_CINEMATIC = 16;      // 视线抬高的目标 y（朝月亮）
const LOOK_AHEAD_CINEMATIC = 28;  // 视线前移（-z）量，对准前方升起的月亮

function CameraRig({ playerPosRef, camYawRef, cinematic = false }: {
  playerPosRef: React.RefObject<Vec2>;
  camYawRef: React.RefObject<number>;
  cinematic?: boolean;
}) {
  const { camera } = useThree();
  const cur = useRef(new THREE.Vector3(PLAYER_START.x + CAM_OFFSET.x, CAM_OFFSET.y, PLAYER_START.z + CAM_OFFSET.z));
  const curLook = useRef(new THREE.Vector3(PLAYER_START.x, LOOK_Y, PLAYER_START.z));
  // 复用对象，避免每帧 new（射线检测每帧都跑）
  const ray = useRef(new THREE.Raycaster());
  const vOrigin = useRef(new THREE.Vector3());
  const vDesired = useRef(new THREE.Vector3());
  const vDir = useRef(new THREE.Vector3());
  const vGoal = useRef(new THREE.Vector3());
  const vLook = useRef(new THREE.Vector3());

  useFrame((_s, d) => {
    const p = playerPosRef.current;
    const off = cinematic ? CAM_OFFSET_CINEMATIC : CAM_OFFSET;

    // 1) 理想机位：固定偏移绕 Y 轴按 camYaw 旋转（Y 跟随地形高度，不硬编码到世界 Y=0）
    const py = playerYRef.current;
    if (cinematic) {
      // 演出模式：忽略玩家视角，相机固定在玩家正后方
      vDesired.current.set(p.x + off.x, py + off.y, p.z + off.z);
    } else {
      const yaw = camYawRef.current;
      const cosY = Math.cos(yaw), sinY = Math.sin(yaw);
      vDesired.current.set(
        p.x + cosY * off.x - sinY * off.z,
        py + off.y,
        p.z + sinY * off.x + cosY * off.z,
      );
    }
    vOrigin.current.set(p.x, py + LOOK_Y, p.z);

    // 2) 遮挡处理（仅日常跟随）
    vGoal.current.copy(vDesired.current);
    const occ = occluderRef.current;
    if (!cinematic && occ) {
      vDir.current.copy(vDesired.current).sub(vOrigin.current);
      const fullDist = vDir.current.length();
      if (fullDist > 1e-3) {
        vDir.current.multiplyScalar(1 / fullDist);
        ray.current.set(vOrigin.current, vDir.current);
        ray.current.far = fullDist;
        const hits = ray.current.intersectObject(occ, true);
        if (hits.length) {
          const dist = Math.max(CAM_MIN_DIST, hits[0].distance - CAM_OCCLUDE_MARGIN);
          vGoal.current.copy(vOrigin.current).addScaledVector(vDir.current, dist);
        }
      }
    }

    // 3) 平滑
    const curDist = cur.current.distanceTo(vOrigin.current);
    const goalDist = vGoal.current.distanceTo(vOrigin.current);
    const k = cinematic ? d * 2 : (goalDist < curDist ? d * 16 : d * 4);
    cur.current.lerp(vGoal.current, Math.min(1, k));
    camera.position.copy(cur.current);

    // 4) 视线目标：看主角（跟随 yaw），演出抬高看月亮
    if (cinematic) {
      vLook.current.set(p.x, LOOK_Y_CINEMATIC, p.z - LOOK_AHEAD_CINEMATIC);
    } else {
      vLook.current.set(p.x, py + LOOK_Y, p.z);
    }
    curLook.current.lerp(vLook.current, Math.min(1, d * (cinematic ? 2 : 6)));
    camera.lookAt(curLook.current);
  });
  return null;
}

// ── sky & lights — 按 SkyPhase lerp 过渡天穹渐变/雾/光照 + 月光 ────────────────
// 白天 → 黄昏 → 夜晚三档预设，切档时记录起止值，按各自时长 smoothstep 插值，不突变。
// 天穹是三色渐变（顶/中/地平线），由 GradientSky 的 shader uniform 承载，lerp 时逐色过渡。
type SkyPreset = {
  top: THREE.Color; mid: THREE.Color; horizon: THREE.Color; // 天穹三色渐变
  fog: THREE.Color;
  ambient: number; dir: number; moon: number; // 各光源强度
};
const SKY_PRESETS: Record<SkyPhase, SkyPreset> = {
  day:   { top: new THREE.Color(SKY.day.skyTop),   mid: new THREE.Color(SKY.day.skyMid),   horizon: new THREE.Color(SKY.day.skyHorizon),   fog: new THREE.Color(SKY.day.fogColor),   ambient: 1.5,  dir: LIGHTING.sun.intensityDay, moon: 0.0 },
  dusk:  { top: new THREE.Color(SKY.dusk.skyTop),  mid: new THREE.Color(SKY.dusk.skyMid),  horizon: new THREE.Color(SKY.dusk.skyHorizon),  fog: new THREE.Color(SKY.dusk.fogColor),  ambient: 0.8,  dir: 1.2,                       moon: 0.0 },
  night: { top: new THREE.Color(SKY.night.skyTop), mid: new THREE.Color(SKY.night.skyMid), horizon: new THREE.Color(SKY.night.skyHorizon), fog: new THREE.Color(SKY.night.fogColor), ambient: 0.35, dir: 0.2,                       moon: 1.6 },
};
// 切档过渡时长（秒）：到黄昏 2s、到夜晚 3s、其余默认 2s
function phaseDuration(to: SkyPhase): number {
  if (to === 'dusk') return 2;
  if (to === 'night') return 3;
  return 2;
}

// ── 远山背景层 — 低多边形山体环（InstancedMesh，1 draw call），蓝青色被雾化融进天空 ──
// 跟随相机 xz（玩家永远在环心，走不到边）；锥体山峰，底部沉到地平线下只露尖，per-instance 三档蓝青色。


// ── 渐变天穹 — 大球 BackSide，shader 三色平滑渐变（顶/中/地平线），无 banding ──────
// 跟随相机位置（永远包裹住玩家），不写深度、不参与雾、不投影；颜色由外部 lerp 更新 uniform。
// 渐变用两段 smoothstep（horizon→mid→top），柔和过渡；轻微抖动（dither）消除大面积色带。
const SKY_VERT = /* glsl */`
  varying vec3 vWorldDir;
  void main() {
    vWorldDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const SKY_FRAG = /* glsl */`
  varying vec3 vWorldDir;
  uniform vec3 uTop;
  uniform vec3 uMid;
  uniform vec3 uHorizon;
  void main() {
    // y: -1(底) → 0(地平线) → 1(顶)。只用上半球，下半球收敛到 horizon 色。
    float h = clamp(vWorldDir.y, 0.0, 1.0);
    // 地平线→中段（0~0.35），中段→顶（0.35~1），两段 smoothstep 拼接，过渡极平滑。
    vec3 lower = mix(uHorizon, uMid, smoothstep(0.0, 0.35, h));
    vec3 col   = mix(lower,    uTop, smoothstep(0.35, 1.0, h));
    // 轻微有序抖动，打散 8-bit 色带（premium 无 banding 的关键）
    float dither = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
    col += dither / 255.0;
    gl_FragColor = vec4(col, 1.0);
  }
`;

function GradientSky({ topRef, midRef, horizonRef }: {
  topRef: React.RefObject<THREE.Color>;
  midRef: React.RefObject<THREE.Color>;
  horizonRef: React.RefObject<THREE.Color>;
}) {
  const meshRef = useRef<THREE.Mesh>(null!);
  const mat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    uniforms: {
      uTop:     { value: topRef.current.clone() },
      uMid:     { value: midRef.current.clone() },
      uHorizon: { value: horizonRef.current.clone() },
    },
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  }), [topRef, midRef, horizonRef]);

  useFrame(({ camera }) => {
    // 天穹跟随相机，玩家永远在球心 → 天空无限远不会"走到边"
    if (meshRef.current) meshRef.current.position.copy(camera.position);
    (mat.uniforms.uTop.value as THREE.Color).copy(topRef.current);
    (mat.uniforms.uMid.value as THREE.Color).copy(midRef.current);
    (mat.uniforms.uHorizon.value as THREE.Color).copy(horizonRef.current);
  });

  // 半径 400：比雾远界(500)和相机视距都大，包住整个可视世界
  return (
    <mesh ref={meshRef} material={mat} renderOrder={-1} frustumCulled={false}>
      <sphereGeometry args={[400, 32, 16]} />
    </mesh>
  );
}

function SkyAndLights({ phase }: { phase: SkyPhase }) {
  const dirRef = useRef<THREE.DirectionalLight>(null!);
  const moonRef = useRef<THREE.DirectionalLight>(null!);
  const ambRef = useRef<THREE.HemisphereLight>(null!);
  const fogRef = useRef<THREE.Fog>(null!);

  // 过渡状态：从 from 预设插到 to 预设，t 在 [0, dur] 累加
  const fromP = useRef<SkyPreset>(SKY_PRESETS.day);
  const toP = useRef<SkyPreset>(SKY_PRESETS.day);
  const dur = useRef(0);
  const elapsed = useRef(0);
  // 当前显示值（避免每帧 new Color）。天穹三色 + 雾色，供 GradientSky uniform 读取。
  const curTop = useRef(SKY_PRESETS.day.top.clone());
  const curMid = useRef(SKY_PRESETS.day.mid.clone());
  const curHorizon = useRef(SKY_PRESETS.day.horizon.clone());
  const curFog = useRef(SKY_PRESETS.day.fog.clone());

  // phase 变化 → 以"当前显示值"为起点开新过渡
  useEffect(() => {
    fromP.current = {
      top: curTop.current.clone(), mid: curMid.current.clone(), horizon: curHorizon.current.clone(),
      fog: curFog.current.clone(),
      ambient: ambRef.current?.intensity ?? toP.current.ambient,
      dir: dirRef.current?.intensity ?? toP.current.dir,
      moon: moonRef.current?.intensity ?? toP.current.moon,
    };
    toP.current = SKY_PRESETS[phase];
    dur.current = phaseDuration(phase);
    elapsed.current = 0;
  }, [phase]);

  useFrame((_s, d) => {
    if (dur.current <= 0) return;
    elapsed.current = Math.min(dur.current, elapsed.current + d);
    const raw = dur.current > 0 ? elapsed.current / dur.current : 1;
    const t = raw * raw * (3 - 2 * raw); // smoothstep
    const f = fromP.current, to = toP.current;
    curTop.current.copy(f.top).lerp(to.top, t);
    curMid.current.copy(f.mid).lerp(to.mid, t);
    curHorizon.current.copy(f.horizon).lerp(to.horizon, t);
    curFog.current.copy(f.fog).lerp(to.fog, t);
    if (fogRef.current) fogRef.current.color.copy(curFog.current);
    if (ambRef.current) ambRef.current.intensity = THREE.MathUtils.lerp(f.ambient, to.ambient, t);
    if (dirRef.current) dirRef.current.intensity = THREE.MathUtils.lerp(f.dir, to.dir, t);
    if (moonRef.current) moonRef.current.intensity = THREE.MathUtils.lerp(f.moon, to.moon, t);
  });

  return (
    <>
      <GradientSky topRef={curTop} midRef={curMid} horizonRef={curHorizon} />
      {/* 指数雾：远处渐蓝渐淡，比线性雾衰减更自然，增加大气纵深感；雾色与地平线天色接近 → 远景融入天空 */}
      <fog ref={fogRef} attach="fog" args={[SKY.day.fogColor, SKY.day.fogNear, SKY.day.fogFar]} />
      {/* 半球光：天空冷蓝 + 地面暖绿，去掉灰色阴影，暗部带颜色 */}
      <hemisphereLight
        ref={ambRef}
        args={[LIGHTING.hemi.sky, LIGHTING.hemi.ground, LIGHTING.hemi.intensity]}
      />
      {/* 环境补光：软化整体暗部，保证儿童可读性 */}
      {/* 对侧冷补光：从阳光对侧斜打淡蓝光，软化暗部、补冷调天光，立体不脏。无投影省开销 */}
      <directionalLight position={LIGHTING.fill.position} intensity={LIGHTING.fill.intensity} color={LIGHTING.fill.color} />
      {/* 主阳光：暖金色，高角度斜射，长阴影增加立体感 */}
      <directionalLight
        ref={dirRef}
        position={LIGHTING.sun.position}
        intensity={SKY_PRESETS.day.dir}
        color={LIGHTING.sun.color}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-radius={8}
        shadow-bias={-0.0005}
        shadow-normalBias={0.02}
        shadow-camera-far={160}
        shadow-camera-left={-60}
        shadow-camera-right={60}
        shadow-camera-top={60}
        shadow-camera-bottom={-60}
      />
      {/* 月光：冷色淡蓝白，仅夜晚有强度 */}
      <directionalLight ref={moonRef} position={LIGHTING.moon.position} intensity={0} color={LIGHTING.moon.color} />
    </>
  );
}

// ── moons — 假月亮（过场）/ 真月亮（升起）────────────────────────────────────
// 假月亮：钉在世界点，轻浮动 + 自转；玩家走近 < REACH 触发 onReach（一次）。
function FakeMoon({ pos, playerPosRef, onReach }: {
  pos: Vec2; playerPosRef: React.RefObject<Vec2>; onReach: () => void;
}) {
  const { scene } = useGLTF(FAKE_MOON_URL);
  const cloned = useMemo(() => scene.clone(), [scene]);
  const ref = useRef<THREE.Group>(null!);
  const reached = useRef(false);
  const REACH = 2.5 * ACTOR_SCALE;
  const baseY = 2.2 * ACTOR_SCALE; // 离地高度（截图后可调）

  useFrame((st, d) => {
    if (!ref.current) return;
    ref.current.rotation.y += d * 0.6;
    ref.current.position.y = baseY + Math.sin(st.clock.elapsedTime * 1.2) * 0.25 * ACTOR_SCALE;
    if (reached.current) return;
    const p = playerPosRef.current;
    const dx = p.x - pos.x, dz = p.z - pos.z;
    if (dx * dx + dz * dz < REACH * REACH) {
      reached.current = true;
      onReach();
    }
  });

  return (
    <group ref={ref} position={[pos.x, baseY, pos.z]} scale={2.5 * ACTOR_SCALE}>
      <primitive object={cloned} />
    </group>
  );
}

// 真月亮：从地平线（y=START_Y）升到 END_Y，约 RISE_DUR 秒，发光；升起完成回调一次。
function RealMoon({ pos, onRisen }: { pos: Vec2; onRisen: () => void }) {
  const { scene } = useGLTF(REAL_MOON_URL);
  const cloned = useMemo(() => {
    const c = scene.clone();
    // 给所有材质加自发光，让月亮"亮"起来
    c.traverse(obj => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh && mesh.material) {
        const mat = (mesh.material as THREE.MeshStandardMaterial).clone();
        if ('emissive' in mat) {
          mat.emissive = new THREE.Color('#FFF7D6');
          mat.emissiveIntensity = 1.4;
        }
        mesh.material = mat;
      }
    });
    return c;
  }, [scene]);
  const ref = useRef<THREE.Group>(null!);
  const t = useRef(0);
  const risen = useRef(false);
  const START_Y = -8;
  const END_Y = 34;
  const RISE_DUR = 4;

  useFrame((_s, d) => {
    if (!ref.current) return;
    ref.current.rotation.y += d * 0.15;
    if (t.current < RISE_DUR) {
      t.current = Math.min(RISE_DUR, t.current + d);
      const raw = t.current / RISE_DUR;
      const e = raw * raw * (3 - 2 * raw); // smoothstep 缓起缓停
      ref.current.position.y = THREE.MathUtils.lerp(START_Y, END_Y, e);
      if (t.current >= RISE_DUR && !risen.current) {
        risen.current = true;
        onRisen();
      }
    }
  });

  return (
    <group ref={ref} position={[pos.x, START_Y, pos.z]} scale={5}>
      <primitive object={cloned} />
      {/* 光晕：月亮自带一个暖白点光源 */}
      <pointLight color="#FFF7D6" intensity={3} distance={120} decay={1.2} />
    </group>
  );
}

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
