import { useState, useEffect, useRef } from 'react';
import { useLang } from '../App';
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
  onComplete: () => void;
}

export default function SectionStory({ onComplete }: SectionStoryProps) {
  const { lang } = useLang();
  const [page, setPage] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const isInView = useInView(containerRef, { once: true, amount: 0.5 });
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
    const handleMouseMove = (e: MouseEvent) => {
      // Limit parallax offset so it doesn't move too extremely
      setMousePos({
        x: (e.clientX / window.innerWidth - 0.5) * 40,
        y: (e.clientY / window.innerHeight - 0.5) * 40,
      });
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  const next = () => page < maxPage && setPage(p => p + 1);
  const prev = () => page > 0 && setPage(p => p - 1);

  return (
    <div ref={containerRef} className="w-full h-screen relative flex flex-col items-center justify-center bg-gradient-to-b from-[#0a1128] via-[#071330] to-[#040914] overflow-hidden p-4 md:p-8">
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

      {/* TV Container */}
      <div className="w-full max-w-[720px] relative z-10 flex flex-col items-center justify-center mb-6">

        {/* TV Outer Shell */}
        <div className="w-full bg-[#f59e0b] rounded-[3rem] p-4 md:p-8 shadow-[0_12px_0_#b45309,0_20px_25px_-5px_rgba(0,0,0,0.5)] border-8 border-[#fef3c7] flex flex-row gap-4 md:gap-8 items-stretch relative">

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
          <div className="w-20 md:w-28 flex flex-col items-center bg-[#d97706] rounded-[2rem] shadow-inner border-4 border-[#b45309] pt-6 md:pt-8 pb-4 md:pb-6 gap-0">
            {/* Dials */}
            <div className="flex flex-col gap-3 md:gap-4 mb-4 md:mb-6">
              <div className="w-14 h-14 md:w-20 md:h-20 rounded-full bg-gray-800 shadow-[0_6px_0_#374151,0_0_15px_rgba(0,0,0,0.5)] border-4 border-gray-600 relative cursor-pointer active:translate-y-1 active:shadow-[0_2px_0_#374151,0_0_15px_rgba(0,0,0,0.5)] transition-all">
                <div className="w-2 h-6 md:w-3 md:h-8 bg-gray-400 absolute top-1 md:top-2 left-1/2 -translate-x-1/2 rounded-full shadow-sm"></div>
              </div>
              <div className="w-14 h-14 md:w-20 md:h-20 rounded-full bg-gray-800 shadow-[0_6px_0_#374151,0_0_15px_rgba(0,0,0,0.5)] border-4 border-gray-600 relative rotate-45 cursor-pointer active:translate-y-1 active:shadow-[0_2px_0_#374151,0_0_15px_rgba(0,0,0,0.5)] transition-all">
                <div className="w-2 h-6 md:w-3 md:h-8 bg-gray-400 absolute top-1 md:top-2 left-1/2 -translate-x-1/2 rounded-full shadow-sm"></div>
              </div>
            </div>

            {/* Speaker Grille */}
            <div className="flex flex-col gap-2 w-full px-4 md:px-6">
              <div className="w-full h-3 md:h-4 bg-[#78350f] rounded-full shadow-[inset_0_2px_4px_rgba(0,0,0,0.5)]"></div>
              <div className="w-full h-3 md:h-4 bg-[#78350f] rounded-full shadow-[inset_0_2px_4px_rgba(0,0,0,0.5)]"></div>
              <div className="w-full h-3 md:h-4 bg-[#78350f] rounded-full shadow-[inset_0_2px_4px_rgba(0,0,0,0.5)]"></div>
              <div className="w-full h-3 md:h-4 bg-[#78350f] rounded-full shadow-[inset_0_2px_4px_rgba(0,0,0,0.5)]"></div>
            </div>
          </div>

        </div>
      </div>

      {/* Caption Text Bar */}
      <div className="kid-panel w-full max-w-[720px] h-auto min-h-[100px] grid items-center p-4 md:px-8 z-10 relative"
        style={{ gridTemplateColumns: `${page === 0 ? '0px' : '148px'} 1fr 148px`, gap: '16px' }}
      >
        {page > 0 && (
          <button
            onClick={prev}
            className="kid-button-primary px-6 py-3 w-full shrink-0"
          >
            <ChevronLeft className="w-8 h-8" />
          </button>
        )}
        {page === 0 && <div />}

        <div className="flex justify-start items-center min-h-[3rem] overflow-hidden">
          <p className="font-bold text-otter-text text-left font-display leading-snug" style={{ fontSize: '15px' }}>
            <span>{displayedText}</span>
            <span className="opacity-0">{t.pages[page].text.slice(displayedText.length)}</span>
          </p>
        </div>

        <button
          onClick={page === maxPage ? onComplete : next}
          className={`kid-button-primary px-6 py-3 w-full shrink-0 ${page === maxPage ? '!bg-green-500 !shadow-[0_8px_0_#166534] hover:!shadow-[0_4px_0_#166534]' : ''}`}
        >
          {page === maxPage ? t.start : (
            <><span className="sr-only">{t.next}</span><ChevronRight className="w-8 h-8" /></>
          )}
        </button>
      </div>
    </div>
  );
}
