import { useState, useEffect, useRef } from 'react';
import { useLang } from '../lib/lang';
import { motion, AnimatePresence, useInView } from 'motion/react';
import { Play, Pause, ArrowLeft, Loader2, RotateCcw } from 'lucide-react';
import { useGallery, SLOT_ORDER, type GallerySlotKey } from '../lib/GalleryContext';

// 槽位 → 标题 / 旁白（中英）。图由跑酷途中 Seedream 生成，存共享 GalleryState，这里只读展示。
const SLOT_META: Record<GallerySlotKey, { zh: { title: string; desc: string }; en: { title: string; desc: string } }> = {
  npc1: {
    zh: { title: '啄木鸟的线索', desc: '啄木鸟说：有人知道月亮在哪，\n别停下，\n多去问问～' },
    en: { title: 'Woodpecker Clue', desc: 'The woodpecker said someone knows where the moon is.\nKeep going,\nand ask around!' },
  },
  npc2: {
    zh: { title: 'kiwi 指路', desc: 'kiwi 背着小包，\n神气地指了一个方向，\n小水獭马上跑了过去！' },
    en: { title: 'kiwi Points', desc: 'kiwi carried a small pack,\npointed with confidence,\nand the little otter ran that way!' },
  },
  fakeMoon: {
    zh: { title: '假的月亮？', desc: '咦？那块圆滚滚的大石头远看像月亮，\n凑近一看……\n原来只是块大石头呀！' },
    en: { title: 'A Fake Moon?', desc: 'Huh? That round boulder looked like the moon from afar,\nbut up close…\nit was just a big stone!' },
  },
  npc3: {
    zh: { title: '叽里咕噜的观察', desc: '叽里咕噜打开观察记录：\n真月亮就在前面！\n小水獭终于找到了它。' },
    en: { title: 'Jiligulu Notes', desc: 'Jiligulu checked the notes:\nthe real moon is just ahead!\nThe little otter finally found it.' },
  },
};

const BG_LQIP = 'data:image/webp;base64,UklGRqAAAABXRUJQVlA4IJQAAABQBACdASoUAA0APu1krU2ppaSiMAgBMB2JbACdMoGvqgvBE67InkjpIV4AAP5P3zucf4gUs5RJuhUOvnGdjfYWJ02hSDKmwb+8evf739pd2d580XW9gRsnIBh33upt62zY8f9uSApfXfcXOl1oBWtN/ZyM1j1IUARnG8K8IS5SotoE5vgwZDKf3oYl+EwQBZLz8AAA';
const BG_URL = '/Result/BG-6d82a799.webp';

function ImageUnavailable({ label, compact = false }: { label: string; compact?: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 text-gray-400 text-center px-2">
      <span className={compact ? 'text-2xl md:text-3xl' : 'text-4xl md:text-5xl'}>🖼️</span>
      <span className={compact ? 'text-[10px] md:text-xs font-bold' : 'text-sm md:text-lg font-bold'}>{label}</span>
    </div>
  );
}

function SafeGalleryImage({
  src,
  alt,
  fallbackLabel,
  compact = false,
}: {
  src: string;
  alt: string;
  fallbackLabel: string;
  compact?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) return <ImageUnavailable label={fallbackLabel} compact={compact} />;
  return <img src={src} alt={alt} onError={() => setFailed(true)} className="w-full h-full object-cover" />;
}

