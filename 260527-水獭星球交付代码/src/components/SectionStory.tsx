import { useState, useEffect, useRef } from 'react';
import { useLang } from '../lib/lang';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence, useInView } from 'motion/react';

const grids = [
  "/Story.webp",
  "/BG2.webp",
  "/story-3.webp",
  "/story-4.webp"
];

const generateStars = (count: number) => {
  return Array.from({ length: count }).map((_, i) => {
    const layer = Math.random() > 0.8 ? 3 : Math.random() > 0.4 ? 2 : 1;
    const baseSize = layer === 3 ? 16 : layer === 2 ? 10 : 6;
    return {
      id: i,
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: baseSize + Math.random() * 8,
      opacity: layer === 3 ? Math.random() * 0.4 + 0.6 : Math.random() * 0.3 + 0.3,
      delay: Math.random() * 5,
      duration: Math.random() * 3 + 2,
      layer
    };
  });
};

const stars = generateStars(70);

const content = {
  zh: {
    skip: "跳过",
    next: "下一页",
    start: "开始关卡",
    pages: [
      { img: grids[0], text: "很久很久以后，在神秘的海洋星系" },
      { img: grids[1], text: "小动物们快乐地生活，冒险。" },
      { img: grids[2], text: "可是有一天，月亮不见了！" },
      { img: grids[3], text: "你是水獭小英雄，你要为大家找回月亮！" }
    ]
  },
  en: {
    skip: "Skip",
    next: "Next",
    start: "Start Level",
    pages: [
      { img: grids[0], text: "Long, long from now, on Otterlantis," },
      { img: grids[1], text: "where little creatures live happily and go on fun adventures" },
      { img: grids[2], text: "However, until one day, the moon was gone!" },
      { img: grids[3], text: "It's up to you, the little otter hero to bring the moon back!" }
    ]
  }
};

interface SectionStoryProps {
  isActive?: boolean;
  onComplete: () => void;
}

