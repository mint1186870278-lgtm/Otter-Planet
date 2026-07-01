import { useState } from 'react';
import { useLang } from '../App';
import { Play, Volume2, Calendar } from 'lucide-react';
import { motion } from 'motion/react';
import Navbar from './Navbar';

interface SectionMainProps {
  onEnterStory: () => void;
}

// Stable particle data — generated once, never changes
const PARTICLES = Array.from({ length: 12 }, (_, i) => {
  const rng = (offset: number) => {
    const x = Math.sin(i * 127.1 + offset * 311.7) * 43758.5453;
    return x - Math.floor(x);
  };
  return {
    // position within the moon island zone: right 10~45%, top 5~45%
    right: `${10 + rng(1) * 35}%`,
    top: `${5 + rng(2) * 40}%`,
    size: 6 + rng(3) * 8,
    color: rng(4) > 0.5 ? '#FFD700' : '#FF9100',
    floatDuration: 1.5 + rng(5) * 1.5,
    fadeDuration: 1.5 + rng(6) * 1.5,
    delay: rng(7) * 2,
    staggerDelay: i * 0.1,
  };
});

export default function SectionMain({ onEnterStory }: SectionMainProps) {
  const { lang } = useLang();
  const [phase, setPhase] = useState<'idle' | 'flying' | 'map'>('idle');

  const text = {
    zh: {
      moonIsland: '月亮岛',
      start: '开始探索',
      profile: '小奥特',
      level: '等级 07',
      news: '新闻',
      events: '活动',
      hint: '点击月亮岛开始冒险',
    },
    en: {
      moonIsland: 'Moon Island',
      start: 'Start Exploring',
      profile: 'Little Otter',
      level: 'Level 07',
      news: 'News',
      events: 'Events',
      hint: 'Tap Moon Island to begin',
    },
  };

  const t = text[lang];
  const isMap = phase === 'map';
  const isLeaving = phase === 'flying' || phase === 'map';

  const handleStart = () => {
    setPhase('flying');
    setTimeout(() => setPhase('map'), 800);
  };

  return (
    <div className="w-full h-full relative">
      {/* Background */}
      <motion.div
        className="absolute inset-0"
        animate={isMap ? { scale: 1.05 } : { scale: 1.0 }}
        transition={{ duration: 1, ease: 'easeOut' }}
      >
        <img src="/BG.webp" alt="Background" className="w-full h-full object-cover" />
      </motion.div>

      {/* ── Effect 1: Spotlight vignette ─────────────────────────────── */}
      <motion.div
        className="absolute inset-0 z-10 pointer-events-none"
        initial={{ opacity: 0 }}
        animate={{ opacity: isMap ? 1 : 0 }}
        transition={{ duration: 0.8 }}
        style={{
          background:
            'radial-gradient(ellipse 280px 280px at 72% 35%, transparent 0%, rgba(0,0,0,0.65) 100%)',
        }}
      />

      {/* ── Effect 1b: Moon glow — brightens the moon island area ────── */}
      <motion.div
        className="absolute z-11 pointer-events-none"
        initial={{ opacity: 0 }}
        animate={{ opacity: isMap ? 1 : 0 }}
        transition={{ duration: 0.8, delay: 0.2 }}
        style={{
          left: '55%',
          top: '10%',
          width: '420px',
          height: '380px',
          background: 'radial-gradient(ellipse, rgba(255,220,100,0.25) 0%, transparent 70%)',
          mixBlendMode: 'screen',
        }}
      />

      {/* ── Effect 2: Star particles in moon island zone ──────────────── */}
      {PARTICLES.map((p, i) => (
        <motion.div
          key={i}
          className="absolute z-10 pointer-events-none rounded-full"
          style={{
            right: p.right,
            top: p.top,
            width: p.size,
            height: p.size,
            backgroundColor: p.color,
          }}
          initial={{ opacity: 0 }}
          animate={
            isMap
              ? {
                  opacity: [0.4, 1, 0.4],
                  y: [0, -8, 8, 0],
                }
              : { opacity: 0, y: 0 }
          }
          transition={
            isMap
              ? {
                  opacity: {
                    duration: p.fadeDuration,
                    repeat: Infinity,
                    delay: p.delay,
                    ease: 'easeInOut',
                  },
                  y: {
                    duration: p.floatDuration,
                    repeat: Infinity,
                    delay: p.delay + 0.3,
                    ease: 'easeInOut',
                  },
                  // staggered entry
                  default: { delay: p.staggerDelay, duration: 0.3 },
                }
              : { duration: 0.2 }
          }
        />
      ))}

      {/* Navbar */}
      <Navbar hideIcons={isLeaving} iconsFlyOut={phase === 'flying'} />

      {/* Logo */}
      <motion.div
        className="absolute top-[10px] left-1/2 -translate-x-1/2 z-10 flex flex-col items-center"
        animate={isLeaving ? { y: -200, opacity: 0 } : { y: 0, opacity: 1 }}
        transition={{ duration: 0.6 }}
      >
        <motion.img
          src="/title.webp"
          alt="Otterlantis"
          className="w-[1350px] md:w-[2250px] drop-shadow-[0_8px_0_var(--color-otter-orange)]"
          animate={{ scale: [1.4, 1.442, 1.4] }}
          transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
        />
      </motion.div>

      {/* Moon Island Label */}
      <div className="absolute top-[52%] left-[68%] z-20">
        {isMap && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4, delay: 0.2 }}
          >
            <motion.div
              animate={{ scale: [1.0, 1.15, 1.0] }}
              transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
              className="relative cursor-pointer"
              onClick={onEnterStory}
              style={{ filter: 'drop-shadow(0 0 12px rgba(255,145,0,0.6))' }}
            >
              {/* Glow ring */}
              <motion.div
                className="absolute inset-0 rounded-3xl pointer-events-none"
                animate={{
                  boxShadow: [
                    '0 0 0 3px #FF9100, 0 0 10px 4px rgba(255,145,0,0.25)',
                    '0 0 0 3px #FF9100, 0 0 20px 8px rgba(255,145,0,0.5)',
                    '0 0 0 3px #FF9100, 0 0 10px 4px rgba(255,145,0,0.25)',
                  ],
                }}
                transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
              />

              <div className="bg-white rounded-3xl px-5 py-3 flex items-center gap-3 shadow-[0_4px_12px_rgba(0,0,0,0.1)] relative">
                <img src="/Star.webp" alt="" className="w-7 h-7 object-contain" />
                <span className="font-bold text-otter-text text-2xl whitespace-nowrap">{t.moonIsland}</span>
                <div className="absolute -bottom-[10px] left-6 w-0 h-0 border-l-[12px] border-l-transparent border-t-[16px] border-t-white border-r-[8px] border-r-transparent drop-shadow-[0_4px_4px_rgba(0,0,0,0.05)]" />
              </div>
            </motion.div>

            <motion.p
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.3 }}
              className="text-white text-sm font-bold text-center mt-4 drop-shadow-md"
            >
              {t.hint}
            </motion.p>
          </motion.div>
        )}
      </div>

      {/* Start Button */}
      <motion.div
        className="absolute bottom-16 left-1/2 -translate-x-1/2 z-30"
        animate={isLeaving ? { y: 200, opacity: 0 } : { y: 0, opacity: 1 }}
        transition={{ duration: 0.5 }}
      >
        <button onClick={handleStart} className="kid-button-primary px-16 py-5 text-3xl hover:scale-105">
          <img src="/Star.webp" alt="" className="w-8 h-8 mr-4 object-contain" />
          {t.start}
          <Play className="w-8 h-8 ml-4 fill-white opacity-80" />
        </button>
      </motion.div>

      {/* Profile Card */}
      <motion.div
        className="absolute bottom-8 left-8 z-30"
        animate={isLeaving ? { x: -200, opacity: 0 } : { x: 0, opacity: 1 }}
        transition={{ duration: 0.5 }}
      >
        <div className="kid-panel px-4 py-3 flex items-center gap-4 cursor-pointer hover:scale-105 transition-transform">
          <div className="w-16 h-16 bg-[#e6f4ff] rounded-full ring-4 ring-white shadow-inner flex items-center justify-center overflow-hidden">
            <img src="/Avatar.webp" alt="Profile" className="w-full h-full object-cover" />
          </div>
          <div>
            <div className="font-bold text-otter-text text-lg">{t.profile}</div>
            <div className="text-sm font-bold text-otter-text flex items-center gap-2 mt-1">
              {t.level}
              <div className="w-24 h-3 bg-gray-200 rounded-full overflow-hidden">
                <div className="w-1/3 h-full bg-otter-orange rounded-full" />
              </div>
            </div>
          </div>
        </div>
      </motion.div>

      {/* News/Events Buttons */}
      <motion.div
        className="absolute bottom-8 right-8 z-30 flex gap-4"
        animate={isLeaving ? { x: 200, opacity: 0 } : { x: 0, opacity: 1 }}
        transition={{ duration: 0.5 }}
      >
        <button className="kid-button-secondary w-20 h-24 !rounded-2xl flex-col gap-2 group">
          <Volume2 className="w-8 h-8 text-otter-orange group-hover:scale-110 transition-transform" />
          <span className="text-sm">{t.news}</span>
        </button>
        <button className="kid-button-secondary w-20 h-24 !rounded-2xl flex-col gap-2 group">
          <Calendar className="w-8 h-8 text-otter-orange group-hover:scale-110 transition-transform" />
          <span className="text-sm">{t.events}</span>
        </button>
      </motion.div>
    </div>
  );
}
