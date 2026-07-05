import React, { useState, useRef, useEffect, Component } from 'react';
import SectionMain from './components/SectionMain';
import SectionStory from './components/SectionStory';
import SectionIntro from './components/SectionIntro';
// 跑酷页懒加载：它是 Three.js(three + @react-three/fiber/drei)的唯一入口，约占首屏 JS 主包
// 一大半。改 React.lazy 后 Rollup 把它和 Three.js 全家桶打成独立 chunk，主包不再含 3D 引擎，
// 首屏(菜单页)秒开。挂载时机由下方 useNearViewport 门控：用户接近跑酷页时才拉这个 chunk。
const SectionParkour = React.lazy(() => import('./components/SectionParkour'));
import SectionVisualNovel from './components/SectionVisualNovel';
import SectionResult from './components/SectionResult';
import SectionEgg from './components/SectionEgg';
import { GalleryProvider } from './lib/GalleryContext';
import { track, trackBeacon, trackOnce, setTrackLang, type SectionName } from './lib/analytics';
import { LangContext, type Language } from './lib/lang';
import { SECTION_COUNT, readPendingSectionIndex, rememberPendingSectionIndex, sectionNameAt } from './lib/sectionFlow';

declare global {
  interface Window {
    __otterAppSmoke?: {
      goToSection: (index: number) => { activeSectionIndex: number; activeSectionName: string };
      state: () => { activeSectionIndex: number; activeSectionName: string };
    };
    __otterSectionState?: {
      index: number;
      name: SectionName;
    };
  }
}

// 错误边界：兜住 React.lazy(SectionParkour) 加载失败（chunk 404 / 网络断开）。
// 无此边界时，import() 的 rejected Promise 会无声地崩溃整个 React 树，
// 全局 loading overlay 永远停在 45%，markSceneReady() 永远不会被调用。
class ParkourErrorBoundary extends Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() {
    (window as { otterParkourLoading?: { markSceneReady?: () => void } })
      .otterParkourLoading?.markSceneReady?.();
  }
  render() {
    if (this.state.failed) {
      const lang = new URLSearchParams(window.location.search).get('lang') === 'en' ? 'en' : 'zh';
      return (
        <div className="w-full h-full flex flex-col items-center justify-center text-white bg-[url('/parkour-bg.webp')] bg-cover bg-center">
          <div className="font-display font-black text-2xl drop-shadow-md">
            {lang === 'en' ? '3D scene failed to load. Please refresh.' : '3D 场景加载失败，请刷新页面。'}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// 当前可见 section（供 page_unload 兜底上报最后一段停留时长用）
const activeSection: { name: SectionName | null; enterTime: number } = { name: null, enterTime: 0 };

// 埋点用的 section 包装：仍渲染真实 <section>，并用 data-otter-game-section
// 标出“游戏主流程屏”。全局脚本只能读这个标记，避免把登录弹窗等 DOM 误判成游戏页。
function TrackedSection({ name, className, children, innerRef }: {
  name: SectionName;
  className: string;
  children: React.ReactNode;
  innerRef?: React.Ref<HTMLElement>;
}) {
  const ref = useRef<HTMLElement>(null);
  const enterRef = useRef<number>(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          // 进入视野（≥50%）：开始计时
          enterRef.current = Date.now();
          activeSection.name = name;
          activeSection.enterTime = enterRef.current;
        } else if (enterRef.current) {
          // 离开视野：上报停留时长
          track('section_duration', { section: name, durationMs: Date.now() - enterRef.current });
          enterRef.current = 0;
          if (activeSection.name === name) activeSection.name = null;
        }
      },
      { threshold: 0.5 }, // 与各组件原有 useInView amount:0.5 一致
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [name]);

  // 把内部 ref 同步给外部 innerRef（用于「接近视口才挂载」的门控），不影响埋点用的 ref。
  const setRefs = (el: HTMLElement | null) => {
    ref.current = el;
    if (typeof innerRef === 'function') innerRef(el);
    else if (innerRef) (innerRef as React.MutableRefObject<HTMLElement | null>).current = el;
  };

  return <section ref={setRefs} data-otter-game-section={name} className={className}>{children}</section>;
}

// 「接近视口才挂载」门控：观察目标元素，rootMargin 放大到提前 N 屏触发。
// 跑酷页用它在用户读 intro 对白(前一屏)时就把 Three.js chunk 预拉好，到页即玩，且首屏不拉。
function useNearViewport(rootMargin = '200% 0px') {
  const ref = useRef<HTMLElement | null>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setNear(true); obs.disconnect(); } },
      { rootMargin },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [near, rootMargin]);
  return [ref, near] as const;
}