export default function SectionResult({ isActive, onSave }: { isActive?: boolean; onSave?: () => void } = {}) {
  const { lang } = useLang();
  const { gallery, generateSlot } = useGallery();
  const containerRef = useRef<HTMLDivElement>(null);
  const measuredInView = useInView(containerRef, { amount: 0.5 });
  const isInView = isActive ?? measuredInView;
  const [selectedKey, setSelectedKey] = useState<GallerySlotKey>('npc1');
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [bgLoaded, setBgLoaded] = useState(false);
  const [bgFailed, setBgFailed] = useState(false);
  const bgImgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      setBgFailed(false);
      setBgLoaded(true);
    };
    img.onerror = () => {
      setBgFailed(true);
      setBgLoaded(true);
    };
    img.src = BG_URL;
    bgImgRef.current = img;
  }, []);

  useEffect(() => {
    if (!isInView && isPlaying) setIsPlaying(false);
  }, [isInView, isPlaying]);

  // TODO: Connect to real audio source — wire <audio> element ref and sync progress/isPlaying with actual playback events
  useEffect(() => {
    if (!isPlaying || !isInView) return;
    const interval = window.setInterval(() => {
      setProgress(p => {
        if (p >= 100) {
          setIsPlaying(false);
          return 100;
        }
        return p + 0.5;
      });
    }, 50);
    return () => window.clearInterval(interval);
  }, [isPlaying, isInView]);

  const t = {
    zh: { complete: '冒险完成！', home: '回到主页', save: '珍藏\n回忆', loading: '正在画…', failed: '生成失败', imageUnavailable: '图片未加载', retry: '重新生成', waiting: '还没画哦' },
    en: { complete: 'Adventure Complete!', home: 'Home', save: 'Save\nMemory', loading: 'Drawing…', failed: 'Failed', imageUnavailable: 'Image unavailable', retry: 'Retry', waiting: 'Not yet' },
  }[lang];

  const selectedWide = gallery[selectedKey].wide; // 右侧大图用横图
  // 重新生成会同时刷新横图 + 方图，任一张在生成中就先隐藏重抽按钮
  const selectedBusy = selectedWide.status === 'loading' || gallery[selectedKey].square.status === 'loading';
  const selectedMeta = SLOT_META[selectedKey][lang];

  return (
    <div ref={containerRef} className="w-full h-full relative overflow-hidden flex flex-col items-center justify-center">
      {/* 渐进背景：LQIP blur → 全尺寸 WebP 淡入 */}
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{
          backgroundImage: bgFailed
            ? 'linear-gradient(135deg, #ffe0a6 0%, #8fd5f7 52%, #5bb7d9 100%)'
            : `url('${BG_LQIP}')`,
          filter: bgLoaded ? 'none' : 'blur(8px)',
          transition: 'none',
        }}
      />
      {!bgFailed && (
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url('${BG_URL}')`, opacity: bgLoaded ? 1 : 0, transition: 'opacity 0.6s ease' }}
        />
      )}

      {/* Audio Bar */}
      <motion.div
        initial={{ y: 50, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 20, delay: 0.2 }}
        className="absolute bottom-4 md:bottom-6 z-30 w-[90%] max-w-[800px] h-10 md:h-12 bg-white rounded-full shadow-[0_4px_0_#d1d5db] flex items-center pl-0 pr-4 md:pr-6 gap-3 md:gap-4"
      >
        <button
          onClick={() => setIsPlaying(!isPlaying)}
          className="w-10 h-10 md:w-14 md:h-14 shrink-0 bg-otter-orange hover:bg-otter-orange-light text-white rounded-full flex items-center justify-center shadow-[0_3px_0_var(--color-otter-orange-shadow)] hover:shadow-[0_2px_0_var(--color-otter-orange-shadow)] hover:translate-y-[1px] active:translate-y-[3px] active:shadow-none transition-all z-10 -ml-1 md:-ml-1"
        >
          {isPlaying ? (
            <Pause className="w-4 h-4 md:w-5 md:h-5 fill-current" />
          ) : (
            <Play className="w-4 h-4 md:w-5 md:h-5 fill-current translate-x-[1px]" />
          )}
        </button>

        <div className="relative flex-1 h-2 md:h-3 bg-otter-blue-sky/20 rounded-full flex items-center group">
          <input
            type="range"
            min="0"
            max="100"
            step="0.1"
            value={progress}
            onChange={(e) => {
              setProgress(parseFloat(e.target.value));
              if (parseFloat(e.target.value) >= 100) {
                setIsPlaying(false);
              }
            }}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
          />
          {/* Progress fill */}
          <div
            className="absolute left-0 h-full bg-otter-orange rounded-full pointer-events-none"
            style={{ width: `${progress}%` }}
          />
          {/* Thumb */}
          <div
            className="absolute w-4 h-4 md:w-5 md:h-5 bg-white border-2 md:border-[3px] border-otter-orange rounded-full shadow-sm pointer-events-none group-hover:scale-110 transition-transform z-0"
            style={{ left: `${progress}%`, transform: 'translateX(-50%)' }}
          />
        </div>
      </motion.div>

      {/* The Book Content Area (Transparent container overlaying the background book) */}
      <div className="relative z-10 flex w-full max-w-[1100px] xl:max-w-[1200px] aspect-[1.6/1] md:h-[75%] max-h-[750px] mb-[2%] md:mb-[4%]">

        {/* Top Left Back Button (on book) */}
        <button
          className="absolute -left-12 -top-2 md:-left-20 md:top-0 z-30 w-12 h-12 md:w-16 md:h-16 bg-white hover:bg-gray-50 text-[#ff9100] rounded-full flex items-center justify-center shadow-[0_4px_0_#d1d5db] hover:shadow-[0_2px_0_#d1d5db] hover:translate-y-[2px] active:translate-y-[4px] active:shadow-none transition-all border-2 md:border-4 border-[#f3f4f6]"
        >
          <ArrowLeft strokeWidth={3} className="w-6 h-6 md:w-8 md:h-8" />
        </button>

        {/* Bottom Right Save Button (on book) — 跳转水獭蛋留存页 */}
        <button
          data-otter-save-memory
          onClick={() => onSave?.()}
          className="absolute -right-2 bottom-0 md:-right-4 md:bottom-4 z-30 w-24 h-24 md:w-32 md:h-32 bg-[#ff9100] hover:bg-[#ffb732] text-white rounded-full flex flex-col items-center justify-center shadow-[0_6px_0_#cc7400] hover:shadow-[0_3px_0_#cc7400] hover:translate-y-[3px] active:translate-y-[6px] active:shadow-none transition-all border-2 md:border-4 border-white font-display font-bold"
        >
          <span className="text-base md:text-2xl leading-tight text-center px-1 md:px-2 w-full whitespace-pre-line">{t.save}</span>
        </button>

        {/* Left Page: Thumbnails — 4 slots by SLOT_ORDER */}
        <div className="w-1/2 h-full pl-[6%] pr-[4%] py-[5%] flex items-center justify-center relative">
          <div className="grid grid-cols-2 gap-4 md:gap-8 w-full max-w-[480px]">
            {SLOT_ORDER.map((key, index) => {
              const thumb = gallery[key].square; // 缩略图用方图：两个角色完整居中，不会被裁掉
              const meta = SLOT_META[key][lang];
              return (
                <button
                  key={key}
                  onClick={() => setSelectedKey(key)}
                  className={`relative bg-white p-2 md:p-3 rounded-[16px] md:rounded-[24px] shadow-md transition-all hover:scale-105 outline-none ${
                    selectedKey === key ? 'ring-4 ring-[#ff9100] ring-offset-2' : ''
                  }`}
                >
                  {/* Thumbnail Image */}
                  <div className="relative w-full aspect-square rounded-[10px] md:rounded-[12px] overflow-hidden mb-1.5 md:mb-3 bg-gray-100 flex items-center justify-center">
                    {/* Number Badge */}
                    <div className="absolute top-0 left-0 bg-[#ff9100] text-white font-bold w-8 h-8 md:w-10 md:h-10 flex items-center justify-center rounded-br-[12px] md:rounded-br-[16px] z-10 text-sm md:text-lg shadow-sm">
                      {index + 1}
                    </div>

                    {thumb.status === 'done' && thumb.url ? (
                      <SafeGalleryImage src={thumb.url} alt={meta.title} fallbackLabel={t.imageUnavailable} compact />
                    ) : thumb.status === 'loading' ? (
                      <div className="flex flex-col items-center justify-center gap-1 text-otter-orange">
                        <Loader2 className="w-6 h-6 md:w-8 md:h-8 animate-spin" />
                        <span className="text-[10px] md:text-xs font-bold">{t.loading}</span>
                      </div>
                    ) : thumb.status === 'error' ? (
                      <div className="flex flex-col items-center justify-center gap-0.5 text-gray-400">
                        <span className="text-2xl md:text-3xl">🖼️</span>
                        <span className="text-[10px] md:text-xs font-bold">{t.failed}</span>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center gap-0.5 text-gray-300">
                        <span className="text-2xl md:text-3xl">✨</span>
                        <span className="text-[10px] md:text-xs font-bold">{t.waiting}</span>
                      </div>
                    )}
                  </div>

                  {/* Thumbnail Title */}
                  <div className="text-center font-bold text-[#d97700] text-sm md:text-xl pb-1 md:pb-2">
                    {meta.title}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right Page: Details */}
        <div className="w-1/2 h-full pl-[4%] pr-[6%] py-[5%] flex flex-col items-center justify-center relative">

          <AnimatePresence mode="wait">
            <motion.div
              key={selectedKey}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.05 }}
              transition={{ duration: 0.3 }}
              className="w-full flex flex-col items-center"
            >
              {/* Banner */}
              <div className="relative w-max max-w-[90%] mb-4 md:mb-8 flex items-center justify-center">
                {/* Left Ribbon Tail */}
                <div className="absolute -left-6 md:-left-8 top-0 bottom-0 w-8 md:w-10 bg-[#ff9100] rounded-sm -z-10" style={{ clipPath: 'polygon(0 0, 100% 0, 100% 100%, 0 100%, 30% 50%)' }} />
                {/* Right Ribbon Tail */}
                <div className="absolute -right-6 md:-right-8 top-0 bottom-0 w-8 md:w-10 bg-[#ff9100] rounded-sm -z-10" style={{ clipPath: 'polygon(0 0, 100% 0, 70% 50%, 100% 100%, 0 100%)' }} />

                {/* Main Banner Body */}
                <div className="bg-[#ff9100] text-white px-8 md:px-16 py-2 md:py-3 font-bold text-base md:text-2xl flex items-center justify-center gap-2 relative z-10 whitespace-nowrap">
                  <img src="/Star.webp" alt="" className="w-5 h-5 md:w-7 md:h-7 object-contain" />
                  {selectedMeta.title}
                </div>
              </div>

              {/* Main Image (4:3 landscape) */}
              <div className="relative w-full max-w-[100%] md:max-w-[100%] aspect-[4/3] bg-white p-2 md:p-3 rounded-[16px] md:rounded-[24px] shadow-md mb-4 md:mb-6">
                <div className="w-full h-full rounded-[10px] md:rounded-[16px] overflow-hidden bg-gray-100 flex items-center justify-center">
                  {selectedWide.status === 'done' && selectedWide.url ? (
                    <SafeGalleryImage src={selectedWide.url} alt={selectedMeta.title} fallbackLabel={t.imageUnavailable} />
                  ) : selectedWide.status === 'loading' ? (
                    <div className="flex flex-col items-center justify-center gap-2 text-otter-orange">
                      <Loader2 className="w-10 h-10 md:w-14 md:h-14 animate-spin" />
                      <span className="text-sm md:text-lg font-bold">{t.loading}</span>
                    </div>
                  ) : selectedWide.status === 'error' ? (
                    <div className="flex flex-col items-center justify-center gap-2 text-gray-400">
                      <span className="text-4xl md:text-5xl">🖼️</span>
                      <span className="text-sm md:text-lg font-bold">{t.failed}</span>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center gap-2 text-gray-300">
                      <span className="text-4xl md:text-5xl">✨</span>
                      <span className="text-sm md:text-lg font-bold">{t.waiting}</span>
                    </div>
                  )}
                </div>

                {/* 重抽按钮（实时生图暂时弃用，先隐藏）*/}
                {false && !selectedBusy && (
                  <button
                    onClick={() => generateSlot(selectedKey)}
                    title={t.retry}
                    className="absolute bottom-3 right-3 md:bottom-4 md:right-4 z-10 bg-white/90 hover:bg-white text-[#ff9100] rounded-full w-9 h-9 md:w-11 md:h-11 flex items-center justify-center shadow-[0_3px_0_#d1d5db] hover:translate-y-[1px] active:translate-y-[3px] active:shadow-none transition-all border-2 border-[#ffd9a8]"
                  >
                    <RotateCcw strokeWidth={3} className="w-4 h-4 md:w-5 md:h-5" />
                  </button>
                )}
              </div>

              {/* Description */}
              <div className="text-center text-[#5c4033] font-medium text-xs md:text-lg leading-relaxed md:leading-relaxed whitespace-pre-line px-2 md:px-8">
                {selectedMeta.desc}
              </div>

              {/* Decorative Stars */}
              <div className="flex items-center justify-center gap-2 md:gap-4 mt-3 md:mt-6 opacity-70">
                <img src="/Star.webp" alt="" className="w-3 h-3 md:w-4 md:h-4 object-contain" />
                <div className="w-1 h-1 md:w-1.5 md:h-1.5 rounded-full bg-[#ffb347]" />
                <img src="/Star.webp" alt="" className="w-3 h-3 md:w-4 md:h-4 object-contain" />
              </div>
            </motion.div>
          </AnimatePresence>

        </div>
      </div>

    </div>
  );
}
