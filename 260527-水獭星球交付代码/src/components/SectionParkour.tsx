import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useLang } from '../App';
import { motion, AnimatePresence, useInView } from 'motion/react';
import { ArrowLeft, ArrowRight, ArrowUp, ArrowDown, Mic } from 'lucide-react';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';
import ParkourScene from './ParkourScene';
import { ACTOR_SCALE, SHOW_COORDS, STAR_POSITIONS, CREEK_STAR_POSITIONS, type CreekStarPos, type Vec2, type DebugInfo, type StaticCollectible, type SkyPhase, type WorldPrompt } from './parkourConstants';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { useGallery } from '../lib/GalleryContext';
import { track } from '../lib/analytics';
import { FeedbackBurst, PromptChip, TapToContinueHint } from './InteractionHints';
import { findNearestUncollectedStar, hasReachedGuidedStar, shouldShowIdleStarHint } from '../lib/interactionHints';
import { DirectionTutorialOverlay } from './DirectionTutorialOverlay';
import { MouseViewHintBubble } from './MouseViewHintBubble';
import {
  CONTROL_TUTORIAL_DIRECTIONS,
  advanceControlTutorial,
  keyToTutorialDirection,
  shouldPulseControlTutorialHint,
  type TutorialDirection,
} from '../lib/controlTutorial';
import { createFishSpeechUrl, fishVoiceRoleFromNpcIndex } from '../lib/fishAudio';
// SectionParkour 的纯常量/类型/工具 + SceneErrorBoundary 已抽到 parkour/ 下两个文件。
import {
  RENDER_CONFIG, DIRECTION_TO_KEY, KEY_TO_MOVEMENT_KEY, TUTORIAL_STEP_MOVE_MS,
  STAR_GUIDE_REACH_RADIUS, NPC_PORTRAIT, computeVelocity,
  NPC_SYSTEM_PROMPTS, stripMarkers, sanitizeForDisplay, extractName, streamChat,
  type ChatMessage, type FeedbackItem,
} from './parkour/sectionParkourCore';
import { SceneErrorBoundary } from './parkour/SceneErrorBoundary';