// 跑酷场景加载占位：复用 parkour-bg.webp 作背景 + 居中 spinner，与场景视觉衔接，无新依赖。
function ParkourLoading() {
  // 配合 public/otterlantis-loader.js：带 .otter-landing-wait 类 → loader 识别并显示加载进度条；
  // 调 start() 启动进度统计。3D canvas + 教学方向元素就绪后 loader 自动收尾。
  const lang = new URLSearchParams(window.location.search).get('lang')?.toLowerCase() === 'en' ? 'en' : 'zh';

  useEffect(() => {
    (window as { otterParkourLoading?: { start?: () => void } }).otterParkourLoading?.start?.();
  }, []);

  // 兜底：nearParkour 未触发 / React.lazy chunk 加载超时时，25s 后强制 markSceneReady()，
  // 避免进度条永远卡在 45%（SectionParkour 未挂载则其内部 20s timer 永远不会执行）。
  useEffect(() => {
    const timer = window.setTimeout(() => {
      (window as { otterParkourLoading?: { markSceneReady?: () => void } })
        .otterParkourLoading?.markSceneReady?.();
    }, 25000);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="otter-landing-wait w-full h-full relative overflow-hidden flex flex-col items-center justify-center text-white bg-[url('/parkour-bg.webp')] bg-cover bg-center">
      <div className="font-display font-black text-2xl drop-shadow-md">
        {lang === 'en' ? 'Otter is landing on the path...' : '奥特正在降落到小路上...'}
      </div>
    </div>
  );
}


export default function App() {
  // 语言初始化：从 URL ?lang=en 读一次（英文部署链接从此真正以英文启动；否则默认中文）。
  // 只定初始值，Navbar 的 toggleLang 手动切换照旧可用。
  const [lang, setLang] = useState<Language>(() =>
    new URLSearchParams(window.location.search).get('lang')?.toLowerCase() === 'en' ? 'en' : 'zh'
  );
  const [isSmokeTest] = useState(() => {
    try {
      return new URLSearchParams(window.location.search).has('test');
    } catch {
      return false;
    }
  });
  const [activeSectionIndex, setActiveSectionIndex] = useState(readPendingSectionIndex);
  const activeSectionName = sectionNameAt(activeSectionIndex);
  const activeSectionOffsetPercent = (activeSectionIndex * 100) / SECTION_COUNT;
  const viewportRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // 跑酷 section 的「接近视口」门控：滚到 intro(前一屏)附近就触发，提前加载 Three.js chunk。
  const [parkourRef, nearParkour] = useNearViewport('200% 0px');

  const toggleLang = () => setLang(prev => prev === 'zh' ? 'en' : 'zh');

  // 把当前游戏语言同步给埋点层，使每条埋点都带 gameLang（看板按此分中英版）。
  // 放在 game_start 之前的 effect 里，保证首条事件也带上正确语言。
  useEffect(() => { setTrackLang(lang); }, [lang]);

  useEffect(() => {
    const sectionState = { index: activeSectionIndex, name: activeSectionName };
    document.body.dataset.otterActiveSection = activeSectionName;
    document.body.dataset.otterActiveSectionIndex = String(activeSectionIndex);
    window.__otterSectionState = sectionState;
    window.dispatchEvent(new CustomEvent('otterlantis:section-change', { detail: sectionState }));
    return () => {
      if (window.__otterSectionState === sectionState) {
        delete window.__otterSectionState;
      }
      if (document.body.dataset.otterActiveSection === activeSectionName) {
        delete document.body.dataset.otterActiveSection;
      }
      if (document.body.dataset.otterActiveSectionIndex === String(activeSectionIndex)) {
        delete document.body.dataset.otterActiveSectionIndex;
      }
    };
  }, [activeSectionIndex, activeSectionName]);

  // 流程开始（漏斗起点），整局只报一次。用 trackOnce：即便组件重挂也不会重复计数。
  useEffect(() => { trackOnce('game_start'); }, []);

  // 关页面/切后台：兜底上报当前 section 还没结算的停留时长（用 sendBeacon，fetch 会被中断）
  useEffect(() => {
    const flush = () => {
      if (activeSection.name && activeSection.enterTime) {
        trackBeacon('section_duration', {
          section: activeSection.name,
          durationMs: Date.now() - activeSection.enterTime,
        });
        activeSection.name = null;
      }
    };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, []);

  // 这个页面现在由 React 状态驱动整屏轨道 transform，不再允许浏览器文档滚动参与导航。
  // 点击故事/对白控件时，浏览器仍可能因为 focus/scroll anchoring 把 window 或内部轨道滚出 0，
  // 结果是跑酷 canvas 已经挂载但整体被顶出视口。切屏后主动归零，保证 canvas 落在可见屏。
  useEffect(() => {
    const resetScroll = () => {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      if (viewportRef.current) {
        viewportRef.current.scrollTop = 0;
        viewportRef.current.scrollLeft = 0;
      }
      if (containerRef.current) {
        containerRef.current.scrollTop = 0;
        containerRef.current.scrollLeft = 0;
      }
    };

    resetScroll();
    const frame = window.requestAnimationFrame(resetScroll);
    const settleTimer = window.setTimeout(resetScroll, 120);
    const animationTimer = window.setTimeout(resetScroll, 760);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(settleTimer);
      window.clearTimeout(animationTimer);
    };
  }, [activeSectionIndex]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const keepViewportPinned = () => {
      if (viewport.scrollTop !== 0) viewport.scrollTop = 0;
      if (viewport.scrollLeft !== 0) viewport.scrollLeft = 0;
    };

    viewport.addEventListener('scroll', keepViewportPinned, { passive: true });
    return () => viewport.removeEventListener('scroll', keepViewportPinned);
  }, []);

  const scrollToSection = (index: number) => {
    const next = rememberPendingSectionIndex(index);
    setActiveSectionIndex(current => (next === current ? current : next));
  };

  useEffect(() => {
    try {
      if (!new URLSearchParams(window.location.search).has('test')) return;
    } catch {
      return;
    }
    const state = () => ({ activeSectionIndex, activeSectionName });
    const driver = {
      goToSection: (index: number) => {
        const next = rememberPendingSectionIndex(index);
        setActiveSectionIndex(next);
        return state();
      },
      state,
    };
    window.__otterAppSmoke = driver;
    return () => {
      if (window.__otterAppSmoke === driver) {
        delete window.__otterAppSmoke;
      }
    };
  }, [activeSectionIndex, activeSectionName]);

  return (
    <LangContext.Provider value={{ lang, toggleLang }}>
      <GalleryProvider>
        <div
          ref={viewportRef}
          className="fixed inset-0 w-screen h-screen overflow-hidden font-body bg-otter-blue-ocean text-white"
          style={{ overflow: 'clip' }}
        >
          <div
            ref={containerRef}
            className={`w-full will-change-transform ${isSmokeTest ? '' : 'transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]'}`}
            style={{
              height: `${SECTION_COUNT * 100}vh`,
              transform: `translate3d(0, -${activeSectionOffsetPercent}%, 0)`,
            }}
          >
          {/* Section 0: Main Menu */}
          <TrackedSection name="main" className="w-full h-screen snap-start snap-always overflow-hidden relative">
            <SectionMain onEnterStory={() => scrollToSection(1)} />
          </TrackedSection>

          {/* Section 1: Storybook */}
          <TrackedSection name="storybook" className="w-full h-screen snap-start snap-always overflow-hidden relative">
            <SectionStory isActive={activeSectionName === 'storybook'} onComplete={() => scrollToSection(2)} />
          </TrackedSection>

          {/* Section 2: Intro dialogue (叽里咕噜) */}
          <TrackedSection name="intro" className="w-full h-screen snap-start snap-always overflow-hidden relative bg-gradient-to-b from-[#3c7dd7] to-[#79cbf8]">
            <SectionIntro isActive={activeSectionName === 'intro'} onComplete={() => scrollToSection(3)} />
          </TrackedSection>

          {/* Section 3: Parkour Gameplay（懒加载 Three.js；接近视口才挂载，Suspense 兜底） */}
          <TrackedSection name="parkour" innerRef={parkourRef} className="w-full h-screen snap-start snap-always overflow-hidden relative">
            {nearParkour
              ? (
                <ParkourErrorBoundary>
                  <React.Suspense fallback={<ParkourLoading />}>
                    <SectionParkour isActive={activeSectionName === 'parkour'} onComplete={() => scrollToSection(4)} />
                  </React.Suspense>
                </ParkourErrorBoundary>
              )
              : <ParkourLoading />}
          </TrackedSection>

          {/* Section 4: Visual Novel (月亮向导讲故事) */}
          <TrackedSection name="story" className="w-full h-screen snap-start snap-always overflow-hidden relative">
            <SectionVisualNovel isActive={activeSectionName === 'story'} onBack={() => scrollToSection(2)} onComplete={() => scrollToSection(5)} />
          </TrackedSection>

          {/* Section 5: Result (探险相册) */}
          <TrackedSection name="gallery" className="w-full h-screen snap-start snap-always overflow-hidden relative">
            <SectionResult isActive={activeSectionName === 'gallery'} onSave={() => scrollToSection(6)} />
          </TrackedSection>

          {/* Section 6: Otter Egg keepsake (留存) */}
          <TrackedSection name="egg" className="w-full h-screen snap-start snap-always overflow-hidden relative">
            <SectionEgg />
          </TrackedSection>
          </div>
        </div>
      </GalleryProvider>
    </LangContext.Provider>
  );
}
