import { MousePointerClick, Sparkles } from 'lucide-react';
import { motion } from 'motion/react';
import { useLang } from '../App';

export function TapToContinueHint({ className = '' }: { className?: string }) {
  const { lang } = useLang();
  return (
    <motion.div
      className={`pointer-events-none flex items-center justify-center gap-2 text-otter-orange font-display font-bold ${className}`}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: [0, -4, 0] }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ opacity: { duration: 0.2 }, y: { repeat: Infinity, duration: 1.1, ease: 'easeInOut' } }}
    >
      <motion.div
        animate={{ scale: [1, 0.86, 1], rotate: [0, -10, 0] }}
        transition={{ repeat: Infinity, duration: 0.9, ease: 'easeInOut' }}
        className="rounded-full bg-white shadow-md p-1"
      >
        <MousePointerClick className="w-6 h-6" strokeWidth={3} />
      </motion.div>
      <span className="rounded-full bg-white px-3 py-1 shadow-md border-2 border-otter-orange/30">
        {lang === 'zh' ? '点一下继续！' : 'Tap to continue!'}
      </span>
    </motion.div>
  );
}

export function FeedbackBurst({ id, text, kind }: { id: number; text: string; kind: 'star' | 'box' }) {
  const dots = kind === 'star' ? ['#FFE45C', '#FF9100', '#52C2FE', '#FFFFFF', '#FFB732', '#FFE45C'] : ['#FF9100', '#FFFFFF', '#52C2FE', '#FFB732'];
  return (
    <motion.div
      key={id}
      className="pointer-events-none absolute z-40"
      style={{ top: kind === 'star' ? 42 : '48%', left: kind === 'star' ? 228 : '50%' }}
      initial={{ opacity: 0, scale: 0.75, y: 14, x: kind === 'box' ? '-50%' : 0 }}
      animate={{ opacity: [0, 1, 1, 0], scale: [0.75, 1.12, 1, 0.95], y: -28, x: kind === 'box' ? '-50%' : 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.8, ease: 'easeOut' }}
    >
      <div className="relative">
        <div className="rounded-full bg-white text-otter-orange font-display font-black text-3xl px-5 py-2 shadow-lg border-4 border-otter-orange/30 flex items-center gap-2">
          {kind === 'star' && <Sparkles className="w-7 h-7" />}
          {text}
        </div>
        {dots.map((color, i) => (
          <motion.span
            key={i}
            className="absolute w-3 h-3 rounded-full"
            style={{ background: color, left: '50%', top: '50%' }}
            animate={{
              x: Math.cos((Math.PI * 2 * i) / dots.length) * 44,
              y: Math.sin((Math.PI * 2 * i) / dots.length) * 34,
              opacity: [0, 1, 0],
              scale: [0.4, 1, 0.2],
            }}
            transition={{ duration: 0.65, ease: 'easeOut' }}
          />
        ))}
      </div>
    </motion.div>
  );
}

export function PromptChip({ text }: { text: string }) {
  return (
    <motion.div
      className="pointer-events-none absolute left-1/2 top-[22%] z-30 -translate-x-1/2 rounded-full bg-white/95 px-5 py-2 text-lg font-display font-black text-otter-orange shadow-lg border-4 border-otter-orange/25"
      initial={{ opacity: 0, y: 8, scale: 0.94 }}
      animate={{ opacity: 1, y: [0, -3, 0], scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.94 }}
      transition={{ duration: 0.2, y: { repeat: Infinity, duration: 1.2, ease: 'easeInOut' } }}
    >
      {text}
    </motion.div>
  );
}