export default function SectionParkour({ onComplete }: { onComplete?: () => void } = {}) {
  const { lang } = useLang();
  const { generateSlot } = useGallery(); // 探险相册：遇 NPC / 假月亮时并行生图
  // 场景就绪门控：chunk 下载完后 R3F Canvas + 3D 模型还在初始化，主容器只剩渐变蓝背景（蓝屏）。
  // 用 .otter-landing-wait 遮罩盖住这段空档，轮询到 canvas + 教学方向元素出现（或超时 20s）才撤遮罩。
  // 配合 public/otterlantis-loader.js：markSceneReady() 让加载进度条收尾。
  const [routeSceneReady, setRouteSceneReady] = useState(false);
  useEffect(() => {
    const startAt = Date.now();
    let timer: ReturnType<typeof setTimeout>;
    const poll = () => {
      const hasCanvas = !!document.querySelector('canvas');
      const hasTutorial = !!document.querySelector('[data-tutorial-direction]');
      if ((hasCanvas && hasTutorial) || Date.now() - startAt > 20000) {
        timer = setTimeout(() => {
          setRouteSceneReady(true);
          (window as { otterParkourLoading?: { markSceneReady?: () => void } }).otterParkourLoading?.markSceneReady?.();
        }, 300);
      } else {
        timer = setTimeout(poll, 120);
      }
    };
    poll();
    return () => clearTimeout(timer);
  }, []);
  const containerRef = useRef<HTMLDivElement>(null);
  const isInView = useInView(containerRef, { amount: 0.5 });
  const [gameState, setGameState] = useState<'tutorial' | 'starGuide' | 'playing'>('tutorial');
  const [moving, setMoving] = useState(false); // true after first key input
  // 玩家真实世界坐标 + 速度向量（开放世界八向移动）。用 ref 避免每帧 setState。
  const velocityRef = useRef<Vec2>({ x: 0, z: 0 });
  const playerPosRef = useRef<Vec2>({ x: -2.52, z: 111.68 });
  const camYawRef = useRef<number>(0);
  const dragRef = useRef<{ active: boolean; lastX: number }>({ active: false, lastX: 0 });
  // 视角拖拽闸门：任意弹窗/对话/过场打开时为 true，window 级拖拽监听只读它来决定是否转视角。
  // 用 ref 而非 state，是为了让挂在 window 上的 pointermove 闭包永远读到最新值、无需重绑监听。
  const isViewLockedRef = useRef(false);
  const CAM_DRAG_SENS = 0.005;
  const keysHeld = useRef<Set<string>>(new Set());
  const [showNudge, setShowNudge] = useState(false); // "往前走" prompt
  const nudgeShownRef = useRef(false);
  const nudgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 剧情钥匙：累计收集数，只增不减（掉星/撞障碍都不回退）。0–9，分三段每段 3 颗。
  const [totalCollected, setTotalCollected] = useState(0);
  const totalCollectedRef = useRef(0); // 与 totalCollected 同步，给 handleCollect 读最新值（避开 StrictMode 双调 updater）
  const [npcDialog, setNpcDialog] = useState<1 | 2 | 3 | null>(null);
  const npcDialogRef = useRef<1 | 2 | 3 | null>(null); // 给键盘闭包读最新值（冻结移动）
  // NPC 完成度：存已完整对话过的 NPC 索引（0/1/2）。供情况A/C 分流、假月亮过场、结局完整度系统使用。
  const [npcDone, setNpcDone] = useState<Set<number>>(new Set());
  void npcDone; // 当前仅写入（对话结束时标记）；读取由第2/3梯队（情况C分流、结局完整度）启用
  // NPC2 猜名字结果，由 AI 的 [NAME:xxx] 检测填入（handleSend 中写入）。供假月亮过场/结局使用。
  const [npc2Name, setNpc2Name] = useState<string | null>(null);
  void npc2Name; // 当前仅写入；读取由后续梯队（假月亮过场/结局）启用
  const [shakeBar, setShakeBar] = useState(false);
  const [glowBar, setGlowBar] = useState(false);
  const [justLitIndex, setJustLitIndex] = useState<number | null>(null); // 刚点亮的星序号(0-8)，弹一下后清空

  // ── 月亮过场 / 升起演出 ────────────────────────────────────────────────────
  const [skyPhase, setSkyPhase] = useState<SkyPhase>('day'); // 白天→黄昏（假月亮后）→夜晚（真月亮）
  const [fakeMoonPos, setFakeMoonPos] = useState<Vec2 | null>(null); // 假月亮世界坐标（NPC2 后刷出）
  const [realMoonPos, setRealMoonPos] = useState<Vec2 | null>(null); // 真月亮世界坐标（NPC3 后升起）
  const [fakeMoonDialog, setFakeMoonDialog] = useState<0 | 1 | 2>(0); // 0=无, 1=「这不是月亮嘛」, 2=「原来是石子」
  const [endingActive, setEndingActive] = useState(false); // 真月亮升起演出进行中（冻结+不可跳过）
  // 演出期间冻结玩家（假月亮对话 / 真月亮升起）。给键盘闭包读最新值。
  const cutsceneFreezeRef = useRef(false);

  const canvasRef = useRef<HTMLDivElement>(null);
  const [debugInfo, setDebugInfo] = useState<DebugInfo>({ player: { x: -7, z: 116 }, playerY: 0, npcDist: [0, 0, 0] });
  // 调试三轴：X/Z 直接写 playerPosRef（世界坐标），Y 写 debugYRef（非空时旁路地形跟随）。
  // debugY=null 表示"不覆盖 Y，跟随地形"；拖 Y slider 后变成手动高度。
  const debugYRef = useRef<number | null>(null);
  const [debugAxis, setDebugAxis] = useState<{ x: number; y: number | null; z: number }>({ x: -7.79, y: null, z: 111.53 });
  // 调试面板 Tab
  type DebugTab = 'player' | 'npc0' | 'npc1' | 'npc2' | 'land' | 'creek';
  const [debugTab, setDebugTab] = useState<DebugTab>('player');
  // NPC 调试 X/Z slider — 初始值来自 NPC_POSITIONS，直接传给 ParkourScene 联动3D场景
  const [npcDebugAxes, setNpcDebugAxes] = useState([
    { x: -0.30, y: -0.25, z: 107.00 },
    { x: -3.20, y: -0.15, z: 102.10 },
    { x: -2.80, y: -0.20, z:  95.90 },
  ]);
  // 水面星调试坐标
  const [debugCreekStars, setDebugCreekStars] = useState<CreekStarPos[]>(
    () => CREEK_STAR_POSITIONS.map(p => ({ ...p }))
  );
  // 陆地星调试坐标（初始值来自 STAR_POSITIONS，只含 x/z，Y 跟地形）
  const [debugLandStars, setDebugLandStars] = useState(
    () => STAR_POSITIONS.map(s => ({ id: s.id, x: s.x, z: s.z }))
  );
  const [collectedIds, setCollectedIds] = useState<Set<number>>(new Set());
  const [hitEffect, setHitEffect] = useState<'star' | 'question' | 'rock' | null>(null);
  const [worldPrompt, setWorldPrompt] = useState<WorldPrompt>(null);
  const [feedback, setFeedback] = useState<FeedbackItem | null>(null);
  const feedbackSeq = useRef(0);
  const [focusStarId, setFocusStarId] = useState<number | null>(0);
  const [guidedStarId, setGuidedStarId] = useState<number | null>(null);
  const guidedStarTargetRef = useRef<Vec2 | null>(null);
  const [obstacleBurstId, setObstacleBurstId] = useState<number | null>(null);
  const [idleStarHint, setIdleStarHint] = useState(false);
  const lastMoveAtRef = useRef(Date.now());
  const lastIdleHintAtRef = useRef(0);
  const [isControlTutorialActive, setIsControlTutorialActive] = useState(false);
  const [controlTutorialComplete, setControlTutorialComplete] = useState(false);
  const [showMouseHint, setShowMouseHint] = useState(false); // 键盘教学完成后弹"鼠标转视角"气泡，~6s 或拖过视角后收起
  const hasDraggedViewRef = useRef(false); // 玩家是否真的拖动过视角（学会了就不再唠叨）
  const mouseHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [currentDirectionIndex, setCurrentDirectionIndex] = useState(0);
  const currentDirectionIndexRef = useRef(0);
  const [tutorialFlashDirection, setTutorialFlashDirection] = useState<TutorialDirection | null>(null);
  const [tutorialPulseId, setTutorialPulseId] = useState(0);
  const [tutorialSuccessId, setTutorialSuccessId] = useState(0);
  const lastCorrectInputTime = useRef(Date.now());
  const lastTutorialPulseAtRef = useRef(0);
  const tutorialStepMovingRef = useRef(false);
  const tutorialReleaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const [npcBubble, setNpcBubble] = useState<{ npcIndex: number; text: string } | null>(null);
  const [showGoHint, setShowGoHint] = useState(false);
  // 集齐一段（3/6/9 颗）弹窗：值为里程碑数（3/6/9），null 则不显示。带 NPC 外观线索，点"出发"关闭。
  const [milestonePopup, setMilestonePopup] = useState<number | null>(null);

  useEffect(() => {
    npcDialogRef.current = npcDialog;
  }, [npcDialog]);

  useEffect(() => {
    currentDirectionIndexRef.current = currentDirectionIndex;
  }, [currentDirectionIndex]);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    // ── 视角拖拽：与弹窗彻底解耦的实现 ───────────────────────────────────────
    // 关键决策：绝不使用 setPointerCapture。指针捕获会在“按住拖动时弹窗弹出”后残留，
    // 把弹窗按钮的 pointerup 偷给 canvas（W3C 规范：捕获优先级高于 pointer-events），
    // 导致按钮点不动 + 关窗后视角被污染。改为：pointerdown 只在 canvas 上记录起点，
    // pointermove / pointerup 挂在 window 上；能否拖动只取决于一个布尔闸门 isViewLockedRef。
    // 这样视角拖拽与任何弹窗在事件层面零���合——弹窗不碰 canvas，canvas 不碰弹窗。
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      if (isViewLockedRef.current) return; // 闸门：有弹窗/对话/过场时不启动拖拽
      dragRef.current = { active: true, lastX: e.clientX };
    };
    const onMove = (e: PointerEvent) => {
      if (!dragRef.current.active) return;
      if (isViewLockedRef.current) { dragRef.current.active = false; return; } // 拖到一半弹窗弹出 → 立即停
      const dx = e.clientX - dragRef.current.lastX;
      dragRef.current.lastX = e.clientX;
      camYawRef.current -= dx * CAM_DRAG_SENS;
      // 玩家真的拖动过视角（学会了）→ 提前收起鼠标提示气泡，只触发一次
      if (dx !== 0 && !hasDraggedViewRef.current) {
        hasDraggedViewRef.current = true;
        setShowMouseHint(false);
      }
      velocityRef.current = computeVelocity(
        keysHeld.current,
        camYawRef.current,
        isViewLockedRef.current,
      );
    };
    const onUp = () => {
      dragRef.current.active = false;
    };
    el.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, []);

  // 停止移动（对话/里程碑时冻结玩家）
  const stopMovement = () => {
    keysHeld.current.clear();
    velocityRef.current = { x: 0, z: 0 };
    setMoving(false);
  };

  // 弹窗弹出瞬间停掉正在进行的视角拖拽，并立即上锁闸门。新架构无 setPointerCapture，
  // 故只需复位拖拽态 + 置位 isViewLockedRef（覆盖里程碑“收集瞬间→弹窗出现”之间的 350ms：
  // 那段 cutsceneFreezeRef 已 true 但 anyPopupOpen 同步 effect 还没把弹窗算进来）。
  const cancelCanvasDrag = () => {
    dragRef.current.active = false;
    isViewLockedRef.current = true;
  };

  const updateVelocity = useCallback(() => {
    velocityRef.current = computeVelocity(
      keysHeld.current,
      camYawRef.current,
      npcDialogRef.current !== null || cutsceneFreezeRef.current,
    );
  }, []);

  const pressMovementKey = useCallback((key: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown') => {
    keysHeld.current.add(key);
    lastMoveAtRef.current = Date.now();
    if (!moving) {
      setMoving(true);
      setShowNudge(false);
      setIdleStarHint(false);
      setWorldPrompt(null);
      if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current);
    }
    updateVelocity();
  }, [moving, updateVelocity]);

  const releaseMovementKey = useCallback((key: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown') => {
    keysHeld.current.delete(key);
    updateVelocity();
    if (keysHeld.current.size === 0) setMoving(false);
  }, [updateVelocity]);

  const releaseAllMovementKeys = useCallback(() => {
    keysHeld.current.clear();
    updateVelocity();
    setMoving(false);
  }, [updateVelocity]);

  const onControlTutorialComplete = useCallback(() => {
    // 阶段 B 可在这里接入“引导去收集第一颗星星”。
  }, []);

  const startFirstStarGuide = useCallback(() => {
    setGameState('playing');
    canvasRef.current?.focus();
  }, []);

  const handleTutorialDirection = useCallback((direction: TutorialDirection) => {
    if (!isControlTutorialActive || tutorialStepMovingRef.current) return;
    const now = Date.now();
    const result = advanceControlTutorial({
      currentDirectionIndex: currentDirectionIndexRef.current,
      inputDirection: direction,
      now,
    });
    if (!result.wasCorrect) return;

    const movementKey = DIRECTION_TO_KEY[direction];
    tutorialStepMovingRef.current = true;
    lastCorrectInputTime.current = result.lastCorrectInputTime;
    setTutorialFlashDirection(direction);
    setTutorialSuccessId(id => id + 1);
    setShowNudge(false);
    setIdleStarHint(false);
    setWorldPrompt(null);
    pressMovementKey(movementKey);

    if (tutorialReleaseTimerRef.current) clearTimeout(tutorialReleaseTimerRef.current);
    tutorialReleaseTimerRef.current = setTimeout(() => {
      releaseMovementKey(movementKey);
      tutorialStepMovingRef.current = false;
      setTutorialFlashDirection(null);
      currentDirectionIndexRef.current = result.currentDirectionIndex;
      setCurrentDirectionIndex(result.currentDirectionIndex);
      if (result.isComplete) {
        setIsControlTutorialActive(false);
        setControlTutorialComplete(true);
        releaseAllMovementKeys();
        onControlTutorialComplete();
        startFirstStarGuide();
        canvasRef.current?.focus();
        // 键盘教学全部完成 → 引导重点切到鼠标视角：弹气泡，~6s 后自动收起
        setShowMouseHint(true);
        if (mouseHintTimerRef.current) clearTimeout(mouseHintTimerRef.current);
        mouseHintTimerRef.current = setTimeout(() => setShowMouseHint(false), 6000);
      }
    }, TUTORIAL_STEP_MOVE_MS);
  }, [isControlTutorialActive, onControlTutorialComplete, pressMovementKey, releaseAllMovementKeys, releaseMovementKey, startFirstStarGuide]);

  const playCue = useCallback((kind: 'collect' | 'box' | 'continue') => {
    // 占位音效：用 WebAudio 生成很短的柔和提示音；浏览器限制时静默失败。
    try {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) return;
      const ctx = audioCtxRef.current ?? new Ctx();
      audioCtxRef.current = ctx;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = kind === 'box' ? 'triangle' : 'sine';
      osc.frequency.value = kind === 'collect' ? 880 : kind === 'continue' ? 660 : 260;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.07, ctx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + (kind === 'box' ? 0.16 : 0.12));
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.18);
    } catch {
      // 音频不可用不影响教学提示。
    }
  }, []);

  const showFeedback = useCallback((kind: FeedbackItem['kind'], text: string) => {
    const id = feedbackSeq.current++;
    setFeedback({ id, kind, text });
    window.setTimeout(() => setFeedback(current => current?.id === id ? null : current), 900);
  }, []);

  // （已移除 321 倒计时：键盘教学 / 引导星完成后直接进入 playing。）

  useEffect(() => {
    if (!isInView || gameState !== 'tutorial' || controlTutorialComplete || isControlTutorialActive) return;
    const now = Date.now();
    currentDirectionIndexRef.current = 0;
    setCurrentDirectionIndex(0);
    setIsControlTutorialActive(true);
    setShowNudge(false);
    setIdleStarHint(false);
    setWorldPrompt(null);
    lastCorrectInputTime.current = now;
    lastTutorialPulseAtRef.current = now;
    canvasRef.current?.focus();
  }, [controlTutorialComplete, gameState, isControlTutorialActive, isInView]);

  useEffect(() => {
    if (!isControlTutorialActive) return;
    const timer = setInterval(() => {
      const now = Date.now();
      if (shouldPulseControlTutorialHint({
        now,
        lastCorrectInputTime: lastCorrectInputTime.current,
        lastPulseAt: lastTutorialPulseAtRef.current,
      })) {
        lastTutorialPulseAtRef.current = now;
        setTutorialPulseId(id => id + 1);
      }
    }, 300);
    return () => clearInterval(timer);
  }, [isControlTutorialActive]);

  useEffect(() => () => {
    if (tutorialReleaseTimerRef.current) clearTimeout(tutorialReleaseTimerRef.current);
  }, []);

  useEffect(() => {
    if (gameState !== 'starGuide') return;
    const timer = setInterval(() => {
      if (hasReachedGuidedStar(playerPosRef.current, guidedStarTargetRef.current, STAR_GUIDE_REACH_RADIUS)) {
        releaseAllMovementKeys();
        setGuidedStarId(null);
        setFocusStarId(0);
        guidedStarTargetRef.current = null;
        setGameState('playing'); // 走到引导星即开玩（已去掉 321 倒计时）
      }
    }, 150);
    return () => clearInterval(timer);
  }, [gameState, releaseAllMovementKeys]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (gameState !== 'tutorial' && gameState !== 'starGuide' && gameState !== 'playing') return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return; // 输入框打字放行
      if (npcDialog !== null || cutsceneFreezeRef.current) { if (e.key.startsWith('Arrow')) e.preventDefault(); return; } // 对话/过场冻结
      const movementKey = KEY_TO_MOVEMENT_KEY[e.key];
      if (!movementKey) return;
      e.preventDefault();

      const tutorialDirection = keyToTutorialDirection(e.key);
      if (isControlTutorialActive) {
        if (tutorialDirection) handleTutorialDirection(tutorialDirection);
        return;
      }

      pressMovementKey(movementKey);
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const movementKey = KEY_TO_MOVEMENT_KEY[e.key];
      if (!movementKey || isControlTutorialActive) return;
      releaseMovementKey(movementKey);
    };

    window.addEventListener('keydown', handleKeyDown, { passive: false });
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [gameState, handleTutorialDirection, isControlTutorialActive, npcDialog, pressMovementKey, releaseMovementKey]);

  // 静止 5 秒后，温和提示最近的未收集任务星；至少间隔 5 秒，避免刷屏。
  useEffect(() => {
    if (gameState !== 'playing' || isControlTutorialActive) return;
    const timer = setInterval(() => {
      if (npcDialog !== null || fakeMoonDialog !== 0 || endingActive || milestonePopup !== null) return;
      const target = findNearestUncollectedStar(playerPosRef.current, STAR_POSITIONS, collectedIds);
      const now = Date.now();
      if (shouldShowIdleStarHint({
        now,
        lastMoveAt: lastMoveAtRef.current,
        lastHintAt: lastIdleHintAtRef.current,
        hasTargetStar: target !== null,
      })) {
        lastIdleHintAtRef.current = now;
        setFocusStarId(target?.id ?? null);
        setShowNudge(false);
        setIdleStarHint(true);
        const focusedId = target?.id ?? null;
        setTimeout(() => {
          setIdleStarHint(false);
          setFocusStarId(current => current === focusedId && focusedId !== 0 ? null : current);
        }, 2600);
      }
    }, 500);
    return () => clearInterval(timer);
  }, [gameState, isControlTutorialActive, npcDialog, fakeMoonDialog, endingActive, milestonePopup, collectedIds]);

  // Start nudge timer when game begins
  useEffect(() => {
    if (gameState !== 'playing' || nudgeShownRef.current || isControlTutorialActive) return;
    nudgeTimerRef.current = setTimeout(() => {
      if (!nudgeShownRef.current) setShowNudge(true);
    }, 5000);
    return () => { if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current); };
  }, [gameState, isControlTutorialActive]);

  // Sync nudgeShownRef so the nudge timer effect can read it without stale closure
  useEffect(() => {
    if (moving) nudgeShownRef.current = true;
  }, [moving]);

  const TOTAL_STARS = 9;
  const MILESTONES = [3, 6, 9];

  // 是否有任意“带按钮的全屏弹窗”正打开（里程碑出发 / 假月亮对话 / NPC对话）。
  // 这是“物理隔离”架构的开关：为真时游戏层 pointer-events:none 失聪，弹窗独占鼠标。
  const anyPopupOpen = milestonePopup !== null || fakeMoonDialog !== 0 || npcDialog !== null;

  // 把“视角应被锁定”的状态同步进闸门 ref，供 window 级拖拽监听实时读取。
  // 覆盖：三种弹窗 + 终点演出。里程碑收集瞬间(弹窗前 350ms)的冻结由 cancelCanvasDrag 直接置位兜住。
  useEffect(() => {
    isViewLockedRef.current = anyPopupOpen || endingActive;
  }, [anyPopupOpen, endingActive]);

  const triggerMilestone = (count: number) => {
    setShakeBar(true);
    setGlowBar(true);
    stopMovement();
    setTimeout(() => setShakeBar(false), 350);
    setTimeout(() => setGlowBar(false), 700);
    // 集齐一段：弹中央卡片（含对应 NPC 外观线索），冻结玩家直到点"出发"
    cutsceneFreezeRef.current = true;
    setMilestonePopup(count);
  };

  // 关闭里程碑弹窗 → 解冻、回到游戏，焦点还给 canvas
  const closeMilestone = () => {
    setMilestonePopup(null);
    cutsceneFreezeRef.current = false;
    canvasRef.current?.focus();
  };

  const NPC_REQUIRED = [3, 6, 9];

  const handleNpcApproach = useCallback((index: number) => {
    if (isControlTutorialActive || gameState !== 'playing') return;
    const required = NPC_REQUIRED[index];
    if (totalCollected >= required) {
      setShowGoHint(false);
      setNpcDialog((index + 1) as 1 | 2 | 3);
      cancelCanvasDrag();
      stopMovement();
    } else {
      const need = required - totalCollected;
      const bubbles = {
        zh: [
          `哎，还差${need}颗星星呢！加油～集齐${required}颗就能知道线索啦！`,
          `kiwi！还没集齐呢！再找${need}颗！`,
          `观察记录：你还需要${need}颗星星！加油！`,
        ],
        en: [
          `Hey, you still need ${need} more stars! Get ${required} to hear my clue!`,
          `Kiwi! Not enough yet! Find ${need} more!`,
          `According to my records… you need ${need} more stars! Go go go!`,
        ],
      }[lang];
      setNpcBubble({ npcIndex: index, text: bubbles[index] });
      setTimeout(() => setNpcBubble(null), 3000);
    }
  }, [isControlTutorialActive, gameState, totalCollected, lang, cancelCanvasDrag, stopMovement]);

  const handleCollect = (id: number, type: StaticCollectible['type']) => {
    setCollectedIds(prev => new Set([...prev, id]));
    setHitEffect(type);
    setWorldPrompt(null);
    setFocusStarId(null);
    setIdleStarHint(false);
    lastMoveAtRef.current = Date.now();
    playCue('collect');
    showFeedback('star', '+1');
    setTimeout(() => setHitEffect(null), 400);
    // ⚠️ 用 ref 累计、纯函数 setState，绝不在 updater 里放副作用——
    // React StrictMode 会双调用 updater，导致 triggerMilestone/点亮动画被触发两次。
    const next = Math.min(TOTAL_STARS, totalCollectedRef.current + 1);
    if (next === totalCollectedRef.current) return; // 已满，忽略
    totalCollectedRef.current = next;
    setTotalCollected(next);
    setJustLitIndex(next - 1); // 第 next 颗(序号 next-1)刚点亮，弹一下
    setTimeout(() => setJustLitIndex(cur => (cur === next - 1 ? null : cur)), 350);
    if (MILESTONES.includes(next)) {
      // ⚠️ 立即冻结：里程碑弹窗本身延迟 350ms 才出，这 350ms 里若不冻结，
      // 玩家会在密集星区继续冲过下一段星 → 同时排两个里程碑，关一个又弹一个（"卡住"假象）。
      cutsceneFreezeRef.current = true;
      cancelCanvasDrag(); // 收集瞬间玩家常按住鼠标拖动找路 → 立即停拖拽并上锁闸门（覆盖弹窗前 350ms）
      stopMovement();
      setTimeout(() => triggerMilestone(next), 350);
    }
  };

  const handleObstacleHit = (id: number, variant: 0 | 1 | 2, _position: Vec2) => {
    // 障碍钉死在地图上（不再删除）。撞到触发红屏反馈；定稿：不扣星，惩罚改眩晕（第2梯队）。
    if (variant === 2) {
      setHitEffect('question');
      setObstacleBurstId(id);
      setWorldPrompt(null);
      playCue('box');
      showFeedback('box', '砰！');
      setTimeout(() => setObstacleBurstId(null), 350);
    } else {
      setHitEffect('rock');
    }
    setTimeout(() => setHitEffect(null), 400);
  };

  // ── 月亮演出编排 ───────────────────────────────────────────────────────────
  // 在玩家前方（-z）distance 单位、横向（+x 右 / -x 左）lateral 单位处取世界坐标（clamp 进图内）。
  const aheadOfPlayer = (distance: number, lateral = 0): Vec2 => {
    const p = playerPosRef.current;
    const lim = 240 / 2 - 4;
    const clamp = (v: number) => Math.max(-lim, Math.min(lim, v));
    return { x: clamp(p.x + lateral), z: clamp(p.z - distance) };
  };

  // 🌙 NPC2 对话结束 → 在玩家前方刷出假月亮。想自己调假月亮位置就改这两个数：
  //   FAKE_MOON_AHEAD  = 在玩家前方多远（越大越远）。
  //   FAKE_MOON_LATERAL= 左右偏移（正=右、负=左）。当前偏左让它落在路上、不进树丛。
  const FAKE_MOON_AHEAD = 22 * ACTOR_SCALE;    // 前方距离
  const FAKE_MOON_LATERAL = -10 * ACTOR_SCALE; // 横向偏移（负=左，避开右侧树丛）
  const spawnFakeMoon = () => {
    setFakeMoonPos(aheadOfPlayer(FAKE_MOON_AHEAD, FAKE_MOON_LATERAL));
    setShowGoHint(false);
  };

  // 玩家走近假月亮 → 冻结 + 弹对话框1
  const handleFakeMoonReach = () => {
    cutsceneFreezeRef.current = true;
    cancelCanvasDrag(); // 走近假月亮常按住鼠标拖动 → 立即停拖拽并上锁闸门（弹窗期间不转视角）
    stopMovement();
    setFakeMoonDialog(1);
    generateSlot('fakeMoon'); // 探险相册：假月亮事件触发即并行生图
    track('stage_complete', { stage: 'fakeMoon' }); // 埋点：假月亮事件触发
  };

  // 假月亮对话框「继续找」→ 收起月亮、天空转黄昏、解冻、提示找 NPC3
  const closeFakeMoon = () => {
    setFakeMoonDialog(0);
    setFakeMoonPos(null);
    setSkyPhase('dusk');         // 平滑渐变到暮色（SkyAndLights 用 lerp）
    cutsceneFreezeRef.current = false;
    setShowGoHint(true);
    setTimeout(() => setShowGoHint(false), 5000);
    canvasRef.current?.focus();
  };

  // NPC3 对话结束 → 触发终点：冻结、天空转夜、真月亮在远处升起。
  const startEnding = () => {
    setEndingActive(true);
    cutsceneFreezeRef.current = true;
    cancelCanvasDrag(); // 终点演出冻结时也停拖拽并上锁闸门，保持状态干净一致
    stopMovement();
    setSkyPhase('night');               // 平滑渐变到夜晚（约 3s）
    setRealMoonPos(aheadOfPlayer(55));  // 远处地平线升起
  };

  // 真月亮升起完成 → 停留 2s → 跳转结算
  const handleRealMoonRisen = () => {
    setTimeout(() => {
      track('stage_complete', { stage: 'parkour' }); // 埋点：跑酷通关（真月亮升起完成、跳转结算前）
      onComplete?.();
    }, 2000);
  };

  // ── ⭐ 进度条尺寸旋钮（想调大小只改 HUD_BAR_W 这一个数）──
  const HUD_BAR_W = 460;                          // 底图渲染宽度（原 200 的 ~2.3 倍）
  const HUD_BAR_H = HUD_BAR_W * (253 / 1536);     // 按原图比例 6.07:1 自动算高 ≈ 76
  // ── ⭐ 进度条亮星旋钮（这三个数你自己调）────────────────────────────────────
  //   STAR_SLOT_D    = 亮星大小（直径，%W）。想更大调大、更小调小。
  //   STAR_SLOT_START= 第 1 颗星的水平位置（%W，越大越往右）。
  //   STAR_SLOT_GAP  = 相邻两星间距（%W，越大越散开）。
  const STAR_SLOT_D = 11;        // 亮星显示直径（%W）
  const STAR_SLOT_START = 27;    // 第 1 颗星中心（%W）
  const STAR_SLOT_GAP = 5.5;     // 星与星间距（%W）
  const STAR_SLOT_CY = 53;       // 灰星垂直中心（%H，一般不用动）
  // 9 颗星中心 = 起点 + i×间距，自动生成（无需手填每颗）
  const STAR_SLOT_XS = Array.from({ length: TOTAL_STARS }, (_, i) => STAR_SLOT_START + i * STAR_SLOT_GAP);
  const NUM_CX = 84;           // 数字区中心，%W
  const currentTutorialDirection = CONTROL_TUTORIAL_DIRECTIONS[currentDirectionIndex] ?? 'down';

  const NPC_DATA = {
    zh: [
      { name: '啄木鸟', line: '嘿，跑这么快，去找啥？', img: '/npc-2d/woodpecker.webp' },
      { name: 'kiwi', line: 'kiwi！猜猜我是谁？', img: '/npc-2d/kiwi.webp' },
      { name: '叽里咕噜', line: '完成我的小观察，我就告诉你月亮在哪！月亮长什么样呀？', img: '/npc-2d/jiligulu.webp' },
    ],
    en: [
      { name: 'Woodpecker', line: "Hey, what's the rush?", img: '/npc-2d/woodpecker.webp' },
      { name: 'Kiwi', line: 'Can you guess who I am?', img: '/npc-2d/kiwi.webp' },
      { name: 'Jiligulu', line: "Complete my little challenge and I'll tell you where the moon is! The challenge is — describe what the moon looks like!", img: '/npc-2d/jiligulu.webp' },
    ],
  }[lang];

  const [isListening, setIsListening] = useState(false);
  void isListening; // 旧字段保留以最小化改动；实际监听态改用 speech hook 的 srListening
  const [displayedNpcText, setDisplayedNpcText] = useState(''); // 当前 NPC 这句话（开场白 / AI 流式）
  const npcTextRef = useRef(0);
  const voiceStartRef = useRef<number>(0); // 语音开始时间戳，用于计算单次录音时长
  // 浏览器不支持语音时：用户点了麦克风才弹提示，几秒后自动消失（平时不常驻）
  const [voiceHintShown, setVoiceHintShown] = useState(false);
  const voiceHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showVoiceHint = () => {
    if (voiceHintTimerRef.current) clearTimeout(voiceHintTimerRef.current);
    setVoiceHintShown(true);
    voiceHintTimerRef.current = setTimeout(() => setVoiceHintShown(false), 3000);
  };
  useEffect(() => () => { if (voiceHintTimerRef.current) clearTimeout(voiceHintTimerRef.current); }, []);
  // AI 对话状态
  const [messages, setMessages] = useState<ChatMessage[]>([]); // system + assistant开场 + 往返历史
  const [chatInput, setChatInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [dialogComplete, setDialogComplete] = useState(false); // 检测到 [COMPLETE] 后显示"继续"
  const [openingTyping, setOpeningTyping] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const speechAudioRef = useRef<HTMLAudioElement | null>(null);
  const speechUrlRef = useRef<string | null>(null);
  const speechAbortRef = useRef<AbortController | null>(null);

  const stopNpcSpeech = useCallback(() => {
    speechAbortRef.current?.abort();
    speechAbortRef.current = null;
    if (speechAudioRef.current) {
      speechAudioRef.current.pause();
      speechAudioRef.current = null;
    }
    if (speechUrlRef.current) {
      URL.revokeObjectURL(speechUrlRef.current);
      speechUrlRef.current = null;
    }
  }, []);

  const playPreparedNpcSpeech = useCallback(async (url: string) => {
    stopNpcSpeech();
    try {
      speechUrlRef.current = url;
      const audio = new Audio(url);
      speechAudioRef.current = audio;
      audio.onended = () => {
        if (speechAudioRef.current === audio) {
          speechAudioRef.current = null;
          if (speechUrlRef.current === url) {
            URL.revokeObjectURL(url);
            speechUrlRef.current = null;
          }
        }
      };
      await audio.play();
    } catch (err) {
      console.warn('Fish Audio playback failed', err);
    }
  }, [stopNpcSpeech]);

  // 语音识别（Web Speech API）。zh→zh-CN / en→en-US。识别稿实时灌进 chatInput，停后点"说"发送。
  const {
    isListening: srListening,
    text: srText,
    isSupported: srSupported,
    unavailableReason: srReason,
    start: srStart,
    stop: srStop,
    reset: srReset,
  } = useSpeechRecognition(lang === 'zh' ? 'zh-CN' : 'en-US');

  // 识别中：把实时稿同步进输入框（停了之后 chatInput 保留，便于编辑/发送）
  useEffect(() => {
    if (srListening) setChatInput(srText);
  }, [srText, srListening]);

  // 对话开/关：初始化会话历史 + 逐字播开场白（开场白不调 API）
  useEffect(() => {
    if (npcDialog === null) {
      abortRef.current?.abort();
      stopNpcSpeech();
      srReset(); // 关闭对话：停止并清空语音识别
      setDisplayedNpcText('');
      npcTextRef.current = 0;
      setIsListening(false);
      setMessages([]);
      setChatInput('');
      setIsStreaming(false);
      setDialogComplete(false);
      setOpeningTyping(false);
      return;
    }
    const idx = npcDialog - 1;
    const opening = NPC_DATA[idx].line;
    // 会话历史：system prompt + 开场白作为首条 assistant 消息（给 AI 上下文）
    setMessages([
      { role: 'system', content: NPC_SYSTEM_PROMPTS[idx] },
      { role: 'assistant', content: opening },
    ]);
    setChatInput('');
    setDialogComplete(false);
    setIsStreaming(false);
    // 开场白打字机
    npcTextRef.current = 0;
    setDisplayedNpcText('');
    setOpeningTyping(true);
    const interval = setInterval(() => {
      npcTextRef.current += 1;
      if (npcTextRef.current <= opening.length) {
        setDisplayedNpcText(opening.slice(0, npcTextRef.current));
      } else {
        clearInterval(interval);
        setOpeningTyping(false);
      }
    }, 60);
    return () => clearInterval(interval);
  }, [npcDialog, lang, srReset, stopNpcSpeech]);

  // 发送小朋友的话 → 等 AI 完整回复 + Fish Audio 完整生成 → 再展示文字并播放声音
  const handleSend = async () => {
    if (srListening) srStop(); // 发送前先停止识别，定格当前稿
    const text = chatInput.trim();
    if (!text || isStreaming || openingTyping || npcDialog === null) return;
    setChatInput('');
    const history: ChatMessage[] = [...messages, { role: 'user', content: text }];
    setMessages(history);
    setIsStreaming(true);
    setDisplayedNpcText('');
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const speechController = new AbortController();
    speechAbortRef.current = speechController;
    try {
      const full = await streamChat(history, undefined, controller.signal);
      if (controller.signal.aborted) return;

      let speechUrl: string | null = null;
      try {
        speechUrl = await createFishSpeechUrl(
          fishVoiceRoleFromNpcIndex(npcDialog),
          full,
          speechController.signal,
        );
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
        console.warn('Fish Audio generation failed', err);
      }
      if (controller.signal.aborted || speechController.signal.aborted) return;

      setDisplayedNpcText(stripMarkers(full));
      if (speechUrl) void playPreparedNpcSpeech(speechUrl);
      setMessages(prev => [...prev, { role: 'assistant', content: full }]);
      // 标记解析
      const name = extractName(full);
      if (name) setNpc2Name(name);
      if (full.includes('[COMPLETE]')) setDialogComplete(true);
      // 未检测到 [COMPLETE] → 保持输入框，让小朋友再说一次（NPC1 意图判断常见）
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return; // 对话已关闭，静默
      // 友好兜底，不让对话卡死；不写入历史，方便重试
      setDisplayedNpcText(lang === 'zh' ? '让我想想……再跟我说一次吧！' : 'Let me think… tell me again!');
    } finally {
      setIsStreaming(false);
    }
  };

  // 结束当前 NPC 对话并走收尾流程（标记完成 + 生图 + 埋点 + 后续演出）。
  // 「继续」按钮（对话正常完成）和「跳过」按钮（用户主动跳过）共用这套，保证流程一致不漏步。
  const finishNpcDialog = (skipped = false) => {
    const closed = npcDialog;
    if (closed === null) return;
    abortRef.current?.abort();       // 跳过时若正在请求 AI，立即中止
    srReset();                       // 停掉可能还在跑的语音识别
    const idx = closed - 1;
    setNpcDone(prev => new Set(prev).add(idx));
    setNpcDialog(null);
    canvasRef.current?.focus();
    // 探险相册：对话完成即并行生图（fire-and-forget，互不等待）
    if (closed === 1) generateSlot('npc1');
    else if (closed === 2) generateSlot('npc2');
    else if (closed === 3) generateSlot('npc3');
    // 埋点：该 NPC 对话完成；skipped 标记是否为主动跳过
    const stage = closed === 1 ? 'npc1' : closed === 2 ? 'npc2' : 'npc3';
    track('stage_complete', { stage, skipped });
    // NPC2 结束 → 刷出假月亮过场；NPC3 结束 → 真月亮升起终点演出
    if (closed === 2) spawnFakeMoon();
    else if (closed === 3) startEnding();
  };

  const currentNpc = npcDialog !== null ? NPC_DATA[npcDialog - 1] : null;

  return (
    <div ref={containerRef} className="w-full h-full relative overflow-hidden select-none bg-gradient-to-b from-[#3c7dd7] to-[#79cbf8]">

      {/* 场景就绪遮罩：盖住「chunk 已下载、3D 场景尚未渲染」的渐变蓝空档（防蓝屏）。routeSceneReady 后撤掉。 */}
      {!routeSceneReady && (
        <div className="otter-landing-wait absolute inset-0 z-[70] flex flex-col items-center justify-center text-white pointer-events-auto bg-[url('/parkour-bg.webp')] bg-cover bg-center">
          <div className="font-display font-black text-2xl drop-shadow-md">
            {lang === 'en' ? 'Otter is landing on the path...' : '奥特正在降落到小路上...'}
          </div>
        </div>
      )}

      {/* Star Progress Bar HUD — 底图(吉祥物+9灰星+分隔线) + 9 亮星叠加 + N/9 数字 */}
      <motion.div
        className="absolute z-20"
        style={{ top: 16, left: 16, width: HUD_BAR_W, height: HUD_BAR_H }}
        initial={false}
        animate={isControlTutorialActive ? { opacity: 0.42, scale: 0.94 } : shakeBar ? { x: [-5, 5, -5, 5, -3, 3, 0], opacity: 1, scale: 1 } : { x: 0, opacity: 1, scale: 1 }}
        transition={{ duration: 0.35 }}
      >
        {/* 层1：底图。集满一段(3/6/9)时整图发光 */}
        <img
          src="/star-progress-bar/progress-0.webp"
          alt="star progress"
          width={HUD_BAR_W}
          height={HUD_BAR_H}
          style={{
            display: 'block',
            width: HUD_BAR_W,
            height: HUD_BAR_H,
            filter: glowBar ? 'drop-shadow(0 0 12px #FFD700)' : 'none',
            transition: 'filter 0.4s ease-out',
          }}
        />

        {/* 层2：9 颗亮星，收集第 i+1 颗时盖住第 i 颗灰星；刚点亮的那颗弹一下。
            外层 div 负责定位居中（纯 CSS），内层 motion.img 只管 scale 动画——
            否则 Framer Motion 的 animate.scale 会接管 transform，把居中的 translate 顶掉导致错位。 */}
        {STAR_SLOT_XS.map((xPct, i) => (totalCollected >= i + 1 ? (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: `${xPct}%`,
              top: `${STAR_SLOT_CY}%`,
              width: `${STAR_SLOT_D}%`,
              transform: 'translate(-50%, -50%)',
              pointerEvents: 'none',
              lineHeight: 0,
            }}
          >
            <motion.img
              src="/star-progress-bar/star.webp"
              alt=""
              initial={{ scale: 0 }}
              animate={{ scale: justLitIndex === i ? [0, 1.35, 1] : 1 }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
              style={{
                display: 'block',
                width: '100%',
                height: 'auto',
                filter: 'drop-shadow(0 1px 2px rgba(180,120,0,0.4))',
              }}
            />
          </div>
        ) : null))}

        {/* 层3：N/9 数字，渲染在底图右侧数字区 */}
        <div style={{
          position: 'absolute',
          left: `${NUM_CX}%`,
          top: '50%',
          transform: 'translate(-50%, -50%)',
          fontFamily: 'Nunito, system-ui, sans-serif',
          fontWeight: 900,
          fontSize: HUD_BAR_H * 0.42,
          color: '#C8821E',
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
        }}>
          {totalCollected}/{TOTAL_STARS}
        </div>
      </motion.div>

      {/* 情况C：进度提示 "去找伙伴吧！" */}
      <AnimatePresence>
        {showGoHint && (
          <motion.div
            initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: [0, -6, 0] }} exit={{ opacity: 0 }}
            transition={{ duration: 0.4, y: { repeat: Infinity, duration: 1, ease: 'easeInOut' } }}
            className="absolute z-20 font-display font-bold text-otter-orange drop-shadow-md"
            style={{ top: 16 + HUD_BAR_H + 12, left: 16, fontSize: 16 }}
          >
            {lang === 'zh' ? '去找伙伴吧！ →' : 'Go find your friend! →'}
          </motion.div>
        )}
      </AnimatePresence>

      {/* 可交互物体的靠近提示：作为 3D 标签的 DOM 兜底，不遮挡玩家移动路线。 */}
      <AnimatePresence>
        {worldPrompt && !isControlTutorialActive && gameState === 'playing' && !npcDialog && !milestonePopup && fakeMoonDialog === 0 && !endingActive && (
          <PromptChip text={worldPrompt.text} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {idleStarHint && !isControlTutorialActive && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.95 }}
            animate={{ opacity: 1, y: [0, -4, 0], scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.95 }}
            transition={{ duration: 0.2, y: { repeat: Infinity, duration: 1.2, ease: 'easeInOut' } }}
            className="absolute z-30 left-1/2 top-[30%] -translate-x-1/2 rounded-full bg-white/95 border-4 border-yellow-300 px-6 py-3 text-2xl font-display font-black text-otter-orange shadow-xl pointer-events-none"
          >
            {lang === 'zh' ? '往星星那里走！' : 'Head for the star!'}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {feedback && <FeedbackBurst id={feedback.id} kind={feedback.kind} text={feedback.text} />}
      </AnimatePresence>

      {/* 集齐一段（3/6/9）中央弹窗 — 含对应 NPC 外观线索，点"出发"关闭 */}
      {/* 整个弹窗纯条件渲染（不挂 AnimatePresence、不始终挂载）：milestonePopup 一回 null，
          React 立刻同步卸载整块 DOM——彻底杜绝 framer-motion 退场在 React19 StrictMode 下
          残留 z-50 全屏层、隐形吃掉后续点击的问题（前几轮"关不掉/等半天/假月亮卡死"皆源于此）。
          入场动画用 motion 的 initial→animate（无需 AnimatePresence）；仅关闭时无退场动画。*/}
      {milestonePopup !== null && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.35)' }}
          onPointerUp={(e) => { e.stopPropagation(); playCue('continue'); closeMilestone(); }}
        >
          <motion.div
            initial={{ scale: 0.8, y: 24, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            transition={{ duration: 0.32, ease: 'easeOut' }}
            className="kid-panel px-8 py-7 flex flex-col items-center gap-5 max-w-md mx-4 text-center"
            style={{ pointerEvents: 'auto' }}
          >
              {/* 星星图标 */}
              <motion.div
                animate={{ scale: [1, 1.18, 1], rotate: [0, -8, 8, 0] }}
                transition={{ duration: 0.6, ease: 'easeOut' }}
              >
                <img src="/Star.webp" alt="star" width={64} height={64} className="object-contain" />
              </motion.div>
              <p className="text-2xl font-bold leading-relaxed text-otter-text">
                {(lang === 'zh'
                  ? {
                      3: '恭喜你收集到 3 颗星星啦！快去找一只红色的鸟吧！',
                      6: '恭喜你收集到 6 颗星星啦！快去找一只背着背包的鸟吧！',
                      9: '恭喜你收集到 9 颗星星啦！快去找一只穿着白大褂的水豚吧！',
                    }
                  : {
                      3: 'You collected 3 stars! Go find a red bird!',
                      6: 'You collected 6 stars! Go find a bird with a backpack!',
                      9: 'You collected 9 stars! Go find a capybara in a white coat!',
                    })[milestonePopup as 3 | 6 | 9]}
              </p>
              <motion.button
                type="button"
                animate={{ scale: [1, 1.04, 1] }}
                transition={{ repeat: Infinity, duration: 1.4, ease: 'easeInOut' }}
                className="kid-button-primary text-lg px-8 py-3 relative"
                // onPointerUp 而非 onClick：玩家常按住鼠标拖动找路（pointerdown 落在游戏层），
                // 再拖到按钮松手——onClick 要求 down/up 同元素故不触发；onPointerUp 落在按钮即触发。
                onPointerUp={(e) => { e.stopPropagation(); playCue('continue'); closeMilestone(); }}
              >
                {lang === 'zh' ? '出发 ▶' : 'Go! ▶'}
                <TapToContinueHint className="absolute -bottom-12 left-1/2 -translate-x-1/2 text-sm whitespace-nowrap" />
              </motion.button>
            </motion.div>
          </div>
        )}

      {/* 情况B：NPC气泡框 */}
      <AnimatePresence>
        {npcBubble !== null && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.2 }}
            className="absolute z-40 pointer-events-none"
            style={{ top: '30%', left: '50%', transform: 'translateX(-50%)', maxWidth: 360 }}
          >
            <div className="kid-panel px-5 py-3 text-base font-bold text-otter-text relative">
              {npcBubble.text}
              {/* 气泡尾巴 */}
              <div style={{
                position: 'absolute', bottom: -10, left: '50%', transform: 'translateX(-50%)',
                width: 0, height: 0,
                borderLeft: '10px solid transparent',
                borderRight: '10px solid transparent',
                borderTop: '10px solid white',
              }} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 假月亮过场对话框（两段：这不是月亮 → 原来是石子）*/}
      {/* 纯条件渲染（同里程碑，杜绝 framer-motion 退场残留）。背板只拦截、不关闭（推进/关闭走按钮）。*/}
      {fakeMoonDialog !== 0 && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.35)' }}
        >
          <motion.div
            initial={{ scale: 0.9, y: 20, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className="kid-panel px-8 py-7 flex flex-col items-center gap-5 max-w-md mx-4 pointer-events-auto"
          >
              <p className="text-2xl font-bold leading-relaxed text-otter-text text-center">
                {fakeMoonDialog === 1
                  ? (lang === 'zh' ? '哎呀，这不是月亮嘛！' : "Huh, that's not the moon!")
                  : (lang === 'zh' ? '原来是石子呀！再找找吧！' : "It's just a pebble! Keep looking!")}
              </p>
              <motion.button
                animate={{ scale: [1, 1.04, 1] }}
                transition={{ repeat: Infinity, duration: 1.4, ease: 'easeInOut' }}
                className="kid-button-primary text-lg px-8 py-3 relative"
                onPointerUp={(e) => {
                  e.stopPropagation();
                  playCue('continue');
                  if (fakeMoonDialog === 1) setFakeMoonDialog(2); // 进入第二段
                  else closeFakeMoon();                            // 关闭 → 转黄昏、继续找
                }}
              >
                {fakeMoonDialog === 1
                  ? (lang === 'zh' ? '再看看呢？' : 'Take another look?')
                  : (lang === 'zh' ? '继续找' : 'Keep looking')}
                <TapToContinueHint className="absolute -bottom-12 left-1/2 -translate-x-1/2 text-sm whitespace-nowrap" />
              </motion.button>
            </motion.div>
        </div>
      )}

      {/* NPC Dialog — full screen visual novel style */}
      {/* 纯条件渲染（同里程碑，杜绝 framer-motion 退场残留）。背板只拦截背景点击（stopPropagation），
          关闭走对话框内按钮；npcDialog 一回 null 整块 DOM 同步卸载，不残留、也不残留毛玻璃。*/}
      {npcDialog !== null && currentNpc && (
        <div
          className="absolute inset-0 z-50"
          style={{ backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', background: 'rgba(0,0,0,0.35)' }}
          onPointerUp={e => e.stopPropagation()}
        >
            {/* NPC 立绘 —— 位置/大小用下面三个旋钮自己调（见 NPC_PORTRAIT 常量） */}
            <motion.div
              initial={{ x: 60, opacity: 0 }} animate={{ x: 0, opacity: 1 }}
              transition={{ duration: 0.4, ease: 'easeOut' }}
              className="absolute pointer-events-none"
              style={{ top: NPC_PORTRAIT.top, right: NPC_PORTRAIT.right, height: NPC_PORTRAIT.height }}
            >
              <img
                src={currentNpc.img}
                alt={currentNpc.name}
                className="h-full object-contain drop-shadow-2xl"
              />
            </motion.div>

            {/* Dialog box — bottom left, SectionVisualNovel style */}
            <motion.div
              initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
              transition={{ duration: 0.35, delay: 0.15 }}
              className="absolute bottom-12 left-1/2 -translate-x-1/2 w-11/12 max-w-2xl pointer-events-auto"
            >
              {/* Name tag */}
              <div
                className="bg-otter-orange text-white font-display font-bold text-2xl px-8 pt-2 pb-10 w-max border-4 border-b-0 border-white/50"
                style={{ borderRadius: '16px 16px 0 0', position: 'relative', zIndex: 0 }}
              >
                {currentNpc.name}
              </div>

              {/* Dialog panel */}
              <div
                className="kid-panel p-8 mt-[-2rem] relative flex flex-row items-start gap-8 min-h-[160px]"
                style={{ zIndex: 1 }}
              >
                {/* Text */}
                <div className="flex-1 text-2xl font-bold leading-relaxed text-otter-text">
                  {displayedNpcText}
                  {(openingTyping || isStreaming) && (
                    <span className="animate-pulse">▍</span>
                  )}
                </div>

                {/* Mic + input + continue */}
                <div className="flex flex-col items-center gap-3 shrink-0 w-56">
                  <button
                    className={`kid-button-primary !w-20 !h-20 !p-0 !shadow-[0_8px_0_#cc7400] ${srListening ? '!bg-red-500 scale-95' : '!bg-otter-orange'} disabled:opacity-50`}
                    disabled={isStreaming || openingTyping}
                    onClick={() => {
                      if (!srSupported) {
                        // 浏览器不支持：弹个临时提示，几秒后自动消失
                        showVoiceHint();
                        return;
                      }
                      if (srListening) {
                        srStop();
                        track('voice_end', { scene: 'parkour', durationMs: Date.now() - voiceStartRef.current });
                      } else {
                        voiceStartRef.current = Date.now();
                        track('voice_start', { scene: 'parkour' });
                        srStart();
                      }
                    }}
                  >
                    <Mic className="w-10 h-10 text-white" />
                  </button>
                  <span className="text-xs font-bold text-gray-400 text-center px-1 whitespace-pre-line">
                    {!srSupported
                      ? (voiceHintShown
                          ? (srReason === 'insecure'
                              ? (lang === 'zh' ? '请用 Chrome 并通过 https 访问\n才能使用语音' : 'Open via https in Chrome\nto use voice')
                              : (lang === 'zh' ? '请用 Chrome 浏览器\n才能使用语音' : 'Use Chrome\nto enable voice'))
                          : (lang === 'zh' ? '点击说话' : 'Tap to talk'))
                      : srListening
                        ? (lang === 'zh' ? '聆听中…再点一下停止' : 'Listening… tap to stop')
                        : (lang === 'zh' ? '点击说话' : 'Tap to talk')}
                  </span>

                  {dialogComplete ? (
                    <motion.button
                      animate={{ scale: [1, 1.05, 1] }}
                      transition={{ repeat: Infinity, duration: 1.25, ease: 'easeInOut' }}
                      className="kid-button-secondary text-base px-5 py-2 text-otter-orange w-full relative"
                      // onPointerUp：玩家走近 NPC 常按住鼠标拖动，pointerdown 落在游戏层，
                      // 拖到此按钮松手时 onClick 不触发（down/up 异元素），onPointerUp 则正常触发。
                      onPointerUp={(e) => {
                        e.stopPropagation();
                        playCue('continue');
                        finishNpcDialog(false);
                      }}
                    >
                      {lang === 'zh' ? '继续 ▶' : 'Continue ▶'}
                      <TapToContinueHint className="absolute -bottom-12 right-0 text-sm whitespace-nowrap" />
                    </motion.button>
                  ) : (
                    <div className="flex flex-col items-stretch gap-2 w-full">
                      <input
                        type="text"
                        value={chatInput}
                        onChange={e => setChatInput(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                            e.preventDefault();
                            handleSend();
                          }
                        }}
                        disabled={isStreaming || openingTyping}
                        placeholder={lang === 'zh' ? '打字跟它说话…' : 'Type to talk…'}
                        className="w-full px-3 py-2 rounded-xl border-2 border-otter-orange/40 focus:border-otter-orange outline-none text-base text-otter-text disabled:opacity-50"
                      />
                      <button
                        className="kid-button-primary text-base px-5 py-2 w-full disabled:opacity-50"
                        disabled={isStreaming || openingTyping || chatInput.trim() === ''}
                        onClick={(e) => { e.preventDefault(); handleSend(); }}
                      >
                        {isStreaming ? (lang === 'zh' ? '思考中…' : 'Thinking…') : (lang === 'zh' ? '说' : 'Send')}
                      </button>
                      {/* 跳过对话：直接走收尾流程（生图/埋点/演出都不漏），给卡住的用户一个出口 */}
                      <button
                        className="text-xs font-bold text-gray-400 hover:text-otter-orange underline underline-offset-2 mt-1"
                        onClick={(e) => { e.preventDefault(); finishNpcDialog(true); }}
                      >
                        {lang === 'zh' ? '跳过对话 ▶' : 'Skip ▶'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
        </div>
      )}

      {/* 3D Scene */}
      {/* 物理隔离的核心：任何全屏弹窗（里程碑/假月亮/NPC对话）打开时，整个游戏层 pointer-events:none
          直接“失聪”——鼠标事件根本进不来，转视角与弹窗按钮从物理上不可能互相干扰。
          弹窗在各自的 z-50 层用 pointer-events:auto 独占收事件。两个功能永不同时活跃。 */}
      <div
        ref={canvasRef}
        tabIndex={0}
        className="absolute inset-0 z-10 outline-none"
        style={{ pointerEvents: anyPopupOpen ? 'none' : 'auto' }}
      >
        <SceneErrorBoundary>
          <Canvas
            shadows={{ type: THREE.PCFSoftShadowMap }}
            dpr={[1, 1.5]}
            camera={{ position: [0, 1.3, 4.25], fov: 60 }}
            gl={RENDER_CONFIG}
          >
            <React.Suspense fallback={null}>
              <ParkourScene
                velocityRef={velocityRef}
                playerPosRef={playerPosRef}
                camYawRef={camYawRef}
                collectedIds={collectedIds}
                hitEffect={hitEffect}
                paused={gameState !== 'playing' || npcDialog !== null || fakeMoonDialog !== 0 || endingActive || milestonePopup !== null}
                skyPhase={skyPhase}
                fakeMoonPos={fakeMoonPos}
                realMoonPos={realMoonPos}
                focusStarId={isControlTutorialActive ? null : focusStarId}
                guideStarId={guidedStarId}
                obstacleBurstId={obstacleBurstId}
                softFocusInteractives={isControlTutorialActive || gameState === 'starGuide'}
                loadNpcModels={controlTutorialComplete || gameState !== 'tutorial'}
                onCollect={handleCollect}
                onObstacleHit={handleObstacleHit}
                onNpcApproach={handleNpcApproach}
                onWorldPromptChange={setWorldPrompt}
                onFakeMoonReach={handleFakeMoonReach}
                onRealMoonRisen={handleRealMoonRisen}
                onDebugUpdate={setDebugInfo}
                debugYRef={debugYRef}
                creekStarPositions={debugCreekStars}
                npcPositions={npcDebugAxes}
                landStarPositions={debugLandStars}
              />
            </React.Suspense>
          </Canvas>
        </SceneErrorBoundary>
      </div>

      {/* 调试面板 — Tab 折叠式（主角/NPC1/NPC2/NPC3/水面星） */}
      {SHOW_COORDS && (
        <div style={{
          position: 'absolute', top: 12, left: 12, zIndex: 40,
          background: 'rgba(0,0,0,0.82)', color: '#7CFC00',
          fontSize: 12, fontFamily: 'monospace',
          borderRadius: 8, lineHeight: 1.7, fontWeight: 'bold',
          width: 296, userSelect: 'none',
        }}>
          {/* Tab 按钮行 */}
          <div style={{ display: 'flex', borderBottom: '1px solid #444', flexWrap: 'wrap' }}>
            {(['player', 'npc0', 'npc1', 'npc2', 'land', 'creek'] as const).map((tab, i) => {
              const labels = ['主角', 'NPC1', 'NPC2', 'NPC3', '陆地星', '水面星'];
              const active = debugTab === tab;
              return (
                <button key={tab} onClick={() => setDebugTab(tab)} style={{
                  flex: 1, padding: '4px 2px', cursor: 'pointer',
                  background: active ? '#1a1a1a' : 'transparent',
                  color: active ? '#FFD700' : '#7CFC00',
                  border: 'none', borderBottom: active ? '2px solid #FFD700' : '2px solid transparent',
                  fontFamily: 'monospace', fontWeight: 'bold', fontSize: 11,
                }}>
                  {labels[i]}
                </button>
              );
            })}
          </div>

          {/* 主角 Tab */}
          {debugTab === 'player' && (
            <div style={{ padding: '8px 12px' }}>
              <div style={{ color: '#aaa', fontSize: 11, marginBottom: 4 }}>
                x={debugInfo.player.x.toFixed(2)}　z={debugInfo.player.z.toFixed(2)}　Y={debugInfo.playerY.toFixed(2)}
              </div>
              {/* X */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                <span style={{ width: 12 }}>X</span>
                <input type="range" min={-116} max={116} step={0.1} value={debugAxis.x}
                  onChange={e => { const v = parseFloat(e.target.value); playerPosRef.current.x = v; setDebugAxis(a => ({ ...a, x: v })); }}
                  style={{ flex: 1, cursor: 'pointer' }} />
                <span style={{ width: 46, textAlign: 'right', fontSize: 11 }}>{debugAxis.x.toFixed(1)}</span>
              </div>
              {/* Y */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                <span style={{ width: 12 }}>Y</span>
                <input type="range" min={-5} max={20} step={0.1} value={debugAxis.y ?? debugInfo.playerY ?? 0}
                  onChange={e => { const v = parseFloat(e.target.value); debugYRef.current = v; setDebugAxis(a => ({ ...a, y: v })); }}
                  style={{ flex: 1, cursor: 'pointer' }} />
                <span style={{ width: 46, textAlign: 'right', fontSize: 11 }}>
                  {debugAxis.y == null ? '地形' : debugAxis.y.toFixed(1)}
                </span>
              </div>
              {/* Z */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <span style={{ width: 12 }}>Z</span>
                <input type="range" min={-116} max={116} step={0.1} value={debugAxis.z}
                  onChange={e => { const v = parseFloat(e.target.value); playerPosRef.current.z = v; setDebugAxis(a => ({ ...a, z: v })); }}
                  style={{ flex: 1, cursor: 'pointer' }} />
                <span style={{ width: 46, textAlign: 'right', fontSize: 11 }}>{debugAxis.z.toFixed(1)}</span>
              </div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                <button onClick={() => { debugYRef.current = null; setDebugAxis(a => ({ ...a, y: null })); }}
                  style={{ background: '#333', color: '#7CFC00', border: '1px solid #555', borderRadius: 4, padding: '2px 8px', cursor: 'pointer', fontSize: 11, fontFamily: 'monospace' }}>
                  Y 贴地
                </button>
                <button onClick={() => { setDebugAxis({ x: playerPosRef.current.x, y: debugYRef.current, z: playerPosRef.current.z }); }}
                  style={{ background: '#333', color: '#7CFC00', border: '1px solid #555', borderRadius: 4, padding: '2px 8px', cursor: 'pointer', fontSize: 11, fontFamily: 'monospace' }}>
                  同步当前
                </button>
              </div>
              <div style={{ color: '#aaa', fontSize: 11 }}>
                PLAYER_START: {'{'} x: {debugAxis.x.toFixed(2)}, z: {debugAxis.z.toFixed(2)} {'}'}
              </div>
            </div>
          )}

          {/* NPC Tab（0/1/2 → 对应 npc0/npc1/npc2） */}
          {(['npc0', 'npc1', 'npc2'] as const).map((tab, i) => debugTab === tab && (
            <div key={tab} style={{ padding: '8px 12px' }}>
              <div style={{ color: '#aaa', fontSize: 11, marginBottom: 4 }}>
                {['NPC1 啄木鸟', 'NPC2 kiwi', 'NPC3 叽里咕噜'][i]}　距离={debugInfo.npcDist[i].toFixed(1)}
              </div>
              {/* X */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                <span style={{ width: 12 }}>X</span>
                <input type="range" min={-1000} max={1000} step={0.1} value={npcDebugAxes[i].x}
                  onChange={e => {
                    const v = parseFloat(e.target.value);
                    setNpcDebugAxes(axes => axes.map((a, j) => j === i ? { ...a, x: v } : a));
                  }}
                  style={{ flex: 1, cursor: 'pointer' }} />
                <span style={{ width: 46, textAlign: 'right', fontSize: 11 }}>{npcDebugAxes[i].x.toFixed(1)}</span>
              </div>
              {/* Z */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                <span style={{ width: 12 }}>Z</span>
                <input type="range" min={-1000} max={1000} step={0.1} value={npcDebugAxes[i].z}
                  onChange={e => {
                    const v = parseFloat(e.target.value);
                    setNpcDebugAxes(axes => axes.map((a, j) => j === i ? { ...a, z: v } : a));
                  }}
                  style={{ flex: 1, cursor: 'pointer' }} />
                <span style={{ width: 46, textAlign: 'right', fontSize: 11 }}>{npcDebugAxes[i].z.toFixed(1)}</span>
              </div>
              {/* Y */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <span style={{ width: 12 }}>Y</span>
                <input type="range" min={-1000} max={1000} step={0.05} value={npcDebugAxes[i].y}
                  onChange={e => {
                    const v = parseFloat(e.target.value);
                    setNpcDebugAxes(axes => axes.map((a, j) => j === i ? { ...a, y: v } : a));
                  }}
                  style={{ flex: 1, cursor: 'pointer' }} />
                <span style={{ width: 46, textAlign: 'right', fontSize: 11 }}>{npcDebugAxes[i].y.toFixed(2)}</span>
              </div>
              <div style={{ color: '#aaa', fontSize: 11 }}>
                {'{'} x:{npcDebugAxes[i].x.toFixed(2)}, y:{npcDebugAxes[i].y.toFixed(2)}, z:{npcDebugAxes[i].z.toFixed(2)} {'}'}
              </div>
            </div>
          ))}

          {/* 陆地星 Tab */}
          {debugTab === 'land' && (
            <div style={{ padding: '8px 12px', maxHeight: 340, overflowY: 'auto' }}>
              {debugLandStars.map((star, i) => (
                <div key={star.id} style={{ marginBottom: 6 }}>
                  <div style={{ color: '#FFD700', fontSize: 11, marginBottom: 1 }}>星 id={star.id}</div>
                  {(['x', 'z'] as const).map(axis => (
                    <div key={axis} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                      <span style={{ width: 12 }}>{axis.toUpperCase()}</span>
                      <input type="range" min={-116} max={116} step={0.1} value={star[axis]}
                        onChange={e => {
                          const v = parseFloat(e.target.value);
                          setDebugLandStars(arr => arr.map((s, j) => j === i ? { ...s, [axis]: v } : s));
                        }}
                        style={{ flex: 1, cursor: 'pointer' }} />
                      <span style={{ width: 46, textAlign: 'right', fontSize: 11 }}>{star[axis].toFixed(1)}</span>
                    </div>
                  ))}
                </div>
              ))}
              <div style={{ color: '#aaa', fontSize: 10, marginTop: 6, lineHeight: 1.5 }}>
                {debugLandStars.map(s => (
                  <div key={s.id}>{'{'} id:{s.id}, x:{s.x.toFixed(1)}, z:{s.z.toFixed(1)} {'}'}</div>
                ))}
              </div>
            </div>
          )}

          {/* 水面星 Tab */}
          {debugTab === 'creek' && (
            <div style={{ padding: '8px 12px' }}>
              {debugCreekStars.map((star, i) => (
                <div key={i} style={{ marginBottom: 8 }}>
                  <div style={{ color: '#FFD700', fontSize: 11, marginBottom: 2 }}>星 #{i}</div>
                  {(['x', 'y', 'z'] as const).map(axis => (
                    <div key={axis} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                      <span style={{ width: 12 }}>{axis.toUpperCase()}</span>
                      <input type="range"
                        min={axis === 'y' ? -2 : -116}
                        max={axis === 'y' ? 10 : 116}
                        step={axis === 'y' ? 0.02 : 0.1}
                        value={star[axis]}
                        onChange={e => {
                          const v = parseFloat(e.target.value);
                          setDebugCreekStars(arr => arr.map((s, j) => j === i ? { ...s, [axis]: v } : s));
                        }}
                        style={{ flex: 1, cursor: 'pointer' }} />
                      <span style={{ width: 46, textAlign: 'right', fontSize: 11 }}>{star[axis].toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              ))}
              <div style={{ color: '#aaa', fontSize: 10, marginTop: 4, lineHeight: 1.5 }}>
                {debugCreekStars.map((s, i) => (
                  <div key={i}>{'{'} x:{s.x.toFixed(2)}, y:{s.y.toFixed(2)}, z:{s.z.toFixed(2)} {'}'}</div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Nudge prompt — shown after 5s of no input */}
      <AnimatePresence>
        {showNudge && gameState === 'playing' && (
          <motion.div
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="absolute z-50 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 pointer-events-none"
            style={{ bottom: '52%' }}
          >
            <div className="bg-otter-orange text-white font-display font-bold text-2xl px-6 py-3 rounded-2xl shadow-lg">
              {lang === 'zh' ? '往前走探索吧！' : 'Walk forward and explore!'}
            </div>
            <motion.div
              animate={{ y: [0, -12, 0] }}
              transition={{ repeat: Infinity, duration: 0.8, ease: 'easeInOut' }}
            >
              <img src="/arrow1.webp" alt="arrow" className="w-28 h-28 object-contain drop-shadow-lg" style={{ transform: 'rotate(-90deg)' }} />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {gameState === 'starGuide' && guidedStarId !== null && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: [0, -4, 0], scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={{ duration: 0.2, y: { repeat: Infinity, duration: 1.2, ease: 'easeInOut' } }}
            className="absolute z-40 left-1/2 top-8 -translate-x-1/2 rounded-full border-4 border-yellow-300 bg-white/82 px-5 py-2 text-center font-display text-lg font-black text-otter-orange shadow-xl backdrop-blur-sm pointer-events-none"
          >
            {lang === 'zh' ? '跟着箭头去第一颗星星！' : 'Follow the arrow to the first star!'}
          </motion.div>
        )}
      </AnimatePresence>

      {/* 鼠标视角引导气泡：键盘教学完成后出现，~6s 或拖过视角后自动收起 */}
      <AnimatePresence>
        {controlTutorialComplete && (gameState === 'starGuide' || gameState === 'playing') && showMouseHint && (
          <MouseViewHintBubble highlight />
        )}
      </AnimatePresence>

      {/* HUD Hint Card */}
      {gameState === 'playing' && (
        <div
          className="absolute bottom-8 left-8 z-30 rounded-2xl px-4 py-3 text-sm font-bold text-otter-text flex flex-col gap-2"
          style={{
            background: 'rgba(255,255,255,0.70)',
            backdropFilter: 'blur(8px)',
            opacity: isControlTutorialActive ? 0.32 : 1,
            transform: isControlTutorialActive ? 'scale(0.92)' : 'scale(1)',
            transformOrigin: 'bottom left',
            transition: 'opacity 0.25s ease, transform 0.25s ease',
          }}
        >
          <div className="flex items-center gap-2">
            <img src="/Parkour/Star.webp" alt="star" className="w-7 h-7 object-contain" />
            <span>{lang === 'zh' ? '收集星星' : 'Collect stars'}</span>
          </div>
          <div className="flex items-center gap-2">
            <img src="/Parkour/QuestionMark.webp" alt="question" className="w-7 h-7 object-contain" />
            <span>{lang === 'zh' ? '问号箱解锁角色' : 'Question boxes unlock characters'}</span>
          </div>
          <div className="flex items-center gap-2">
            <img src="/Parkour/Obstruction.webp" alt="obstacle" className="w-7 h-7 object-contain" />
            <span>{lang === 'zh' ? '躲开障碍物' : 'Dodge obstacles'}</span>
          </div>
          <div className="flex items-center gap-2 mt-1 text-gray-500">
            <span>↑ ↓ ← →</span>
            <span>{lang === 'zh' ? '方向键自由移动' : 'Arrow keys to move'}</span>
          </div>
        </div>
      )}

      {/* Hit flash overlays — CSS only, no character sprite */}
      <AnimatePresence>
        {hitEffect === 'star' && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 z-20 pointer-events-none border-8 border-dashed border-yellow-400"
          />
        )}
        {hitEffect === 'question' && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 z-20 pointer-events-none border-8 border-otter-orange"
          />
        )}
        {hitEffect === 'rock' && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 0.7 }} exit={{ opacity: 0 }}
            className="absolute inset-0 z-20 pointer-events-none bg-red-500/20 border-8 border-red-500"
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isControlTutorialActive && gameState === 'tutorial' && (
          <DirectionTutorialOverlay
            currentDirection={currentTutorialDirection}
            flashDirection={tutorialFlashDirection}
            pulseId={tutorialPulseId}
            successId={tutorialSuccessId}
            onDirectionPress={handleTutorialDirection}
          />
        )}
      </AnimatePresence>

      {/* On-screen controls for mobile/testing — 八向 D-pad，派发合成键事件复用键盘逻辑 */}
      {!isControlTutorialActive && (
      <div className="absolute bottom-8 left-8 right-8 flex justify-between items-end z-30 opacity-60 md:hidden select-none">
        {/* 左侧：左/右 */}
        <div className="flex gap-3">
          {([['ArrowLeft', ArrowLeft], ['ArrowRight', ArrowRight]] as const).map(([key, Icon]) => (
            <button
              key={key}
              onPointerDown={() => pressMovementKey(key)}
              onPointerUp={() => releaseMovementKey(key)}
              onPointerLeave={() => releaseMovementKey(key)}
              className="kid-button-secondary w-20 h-20 text-otter-blue-deep !p-0"
            ><Icon size={40} /></button>
          ))}
        </div>
        {/* 右侧：上(前)/下(后) */}
        <div className="flex gap-3">
          {([['ArrowUp', ArrowUp], ['ArrowDown', ArrowDown]] as const).map(([key, Icon]) => (
            <button
              key={key}
              onPointerDown={() => pressMovementKey(key)}
              onPointerUp={() => releaseMovementKey(key)}
              onPointerLeave={() => releaseMovementKey(key)}
              className="kid-button-secondary w-20 h-20 text-otter-blue-deep !p-0"
            ><Icon size={40} /></button>
          ))}
        </div>
      </div>
      )}

    </div>
  );
}
