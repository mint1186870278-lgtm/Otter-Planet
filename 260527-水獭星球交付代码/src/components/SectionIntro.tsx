import { useState, useEffect, useRef, useCallback } from 'react';
import { useLang } from '../lib/lang';
import { motion, useInView } from 'motion/react';
import { TapToContinueHint } from './InteractionHints';
import shiningStarUrl from '../../shining-star.png';

interface SectionIntroProps {
  isActive?: boolean;
  onComplete: () => void;
}

const LINES = {
  zh: [
    '我来教你怎么玩！用键盘左右键，或者屏幕上的方向按钮，控制水獭左右移动！',
    '你的目标是：收集星星，躲避障碍物，发现神秘的朋友，和他们交谈！',
    '快去吧！碰到的朋友们能给你月亮的线索！',
  ],
  en: [
    'Let me show you how to play! Use the left and right arrows, or press the buttons on the screen, to move your otter!',
    "Your job: Get the stars. Don't hit the things in the way. Find your secret friends and talk to them!",
    'So go find it! Run forward — every friend you meet will have a clue!',
  ],
};

const CHAR_NAME = { zh: '闪闪', en: 'Sparky' };

const PAUSE_CHARS = new Set(['，', ',', '。', '.', '…', '!', '！', '?', '？']);

export default function SectionIntro({ isActive, onComplete }: SectionIntroProps) {
  const { lang } = useLang();
  const lines = LINES[lang];

  const [lineIndex, setLineIndex] = useState(0);
  const [displayed, setDisplayed] = useState('');
  const [done, setDone] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const measuredInView = useInView(containerRef, { amount: 0.5 });
  const isInView = isActive ?? measuredInView;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const charIndexRef = useRef(0);

  const clearTimer = useCallback(() => {
    if (timerRef.current === null) return;
    clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const startTyping = useCallback((line: string) => {
    clearTimer();
    charIndexRef.current = 0;
    setDisplayed('');
    setDone(false);

    const typeNextChar = () => {
      const i = charIndexRef.current;
      if (i >= line.length) {
        setDone(true);
        timerRef.current = null;
        return;
      }
      setDisplayed(line.slice(0, i + 1));
      charIndexRef.current = i + 1;
      const delay = PAUSE_CHARS.has(line[i]) ? 300 : 60;
      timerRef.current = setTimeout(typeNextChar, delay);
    };

    timerRef.current = setTimeout(typeNextChar, 60);
  }, [clearTimer]);

  useEffect(() => {
    clearTimer();
    if (!isInView) {
      charIndexRef.current = 0;
      setDisplayed('');
      setDone(false);
      setLineIndex(0);
      return clearTimer;
    }
    startTyping(lines[lineIndex]);
    return clearTimer;
  }, [clearTimer, isInView, lineIndex, lines, startTyping]);

  useEffect(() => {
    clearTimer();
    charIndexRef.current = 0;
    setLineIndex(0);
  }, [clearTimer, lang]);

  const handleAdvance = () => {
    if (!done) {
      clearTimer();
      charIndexRef.current = lines[lineIndex].length;
      setDisplayed(lines[lineIndex]);
      setDone(true);
      return;
    }
    if (lineIndex < lines.length - 1) {
      setLineIndex(l => l + 1);
    } else {
      onComplete();
    }
  };

  return (
    <div
      ref={containerRef}
      className="w-full h-full relative cursor-pointer select-none overflow-hidden"
      onClick={handleAdvance}
      onTouchEnd={e => { e.preventDefault(); handleAdvance(); }}
    >
      {/* Background image with blur */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: "url('/parkour-bg.webp')",
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          filter: 'blur(3px)',
          transform: 'scale(1.05)',
        }}
      />
      {/* Dark overlay */}
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.20)' }} />

      {/* Character — right side, bottom aligned */}
      <motion.div
        className="absolute bottom-0 right-12 flex items-end pointer-events-none z-10"
        animate={{ y: [0, -12, 0] }}
        transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
      >
        <img
          src={shiningStarUrl}
          alt={CHAR_NAME[lang]}
          className="h-[70vh] object-contain drop-shadow-2xl"
        />
      </motion.div>

      {/* Dialog box — left side, 15% from bottom */}
      <div
        className="absolute z-20"
        style={{ right: '420px', bottom: '180px', width: '480px' }}
      >
        {/* Character Name Tag */}
        <div style={{
          background: '#FF9100',
          color: 'white',
          fontWeight: 'bold',
          fontSize: '15px',
          padding: '6px 16px 2.5rem 16px',
          borderRadius: '16px 16px 0px 0px',
          border: '4px solid rgba(255,255,255,0.5)',
          borderBottom: 'none',
          width: 'fit-content',
          position: 'relative',
          zIndex: 0,
        }}>
          {CHAR_NAME[lang]}
        </div>

        {/* Dialog card */}
        <div style={{
          background: 'rgba(255,255,255,0.95)',
          backdropFilter: 'blur(12px)',
          borderRadius: '0px 24px 24px 24px',
          border: '4px solid white',
          boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
          marginTop: '-2rem',
          position: 'relative',
          zIndex: 1,
        }}>
          <div style={{ padding: '12px 24px 20px 24px', fontSize: '18px', lineHeight: '1.7', color: '#594031' }}>
            {displayed}
            {!done && <span className="animate-pulse">▍</span>}
          </div>
        </div>

        {/* Tap hint */}
        {done && (
          <TapToContinueHint className="justify-end mt-3 mr-1 text-sm" />
        )}
      </div>

      {/* Line progress dots */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex gap-2 z-20">
        {lines.map((_, i) => (
          <div
            key={i}
            className={`w-2 h-2 rounded-full transition-all duration-300 ${
              i === lineIndex ? 'bg-white scale-125' : i < lineIndex ? 'bg-white/60' : 'bg-white/25'
            }`}
          />
        ))}
      </div>
    </div>
  );
}
