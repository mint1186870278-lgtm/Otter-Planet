// src/components/parkour/widgets.tsx
// 跑酷场景共享的 3D 小部件（世界空间标签/星星/指引）——从 ParkourScene.tsx 抽出。
// 被星星(StarObject)、障碍(ObstacleObject) 等多个子系统复用。
//   TextSprite ← FloatingLabel（气泡标签）
//   QuestionBoxBadge（问号牌）、TeachingPointer（教学手指）、StarGuideMarker（星星指引锥）
//   StarMesh（旋转的星星模型）
// makePointerCanvas + pointerCanvasCache 为本模块私有工具（模块级缓存，跨渲染复用同一 canvas）。

import { useMemo, useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { STAR_SCALE, PK } from '../parkourConstants';

export function StarMesh() {
  const { scene } = useGLTF(`${PK}/star.glb`);
  const ref = useRef<THREE.Group>(null!);
  useFrame((_s, d) => { if (ref.current) ref.current.rotation.y += d * 2; });
  return <primitive ref={ref} object={scene.clone()} scale={STAR_SCALE} />;
}

export function FloatingLabel({ text, y = 2.8, color = '#FF9100', scale = 1 }: { text: string; y?: number; color?: string; scale?: number }) {
  return (
    <group position={[0, y, 0]} scale={scale}>
      <mesh>
        <planeGeometry args={[3.6, 0.8]} />
        <meshBasicMaterial color="white" transparent opacity={0.94} depthWrite={false} />
      </mesh>
      <mesh position={[-1.64, -0.38, 0.01]} rotation={[0, 0, Math.PI / 4]}>
        <planeGeometry args={[0.32, 0.32]} />
        <meshBasicMaterial color="white" transparent opacity={0.94} depthWrite={false} />
      </mesh>
      <mesh position={[-1.38, 0, 0.02]}>
        <circleGeometry args={[0.12, 18]} />
        <meshBasicMaterial color={color} transparent opacity={0.95} depthWrite={false} />
      </mesh>
      <TextSprite text={text} color={color} />
    </group>
  );
}

export function TextSprite({ text, color, scale = [2.8, 0.7, 1], position = [0.18, 0, 0.04] }: {
  text: string;
  color: string;
  scale?: [number, number, number];
  position?: [number, number, number];
}) {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = 'bold 44px Nunito, system-ui, sans-serif';
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 2);
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }, [text, color]);

  useEffect(() => () => texture.dispose(), [texture]);

  return (
    <sprite position={position} scale={scale}>
      <spriteMaterial map={texture} transparent depthWrite={false} />
    </sprite>
  );
}

export function QuestionBoxBadge() {
  return (
    <group position={[0, 0.86, 0]} scale={0.4}>
      <mesh>
        <circleGeometry args={[0.48, 32]} />
        <meshBasicMaterial color="#FFFFFF" transparent opacity={0.96} depthWrite={false} />
      </mesh>
      <TextSprite text="?" color="#FF9100" scale={[0.78, 0.78, 1]} position={[0, 0, 0.04]} />
    </group>
  );
}

export function TeachingPointer({ y = 3.55 }: { y?: number }) {
  const ref = useRef<THREE.Group>(null!);
  const texture = useMemo(() => new THREE.CanvasTexture(makePointerCanvas()), []);
  useEffect(() => () => texture.dispose(), [texture]);
  useFrame((st) => {
    if (!ref.current) return;
    const pulse = Math.sin(st.clock.elapsedTime * 5);
    ref.current.position.y = y + Math.max(0, pulse) * 0.2;
    ref.current.scale.setScalar(1 + Math.max(0, pulse) * 0.12);
  });
  return (
    <group ref={ref} position={[0.95, y, 0]}>
      <sprite scale={[0.78, 0.78, 1]}>
        <spriteMaterial map={texture} transparent depthWrite={false} />
      </sprite>
    </group>
  );
}

export function StarGuideMarker() {
  const ref = useRef<THREE.Group>(null!);
  useFrame((st) => {
    if (!ref.current) return;
    const bob = Math.sin(st.clock.elapsedTime * 3.5);
    ref.current.position.y = 4.25 + bob * 0.22;
    ref.current.rotation.y = st.clock.elapsedTime * 0.8;
  });

  return (
    <group ref={ref} position={[0, 4.25, 0]}>
      <mesh rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[0.52, 1.05, 4]} />
        <meshBasicMaterial color="#FF9100" transparent opacity={0.62} depthWrite={false} />
      </mesh>
      <mesh position={[0, 0.5, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.62, 0.86, 32]} />
        <meshBasicMaterial color="#FFE45C" transparent opacity={0.42} depthWrite={false} />
      </mesh>
      <pointLight color="#FFE45C" intensity={2.4} distance={6} decay={1.8} />
    </group>
  );
}

const pointerCanvasCache: HTMLCanvasElement[] = [];
function makePointerCanvas() {
  if (pointerCanvasCache[0]) return pointerCanvasCache[0];
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.font = '88px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('☝', 64, 66);
  pointerCanvasCache[0] = canvas;
  return canvas;
}