export default function SectionStory({ isActive, onComplete }: SectionStoryProps) {
  const { lang } = useLang();
  const [page, setPage] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const measuredInView = useInView(containerRef, { amount: 0.5 });
  const isInView = isActive ?? measuredInView;
  const [displayedText, setDisplayedText] = useState("");
  const textLengthRef = useRef(0);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  const t = content[lang];
  const maxPage = t.pages.length - 1;

  useEffect(() => {
    textLengthRef.current = 0;
    setDisplayedText("");
    if (!isInView) return;

    const currentText = t.pages[page].text;
    let interval = setInterval(() => {
      textLengthRef.current += 1;
      if (textLengthRef.current <= currentText.length) {
        setDisplayedText(currentText.slice(0, textLengthRef.current));
      } else {
        clearInterval(interval);
      }
    }, 50);

    return () => clearInterval(interval);
  }, [page, lang, isInView, t.pages]);

  useEffect(() => {
    if (!isInView) return;
    const handleMouseMove = (e: MouseEvent) => {
      // Limit parallax offset so it doesn't move too extremely
      setMousePos({
        x: (e.clientX / window.innerWidth - 0.5) * 40,
        y: (e.clientY / window.innerHeight - 0.5) * 40,
      });
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [isInView]);

  const next = () => page < maxPage && setPage(p => p + 1);
  const prev = () => page > 0 && setPage(p => p - 1);

  return (
    <div ref={containerRef} className="w-full h-screen relative grid place-items-center bg-gradient-to-b from-[#0a1128] via-[#071330] to-[#040914] overflow-hidden px-4 py-3 md:p-8">
      {/* Starry bg */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {/* Layer 1 (Furthest, moves slowest) */}
        <motion.div 
          className="absolute inset-[-100px]"
          animate={{ x: mousePos.x * -0.3, y: mousePos.y * -0.3 }}
          transition={{ type: "spring", stiffness: 70, damping: 30 }}
        >
          {stars.filter(s => s.layer === 1).map(star => (
            <motion.div
              key={star.id}
              className="absolute bg-no-repeat bg-contain bg-center"
              style={{
                left: `${star.x}%`,
                top: `${star.y}%`,
                width: star.size,
                height: star.size,
                backgroundImage: `url('/Star.svg')`
              }}
              animate={{ opacity: [star.opacity * 0.4, star.opacity, star.opacity * 0.4] }}
              transition={{ repeat: Infinity, duration: star.duration, delay: star.delay }}
            />
          ))}
        </motion.div>
        
        {/* Layer 2 (Middle, moves medium) */}
        <motion.div 
          className="absolute inset-[-100px]"
          animate={{ x: mousePos.x * -0.8, y: mousePos.y * -0.8 }}
          transition={{ type: "spring", stiffness: 70, damping: 30 }}
        >
          {stars.filter(s => s.layer === 2).map(star => (
            <motion.div
              key={star.id}
              className="absolute bg-no-repeat bg-contain bg-center drop-shadow-[0_0_2px_rgba(255,255,255,0.4)]"
              style={{
                left: `${star.x}%`,
                top: `${star.y}%`,
                width: star.size,
                height: star.size,
                backgroundImage: `url('/Star.svg')`
              }}
              animate={{ opacity: [star.opacity * 0.5, star.opacity, star.opacity * 0.5] }}
              transition={{ repeat: Infinity, duration: star.duration, delay: star.delay }}
            />
          ))}
        </motion.div>

        {/* Layer 3 (Nearest, moves fastest, glowing) */}
        <motion.div 
          className="absolute inset-[-100px]"
          animate={{ x: mousePos.x * -1.5, y: mousePos.y * -1.5 }}
          transition={{ type: "spring", stiffness: 70, damping: 30 }}
        >
          {stars.filter(s => s.layer === 3).map(star => (
            <motion.div
              key={star.id}
              className="absolute bg-no-repeat bg-contain bg-center drop-shadow-[0_0_6px_rgba(255,255,255,0.8)]"
              style={{
                left: `${star.x}%`,
                top: `${star.y}%`,
                width: star.size,
                height: star.size,
                backgroundImage: `url('/Star.svg')`
              }}
              animate={{ opacity: [star.opacity * 0.6, star.opacity + 0.2, star.opacity * 0.6] }}
              transition={{ repeat: Infinity, duration: star.duration, delay: star.delay }}
            />
          ))}
        </motion.div>
      </div>

      <div className="relative z-10 grid h-full w-full max-w-[720px] grid-rows-[minmax(0,1fr)_auto] items-center gap-3 md:gap-4">
      {/* TV Container */}
      <div className="min-h-0 w-full relative z-10 flex items-center justify-center">

        {/* TV Outer Shell */}
        <div
          className="bg-[#f59e0b] rounded-[2rem] md:rounded-[3rem] p-3 md:p-6 shadow-[0_10px_0_#b45309,0_18px_24px_-5px_rgba(0,0,0,0.5)] border-4 md:border-8 border-[#fef3c7] flex flex-row gap-3 md:gap-6 items-stretch relative aspect-[4/3] max-h-full"
          style={{ width: 'min(100%, calc((100vh - 190px) * 1.3333))' }}
        >

          {/* Screen Bezel */}
          <div className="flex-1 bg-[#1f2937] rounded-[2rem] shadow-[inset_0_4px_10px_rgba(0,0,0,0.8)] overflow-hidden flex">

            {/* Screen Content — black bezel with inner padding */}
            <div className="flex-1" style={{ background: '#111', border: '3px solid #222', boxShadow: 'inset 0 0 12px rgba(0,0,0,0.8)', padding: '6px', borderRadius: '20px' }}>
              {/* Image container — fills the inner area */}
              <div className="relative w-full h-full overflow-hidden" style={{ borderRadius: '20px' }}>
                {/* Screen Glare/Reflection */}
                <div className="absolute inset-0 bg-gradient-to-br from-white/20 via-transparent to-transparent pointer-events-none z-20" style={{ borderRadius: '20px' }}></div>

                <AnimatePresence mode="wait">
                  <motion.div
                    key={page}
                    initial={{ opacity: 0, scale: 1.05 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ duration: 0.5 }}
                    className="absolute inset-0 w-full h-full"
                    style={{
                      backgroundImage: `url("${t.pages[page].img}")`,
                      backgroundSize: t.pages[page].img.startsWith('data:') ? '80px 80px' : 'cover',
                      backgroundPosition: 'center',
                      backgroundRepeat: t.pages[page].img.startsWith('data:') ? 'repeat' : 'no-repeat'
                    }}
                  />
                </AnimatePresence>
              </div>
            </div>
          </div>

          {/* TV Control Panel */}
          <div className="w-16 md:w-24 flex flex-col items-center bg-[#d97706] rounded-[1.5rem] md:rounded-[2rem] shadow-inner border-4 border-[#b45309] pt-4 md:pt-6 pb-3 md:pb-5 gap-0">
            {/* Dials */}
            <div className="flex flex-col gap-2 md:gap-3 mb-3 md:mb-5">
              <div className="w-11 h-11 md:w-16 md:h-16 rounded-full bg-gray-800 shadow-[0_6px_0_#374151,0_0_15px_rgba(0,0,0,0.5)] border-4 border-gray-600 relative cursor-pointer active:translate-y-1 active:shadow-[0_2px_0_#374151,0_0_15px_rgba(0,0,0,0.5)] transition-all">
                <div className="w-2 h-5 md:w-3 md:h-7 bg-gray-400 absolute top-1 md:top-2 left-1/2 -translate-x-1/2 rounded-full shadow-sm"></div>
              </div>
              <div className="w-11 h-11 md:w-16 md:h-16 rounded-full bg-gray-800 shadow-[0_6px_0_#374151,0_0_15px_rgba(0,0,0,0.5)] border-4 border-gray-600 relative rotate-45 cursor-pointer active:translate-y-1 active:shadow-[0_2px_0_#374151,0_0_15px_rgba(0,0,0,0.5)] transition-all">
                <div className="w-2 h-5 md:w-3 md:h-7 bg-gray-400 absolute top-1 md:top-2 left-1/2 -translate-x-1/2 rounded-full shadow-sm"></div>
              </div>
            </div>

            {/* Speaker Grille */}
            <div className="flex flex-col gap-1.5 md:gap-2 w-full px-3 md:px-5">
              <div className="w-full h-2.5 md:h-3.5 bg-[#78350f] rounded-full shadow-[inset_0_2px_4px_rgba(0,0,0,0.5)]"></div>
              <div className="w-full h-2.5 md:h-3.5 bg-[#78350f] rounded-full shadow-[inset_0_2px_4px_rgba(0,0,0,0.5)]"></div>
              <div className="w-full h-2.5 md:h-3.5 bg-[#78350f] rounded-full shadow-[inset_0_2px_4px_rgba(0,0,0,0.5)]"></div>
              <div className="w-full h-2.5 md:h-3.5 bg-[#78350f] rounded-full shadow-[inset_0_2px_4px_rgba(0,0,0,0.5)]"></div>
            </div>
          </div>

        </div>
      </div>

      {/* Caption Text Bar */}
      <div className="kid-panel w-full h-auto min-h-[88px] grid items-center gap-2 p-3 md:gap-4 md:px-6 md:py-3 z-10 relative"
        style={{ gridTemplateColumns: `${page === 0 ? '0px' : 'clamp(72px, 16vw, 136px)'} minmax(0, 1fr) clamp(92px, 18vw, 136px)` }}
      >
        {page > 0 && (
          <button
            type="button"
            onClick={prev}
            className="kid-button-primary px-3 py-2 md:px-5 md:py-2.5 w-full shrink-0"
          >
            <ChevronLeft className="w-6 h-6 md:w-7 md:h-7" />
          </button>
        )}
        {page === 0 && <div />}

        <div className="flex justify-start items-center min-h-[3rem] overflow-hidden">
          <p className="font-bold text-otter-text text-left font-display leading-snug" style={{ fontSize: '15px' }}>
            <span>{displayedText}</span>
            <span className="opacity-0">{t.pages[page].text.slice(displayedText.length)}</span>
          </p>
        </div>

        {page === maxPage ? (
          <div
            role="button"
            tabIndex={0}
            onClick={onComplete}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              onComplete();
            }}
            className="kid-button-primary px-3 py-2 md:px-5 md:py-2.5 w-full shrink-0 text-sm md:text-base !bg-green-500 !shadow-[0_8px_0_#166534] hover:!shadow-[0_4px_0_#166534] cursor-pointer"
          >
            {t.start}
          </div>
        ) : (
          <button
            type="button"
            onClick={next}
            className="kid-button-primary px-3 py-2 md:px-5 md:py-2.5 w-full shrink-0 text-sm md:text-base"
          >
            <><span className="sr-only">{t.next}</span><ChevronRight className="w-6 h-6 md:w-7 md:h-7" /></>
          </button>
        )}
      </div>
      </div>
    </div>
  );
}
