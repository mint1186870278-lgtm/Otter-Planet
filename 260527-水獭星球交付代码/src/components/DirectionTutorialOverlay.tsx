import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { TutorialDirection } from '../lib/controlTutorial';
import shiningStarUrl from '../../shining-star.png';
import { useLang } from '../App';

const DIRECTION_META: Record<TutorialDirection, {
  label: { zh: string; en: string };
  keyHint: string;
  Icon: typeof ArrowLeft;
  gridClass: string;
}> = {
  left: { label: { zh: '左', en: 'Left' }, keyHint: '← / A', Icon: ArrowLeft, gridClass: 'col-start-1 row-start-2' },
  right: { label: { zh: '右', en: 'Right' }, keyHint: '→ / D', Icon: ArrowRight, gridClass: 'col-start-3 row-start-2' },
  up: { label: { zh: '上', en: 'Up' }, keyHint: '↑ / W', Icon: ArrowUp, gridClass: 'col-start-2 row-start-1' },
  down: { label: { zh: '下', en: 'Down' }, keyHint: '↓ / S', Icon: ArrowDown, gridClass: 'col-start-2 row-start-3' },
};

const ORDER: TutorialDirection[] = ['up', 'left', 'right', 'down'];

function TinyStar({ index, burstId }: { index: number; burstId: number }) {
  const angle = (Math.PI * 2 * index) / 8;
  return (
    <motion.span
      key={`${burstId}-${index}`}
      className="absolute left-1/2 top-1/2 h-2.5 w-2.5 rounded-full bg-yellow-300 shadow-[0_0_8px_rgba(255,228,92,0.9)]"
      initial={{ opacity: 0, scale: 0.3, x: 0, y: 0 }}
      animate={{
        opacity: [0, 1, 0],
        scale: [0.3, 1, 0.2],
        x: Math.cos(angle) * 58,
        y: Math.sin(angle) * 42,
      }}
      transition={{ duration: 0.55, ease: 'easeOut' }}
    />
  );
}

export function DirectionTutorialOverlay({
  currentDirection,
  flashDirection,
  pulseId,
  successId,
  onDirectionPress,
}: {
  currentDirection: TutorialDirection;
  flashDirection: TutorialDirection | null;
  pulseId: number;
  successId: number;
  onDirectionPress: (direction: TutorialDirection) => void;
}) {
  const { lang } = useLang();
  return (
    <motion.div
      className="pointer-events-none absolute inset-x-0 bottom-6 z-50 flex justify-center px-4"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 16 }}
      transition={{ duration: 0.25 }}
    >
      <div className="pointer-events-auto flex max-w-[min(94vw,700px)] items-end gap-5 rounded-[28px] border-4 border-white/70 bg-white/88 px-5 py-4 shadow-2xl backdrop-blur-md">
        <div className="hidden w-[330px] shrink-0 flex-col items-center gap-2 sm:flex">
          <motion.img
            src={shiningStarUrl}
            alt={lang === 'zh' ? '闪闪' : 'Twinkle'}
            className="h-28 w-32 shrink-0 object-contain drop-shadow-xl"
            animate={{ y: [0, -6, 0], rotate: [0, -2, 2, 0] }}
            transition={{ repeat: Infinity, duration: 2.4, ease: 'easeInOut' }}
          />
          <div className="flex w-full flex-col gap-1">
            <div className="rounded-full bg-otter-orange px-4 py-1 text-center font-display text-sm font-black text-white shadow-md">
              {lang === 'zh' ? '闪闪' : 'Twinkle'}
            </div>
            <div className="rounded-2xl bg-white px-4 py-3 text-center font-display text-lg font-black leading-snug text-otter-text shadow-inner">
              {lang === 'zh' ? '先试试让小水獭动起来！' : 'Try moving the little otter first!'}
              <br />
              <span className="text-otter-orange">{lang === 'zh' ? '按亮起来的按钮～' : 'Press the lit-up button~'}</span>
            </div>
          </div>
        </div>

        <div className="relative">
          <div className="grid grid-cols-3 grid-rows-3 gap-2">
            {ORDER.map((direction) => {
              const meta = DIRECTION_META[direction];
              const Icon = meta.Icon;
              const active = direction === currentDirection;
              const flashing = direction === flashDirection;
              return (
                <motion.button
                  key={direction}
                  type="button"
                  aria-label={`${lang === 'zh' ? '教学方向' : 'Tutorial direction '}${meta.label[lang]}`}
                  data-tutorial-direction={direction}
                  className={`${meta.gridClass} relative flex h-16 w-16 flex-col items-center justify-center rounded-2xl border-4 font-display font-black shadow-lg transition-colors md:h-20 md:w-20 ${
                    active
                      ? 'border-yellow-300 bg-otter-orange text-white'
                      : 'border-white/80 bg-white/65 text-otter-blue-deep opacity-45'
                  }`}
                  animate={
                    active
                      ? {
                          scale: flashing ? [1.14, 1.3, 1.14] : [1.08, 1.18, 1.08],
                          y: [0, -5, 0],
                          rotate: pulseId ? [0, -4, 4, -3, 3, 0] : 0,
                        }
                      : { scale: 0.92, y: 0, rotate: 0 }
                  }
                  transition={{
                    scale: { repeat: active && !flashing ? Infinity : 0, duration: flashing ? 0.32 : 0.95, ease: 'easeInOut' },
                    y: { repeat: active ? Infinity : 0, duration: 0.95, ease: 'easeInOut' },
                    rotate: { duration: 0.45, ease: 'easeInOut' },
                  }}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    onDirectionPress(direction);
                  }}
                >
                  <Icon size={32} strokeWidth={4} />
                  <span className="mt-0.5 text-[10px] leading-none">{meta.keyHint}</span>
                </motion.button>
              );
            })}
          </div>

          <AnimatePresence>
            {successId > 0 && (
              <motion.div
                key={successId}
                className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2"
                initial={{ opacity: 0, scale: 0.8, y: 8 }}
                animate={{ opacity: [0, 1, 1, 0], scale: [0.8, 1.12, 1, 0.96], y: -38 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.8, ease: 'easeOut' }}
              >
                <div className="relative rounded-full border-4 border-yellow-300 bg-white px-4 py-1 font-display text-xl font-black text-otter-orange shadow-xl">
                  {lang === 'zh' ? '太棒了！' : 'Great job!'}
                  {Array.from({ length: 8 }, (_, index) => (
                    <TinyStar key={index} index={index} burstId={successId} />
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="flex flex-col items-center gap-1 text-center font-display text-xs font-black text-otter-text sm:hidden">
          <img src={shiningStarUrl} alt={lang === 'zh' ? '闪闪' : 'Twinkle'} className="h-16 w-14 object-contain drop-shadow-lg" />
          <span className="rounded-full bg-otter-orange px-3 py-0.5 text-white shadow-sm">{lang === 'zh' ? '闪闪' : 'Twinkle'}</span>
          <span>{lang === 'zh' ? '先试试让小水獭动起来！' : 'Try moving the little otter first!'}</span>
          <span className="text-otter-orange">{lang === 'zh' ? '按亮起来的按钮～' : 'Press the lit-up button~'}</span>
        </div>
      </div>
    </motion.div>
  );
}
