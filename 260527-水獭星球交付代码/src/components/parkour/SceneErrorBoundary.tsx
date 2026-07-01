// src/components/parkour/SceneErrorBoundary.tsx
// 兜住 3D 场景（ParkourScene / Canvas）渲染期抛错，避免白屏——从 SectionParkour.tsx 抽出。

import { Component, type ReactNode } from 'react';

export class SceneErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null };
  static getDerivedStateFromError(e: Error) { return { error: e.message }; }
  render() {
    if (this.state.error) {
      return (
        <div className="w-full h-full flex items-center justify-center bg-gradient-to-b from-[#29B6F6] to-[#0288D1]">
          <div className="text-white text-center p-8">
            <p className="text-xl font-bold mb-2">3D 场景加载失败</p>
            <p className="text-sm opacity-70 max-w-xs">{this.state.error}</p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
