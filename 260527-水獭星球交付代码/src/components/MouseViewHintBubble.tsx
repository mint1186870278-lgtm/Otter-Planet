import { Mouse, ArrowLeftRight } from 'lucide-react';
import { motion } from 'motion/react';

// 鼠标视角控制提示气泡：键盘引导卡片结束后出现，教"按住鼠标左键拖动转动视角"。
// 小型、低调，视觉层级低于橙色方向键（此时方向键卡片已消失）。highlight 时橙描边+发光。
export function MouseViewHintBubble({ highlight = true }: { highlight?: boolean }) {
  return (
    <motion.div
      className="pointer-events-none absolute z-40 left-1/2 top-[18%] -translate-x-1/2"
      initial={{ opacity: 0, y: 12, scale: 0.92 }}
      animate={{ opacity: 1, y: [0, -5, 0], scale: 1 }}
      exit={{ opacity: 0, y: 12, scale: 0.92 }}
      transition={{ duration: 0.3, y: { repeat: Infinity, duration: 2, ease: 'easeInOut' } }}
    >
      <div
        className={`flex items-center gap-3 rounded-3xl border-[3px] bg-white/90 px-4 py-3 backdrop-blur-md transition-all ${
          highlight
            ? 'border-otter-orange shadow-[0_0_16px_rgba(255,145,0,0.5)]'
            : 'border-white/70 shadow-lg'
        }`}
      >
        {/* 鼠标图标：左键高亮 + 左右拖动箭头 */}
        <div className="relative flex flex-col items-center">
          <ArrowLeftRight className="mb-0.5 h-4 w-4 text-otter-orange" strokeWidth={3} />
          <div className="relative">
            <Mouse className="h-9 w-9 text-otter-text" strokeWidth={2.2} />
            {/* 左键高亮：橙色块盖在鼠标左上区 */}
            <span className="absolute left-[6px] top-[3px] h-[9px] w-[8px] rounded-t-full bg-otter-orange/85" />
          </div>
        </div>
        {/* 文案两行 */}
        <div className="font-display font-black leading-snug text-otter-text">
          <div className="text-sm">按住鼠标左键拖动</div>
          <div className="text-sm">转动视角</div>
        </div>
      </div>
    </motion.div>
  );
}
