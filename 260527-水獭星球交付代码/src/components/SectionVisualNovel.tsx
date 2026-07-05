import { useState, useEffect, useRef, memo } from 'react';
import { useLang } from '../lib/lang';
import { motion, useInView } from 'motion/react';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { streamChat, stripAllBrackets, sanitizeAllBracketsForDisplay, type ChatMessage } from '../lib/stepfunChat';
import { track } from '../lib/analytics';

declare global {
  interface Window {
    __otterStorySmoke?: {
      complete: () => { progress: number; stars: number; step: number };
      state: () => { progress: number; stars: number; step: number };
    };
  }
}

// 月亮向导（互动四 · 讲故事）System Prompt —— 风格与跑酷三 NPC 一致，跟随 App 语言
const MOON_GUIDE_SYSTEM = {
  zh: '你是月亮向导，温柔温暖的大向导，陪小朋友一起回顾这趟寻月冒险。小朋友刚找到真月亮，现在请他用自己的话把冒险讲一讲。【最重要·只说一句话】你每次回复【只能是一句话】，要短、口语、温柔，绝对不能出现两句或更多。【第一轮】不管小朋友说了什么、说得多短、对不对，你都只回一句【轻松的追问】，引导他往下讲一个还没讲到的情节即可——不要先夸再问、不要说两件事，就一句问句。【绝对不要问"最先/第一个遇到谁"或啄木鸟相关】——这个问题前面已经单独问过了，再问就重复了。请聚焦后半段情节来追问，例：「后来有只小鸟给你指路，结果对不对呀？」或「你顺着它指的方向，找到的是真月亮吗？」或「最后是谁帮你找到真月亮的呢？」。绝对不能把"把故事讲一遍/讲给我听"这种笼统的话再说一遍。故事里的关键情节供你参考（不要一次全说、也别再提啄木鸟）：一只小鸟指错了方向、结果找到假月亮、最后叽里咕噜帮忙找到真月亮。每句话不超过25字，温柔鼓励，不能让小朋友难过，不能有不适合儿童的内容，中文。回复必须是自然口语的一句话，不许出现方括号 [] 或 【】 及其中内容。',
  en: "You are the Moon Guide, a gentle warm guardian helping the child look back on the moon-finding adventure. The child just found the real moon; now invite them to retell it in their own words. [MOST IMPORTANT · ONE sentence only] Each reply must be EXACTLY ONE short, spoken, gentle sentence — never two or more. [First round] No matter what the child says, however short or wrong, reply with just ONE light follow-up question guiding them to a beat they haven't told yet — do NOT praise-then-ask, do NOT say two things, just one question. [NEVER ask about 'who you met first' or the woodpecker] — that was already asked separately before, asking again would repeat. Focus your question on the LATER beats, e.g. 'A little bird gave you directions — were they right?' or 'Following where it pointed, did you find the real moon?' or 'Who finally helped you find the real moon?'. Never repeat the generic 'tell me the whole story' line. Key beats for your reference (don't say them all at once, and don't mention the woodpecker again): a little bird pointed the wrong way, that led to a fake moon, and finally Jiligulu helped find the real moon. Under 20 words, gentle and encouraging, never make the child feel bad, nothing unsuitable for children, in English. Reply must be one natural spoken sentence, no square brackets or their contents.",
};

// 互动四·语音题④「你最先碰到了谁呀？」标准答案=啄木鸟。System Prompt 内置容错表+动态反馈+禁止规则。
// 末尾标记：可接受/不知道 → [OK]（前端给⭐+推进）；明显答错(kiwi/咕噜/月亮精灵) → [RETRY] 之外仍推进但不强判。
// 核心原则（设计稿六）：先接住孩子原话，再推进——不机械改成标准答案。回复≤20字、口语、温柔。
const Q4_WOODPECKER_SYSTEM = {
  zh: `你是月亮精灵，温柔温暖的向导。现在问小朋友：「你最先碰到了谁呀？」标准答案是【啄木鸟】（最先遇到、咚咚咚敲树、给月亮线索的红色鸟）。

【动态反馈铁律】先接住孩子原话，再推进，绝不机械改成标准答案：
- 说"啄木鸟"→「对呀，是啄木鸟！」
- 说"木鸟"→「对呀，就是啄木鸟！」
- 说"一只鸟/那只鸟/那个鸟"→「对呀，就是那只鸟！」
- 说"小鸟"→「对呀，就是那只小鸟！」
- 说"红色的鸟"→「对呀，就是那只红红的鸟！」
- 说"敲树的鸟"→「对呀，它一直在咚咚咚敲树呢！」
- 说"啄树的鸟/会敲树的鸟"→「对呀，就是那只会啄树的鸟！」
- 其他正确变体→「对呀，就是它！」
以上任意一种，回复末尾加 [OK]。

【答错处理】（温柔纠正、不说"你错了"，末尾加 [OK]）：
- "kiwi"→「它呀，是你后来碰到的～最先碰到的是啄木鸟哦！」
- "咕噜/叽里咕噜"→「咕噜后来才出现呢～最先碰到的是啄木鸟哦！」
- "月亮精灵"→「月亮精灵一直陪着你呢～最先碰到的是啄木鸟哦！」

【不知道处理】说"不知道/忘了/不会"→「没关系，是啄木鸟呀，它咚咚咚敲树呢！」末尾加 [OK]。

【禁止】绝不说"你猜对啦/回答得很好"敷衍不知道；绝不说"不对/你错了"；不长篇大论。
回复必须≤20字（含标点），自然口语，中文。除末尾的 [OK] 外，回复里不许出现任何方括号。`,
  en: `You are the Moon Sprite, a gentle warm guide. You just asked the child: "Who did you meet first?" The correct answer is [the woodpecker] (met first, pecks the tree, gave the moon clue, a red bird).

[Dynamic feedback rule] First catch the child's OWN words, then move on — never mechanically replace with the standard answer:
- "woodpecker" → "Yes, it's the woodpecker!"
- "a bird / that bird" → "Yes, that's the bird!"
- "little bird" → "Yes, that little bird!"
- "red bird" → "Yes, that little red bird!"
- "the bird that pecks the tree" → "Yes, it kept going peck-peck-peck!"
- any other correct variant → "Yes, that's it!"
For any of these, add [OK] at the end.

[Wrong answer] (gently correct, never say "you're wrong", add [OK]):
- "kiwi" → "Oh, you met kiwi later~ The first was the woodpecker!"
- "Gulu/Jiligulu" → "Gulu came later~ The first was the woodpecker!"
- "Moon Sprite" → "I was with you the whole time~ The first was the woodpecker!"

[Don't know] "I don't know / forgot" → "That's okay — it was the woodpecker, peck-peck on the tree!" add [OK].

[Forbidden] never say "you guessed right / great answer" to a don't-know; never say "wrong / you're wrong"; no long speeches.
Reply must be ≤14 words, natural spoken English. Apart from a trailing [OK], no square brackets allowed.`,
};

// 讲故事环节 V2 素材（public/section-visual-novel-material/，中文文件名 → encodeURI 转义防路径出错）
const MAT = '/section-visual-novel-material';
const ASSET = {
  bg: encodeURI(`${MAT}/bg.webp`),            // 夜景背景（新版，灯塔+月亮岛）原 背景new.webp
  card: encodeURI(`${MAT}/card.webp`),            // 气泡卡片（对话框）原 主卡片.webp
  ip: encodeURI(`${MAT}/ip.webp`),             // IP 立绘（新版立绘）原 ip人物.webp
  back: encodeURI(`${MAT}/btn-back.webp`),            // 返回箭头 原 按钮1.webp
  continueBtn: encodeURI(`${MAT}/btn-continue.webp`),      // 橙色"继续▶"按钮（整图）原 按钮2.webp
  progress0: encodeURI(`${MAT}/progress-0.webp`),   // 5格进度条·初始态（0格点亮）原 进度条初始.webp
  progressN: [1, 2, 3, 4, 5].map(n => encodeURI(`${MAT}/progress-${n}.webp`)), // 点亮 N 格（N=1..5）原 进度条N.webp
  advLabel: encodeURI(`${MAT}/adv-label.webp`),// 绿叶卷轴（叠"冒险进度 N/5"）原 冒险标签无文字.webp
  starCount: encodeURI(`${MAT}/star-count.webp`), // 星星胶囊（叠"×N"）原 星星数初始无数字.webp
  voiceLabel: encodeURI(`${MAT}/voice-label.webp`),  // 紫色"🎤语音题"标签 原 语音题标签.webp
  voiceBar: encodeURI(`${MAT}/voice-bar.webp`),  // 黄色长条文字框 原 语音条文字框.webp
  mic: encodeURI(`${MAT}/mic.webp`),         // 蓝色麦克风（按住录音）原 麦克风按钮.webp
  pickLabel: encodeURI(`${MAT}/pick-label.webp`),   // "🖼选图题"标签 原 选图题标签.webp
  pickCard: (id: string) => encodeURI(`${MAT}/choose-picture-card/${id}.webp`), // 选项卡（1-1~2-3）
  star: encodeURI(`${MAT}/star.webp`),              // 金色立体星（结算页五星展示）原 星星.webp
};

// 🚀 图片预加载：进页面就把所有素材预热进浏览器缓存，避免元素「第一次出现时白闪/卡一下」
// （进度条 1~5、星星、选图卡这些是切到对应步才显示的，不预热就会现加载）。模块级只跑一次。
const PRELOAD_URLS = [
  ASSET.bg, ASSET.card, ASSET.ip, ASSET.back, ASSET.continueBtn,
  ASSET.progress0, ...ASSET.progressN, ASSET.advLabel, ASSET.starCount,
  ASSET.voiceLabel, ASSET.voiceBar, ASSET.mic, ASSET.pickLabel, ASSET.star,
  // 选图卡 1-1~1-3 / 2-1~2-3
  ...['1-1', '1-2', '1-3', '2-1', '2-2', '2-3'].map(id => ASSET.pickCard(id)),
];
if (typeof window !== 'undefined') {
  PRELOAD_URLS.forEach(url => { const img = new Image(); img.src = url; });
}

// ⚙️ 布局调参区 ──────────────────────────────────────────────────────────
// 想精确改「进度条 / 气泡卡片 / 继续按钮」的大小和位置，只改这里的数字即可，不用动下面 JSX。
// 单位都是 px，按横屏目标(约 1600×900)调好；三个元素都自动水平居中，所以只需调高度/宽度和距顶距离。
const LAYOUT = {
  progressBar: {
    height: 100,   // 进度条高度（宽度按图片比例自动）
    top: 18,      // 距屏幕顶部
  },
  card: {
    width: 800,   // 气泡卡片宽度（高度按比例自动 = 宽 × 0.8）
    top: 45,     // 卡片顶距屏幕顶部（数字越小越往上）
  },
  button: {
    width: 270,   // 继续按钮宽度
    bottom: 50,  // 按钮距屏幕底部(px)。独立锚定：改 card.top 调间距时按钮原地不动。
  },
  // 语音步(④⑩)卡片内元素。都在卡片身体内垂直排布、水平居中；只调尺寸，纵向间距由 gap 控制。
  voiceLabel: { height: 46 },   // "语音题"标签高度
  voiceBar:   { width: 430 },   // 语音条宽度(px)。img 完整显示、上下透明留白用负 margin 吸收，高度自动跟随
  mic:        { width: 150 },   // 麦克风按钮宽度（含两侧声波，高度按比例自动）
  voiceGap:   14,               // 语音步四元素之间的垂直间距(px)
  // 选图步(⑥⑧)：题型标签 + 问题 + 三张竖卡横排。标签与语音题标签同高(46)、同位。
  pickLabel:  { height: 34 },   // "选图题"标签高度（比语音题标签略小，视觉对齐）
  pickGap:    12,               // 三张卡之间的水平间距(px)
  // 结算步(⑪)：标题 + 副文案 + 五星横排 + "N颗星！"。星按实际 stars 点亮，未拿到的灰显。
  // ⭐ 想调五星大小，只改 resultStar.width 这一个数字（px）。5颗+间距别超气泡身体宽(约 card.width×0.84)。
  resultStar: { width: 160 },   // ⭐⭐ 结算单颗星「大小」(px) —— 调大调小星星就改这里！高度按比例自动。
  resultStarGap: -50,          // ⭐⭐ 结算五星「左右间距」(px) —— 负数=星星互相叠压，调密就改这里！
  resultGap:  10,              // 结算各块(标题/副文案/星排/数字)之间的「基础」垂直间距(px)
  // 📍 结算各块「单独微调位置」：在基础 flex 布局上，对每块再叠加一个垂直偏移(px，正=下移，负=上移)。
  //    想把某块往上/下挪一点，只改对应数字即可，不影响其它块。0 = 不偏移(纯按 gap 排)。
  resultTitleY:    0,   // 「冒险完成啦！」标题 垂直偏移
  resultSubtitleY: 0,   // 「你真棒！获得」副文案 垂直偏移
  resultStarsY:    0,   // 五星横排 垂直偏移
  resultNumberY:   0,   // 「N 颗星！」数字行 垂直偏移
  // 📍 结算整组在气泡身体内的垂直位置：调这两个百分比把「整组结算内容」往上/下移(留白区间)。
  resultTop:    12,    // 结算内容区 距气泡顶 (%)；数字越小越往上
  resultBottom: 15,   // 结算内容区 距气泡底 (%)
};

// 🃏 选图题三张卡片大小 ── 单独摘出来，想调⑥⑧两道选图题的卡片大小就改这一个数字。
// 竖卡(原图 ≈0.64 宽高比)，只设宽度，高度按比例自动。三张并排，水平方向上限约 220(=气泡身体宽÷3)。
// 反馈语已改绝对定位贴底(不占垂直流)，所以卡片调大不会把提示挤走，纵向可放心调。
const PICK_CARD_WIDTH = 150; // 单张选项卡宽度(px)。改大/改小这里即可，三张一起变。
const PICK_CARD_LABEL_BOTTOM = '6%'; // ⭐ 想调标签上下位置，只改这一个值：数字越大越靠下，越小越靠上。

// 选图卡英文标签（id → 英文卡片名称）
const PICK_CARD_LABELS: Record<string, { zh: string; en: string }> = {
  '1-1': { zh: 'kiwi',     en: 'Kiwi' },
  '1-2': { zh: '叽里咕噜', en: 'Jiligulu' },
  '1-3': { zh: '啄木鸟',   en: 'Woodpecker' },
  '2-1': { zh: '石头',     en: 'A Rock' },
  '2-2': { zh: '星星',     en: 'The Stars' },
  '2-3': { zh: '贝壳',     en: 'A Shell' },
};

// 🎬 步骤机配置（11 步）──────────────────────────────────────────────────
// 设计稿 V2「四、完整流程」。type 决定该步的交互：
//   talk  = 纯过场，点「继续」进下一步（①②③⑨）
//   voice = 语音作答（④⑩）  pick = 三选一选图（⑥⑧）  affirm = AI 肯定后自动滑（⑤⑦）  result = 结算（⑪）
// progressOn=true 的步「完成时」点亮一格进度条 → ④⑥⑧⑩ + ⑪结算 = 5 格（决策已定）。
type StepType = 'talk' | 'voice' | 'affirm' | 'pick' | 'result';
interface StepDef {
  type: StepType;
  zh: string;
  en: string;
  badge?: 'voice' | 'pick';   // 顶部题型标签：语音题 / 选图题
  progressOn?: boolean;        // 该步完成 → 进度条 +1
  options?: string[];          // pick 步：三张选项卡 id（choose-picture-card 下文件名）
  answer?: string;             // pick 步：正解卡 id
  wrongHint?: { zh: string; en: string };  // pick 步：选错时的温柔提示（可重选）
  affirmText?: { zh: string; en: string };  // pick 步：答对后的肯定句(并入答题步显示，方案a)——设计稿⑦「对！是kiwi！」式
  tip?: { zh: string; en: string };         // voice 步旁边的小提示气泡（⑩：故事讲得越详细越好）
  story?: boolean;             // ⑩：完整故事步——多轮 + [COMPLETE] 判定 + 最多追问1次（区别于④单轮）
}
const STEPS: StepDef[] = [
  { type: 'talk',   zh: '你做到啦！',                 en: 'You did it!' },                                  // ①
  { type: 'talk',   zh: '月亮回来啦，你看它多亮！',     en: "The moon is back — look how bright it is!" },     // ②
  { type: 'talk',   zh: '我们重温下刚刚的旅程吧～',     en: "Let's look back on the journey we just had~" },   // ③
  { type: 'voice',  zh: '你最先碰到了谁呀？',           en: 'Who did you meet first?',  badge: 'voice', progressOn: true }, // ④
  { type: 'affirm', zh: '',                            en: '' },                                              // ⑤ AI 动态生成
  { type: 'pick',   zh: '后来你又碰到了谁？',           en: 'Who did you meet next?',   badge: 'pick',  progressOn: true,    // ⑥
    options: ['1-1', '1-2', '1-3'], answer: '1-1',
    wrongHint: { zh: '再想想，是啄木鸟让你去找的那个朋友～', en: "Think again — the friend the woodpecker sent you to find~" },
    affirmText: { zh: '对！是 kiwi 给你指了路～', en: "Yes! Kiwi pointed the way for you~" } },
  { type: 'affirm', zh: '',                            en: '' },                                              // ⑦ AI/本地动态
  { type: 'pick',   zh: '你跑过去，看到了什么？',       en: 'You ran over — what did you see?', badge: 'pick', progressOn: true, // ⑧
    options: ['2-1', '2-2', '2-3'], answer: '2-1',
    wrongHint: { zh: '再看看，那个圆圆的不会发光哦～', en: "Look again — the round one that doesn't glow~" },
    affirmText: { zh: '对！你跑过去看到的是石头～', en: "Yes! You ran over and it was a rock~" } },
  { type: 'talk',   zh: '差点被骗到！还好有叽里咕噜帮你～', en: 'Almost fooled! Lucky Jiligulu helped you~' },      // ⑨ 铺垫：把叽里咕噜勾出来，给复述铺路
  { type: 'voice',  zh: '现在把故事讲给我听好不好？',   en: 'Now tell me the whole story, okay?', badge: 'voice', progressOn: true, story: true, // ⑩
    tip: { zh: '故事讲得越详细越好哦～', en: 'The more detail, the better~' } },
  { type: 'result', zh: '冒险完成啦！',                 en: 'Adventure complete!',     progressOn: true },     // ⑪
];

// 📐 中文文案硬折行（设计稿铁律：每屏短句、6 岁能读）。规则「标点优先 + 均匀分行」：
// 先按标点(，。！？～…)断句，每句 ≤6 实字则整句成行；超 6 则均匀分成若干行(尽量等长，避免孤字)。
// 例「故事讲得越详细，」7 字 → 4+3 而非 6+1，"越详细"不被劈。标点黏行尾、不独占行；仅对中文生效。
const CJK_PUNCT = '，。！？、；：～…—·,.!?~';
const LINE_MAX = 6; // 每行最多实字数（标点不计）
function wrapCJK(text: string): string {
  // 1) 按标点切「句段」（标点留句尾）
  const segs: string[] = [];
  let cur = '';
  for (const ch of text) {
    cur += ch;
    if (CJK_PUNCT.includes(ch)) { segs.push(cur); cur = ''; }
  }
  if (cur) segs.push(cur);
  // 2) 每句段：≤LINE_MAX 整句成行；超了按「均匀行数」切，每行实字数尽量相等(标点不计、黏行尾)
  const lines: string[] = [];
  for (const seg of segs) {
    const chars = [...seg];
    const realCount = chars.filter(c => !CJK_PUNCT.includes(c)).length;
    if (realCount <= LINE_MAX) { lines.push(seg); continue; }
    const rows = Math.ceil(realCount / LINE_MAX);      // 需要几行
    const per = Math.ceil(realCount / rows);           // 每行实字数(均匀)
    let line = '', count = 0;
    for (const ch of chars) {
      if (CJK_PUNCT.includes(ch)) { line += ch; continue; } // 标点黏当前行尾、不计数
      if (count === per) { lines.push(line); line = ch; count = 1; }
      else { line += ch; count++; }
    }
    if (line) lines.push(line);
  }
  return lines.join('\n');
}

// 🧩 拆出三个「与打字机文字无关」的子块并 memo —— 打字机/AI流式每字 setState 时它们不再跟着重渲染。
// 背景大图、IP 立绘浮动动画都是静态的(无 props)；HUD 只依赖 progress/stars/lang(变化频率低)。

// 背景大图：纯静态，eager 加载(首屏关键图，不 lazy 以免出现时才加载)
const Background = memo(function Background() {
  return (
    <div className="absolute inset-0 z-0">
      <img src={ASSET.bg} alt="Background" className="w-full h-full object-cover" />
    </div>
  );
});

// IP 立绘 + 无限浮动：纯静态。隔离后浮动动画不再被打字机高频重渲染打扰 → 不抖动。
const IpCharacter = memo(function IpCharacter() {
  return (
    <div className="absolute bottom-0 left-2 md:left-6 h-[60vh] flex items-end z-10 pointer-events-none">
      <motion.div
        animate={{ y: [0, -10, 0] }}
        transition={{ repeat: Infinity, duration: 4, ease: 'easeInOut' }}
        className="relative h-full flex items-end"
      >
        <img src={ASSET.ip} alt="Character" className="max-h-[95%] object-contain drop-shadow-2xl" />
      </motion.div>
    </div>
  );
});

// 顶部 HUD：返回 · 进度条 · 星星数。只依赖 progress/stars/lang，memo 后打字机文字变化不会重渲染它。
const Hud = memo(function Hud({
  progress,
  stars,
  lang,
  onBack,
}: {
  progress: number;
  stars: number;
  lang: 'zh' | 'en';
  onBack?: () => void;
}) {
  return (
    <div className="absolute top-0 left-0 right-0 z-20 px-4 md:px-8 pt-4 md:pt-6 h-32 pointer-events-none">
      {/* 返回主菜单 —— 贴左 */}
      <button
        onClick={onBack}
        className="absolute left-4 md:left-8 top-4 md:top-6 pointer-events-auto w-14 h-14 md:w-16 md:h-16 hover:scale-105 active:scale-95 transition-transform"
        aria-label={lang === 'zh' ? '返回' : 'Back'}
      >
        <img src={ASSET.back} alt="" className="w-full h-full object-contain drop-shadow-lg" />
      </button>
      {/* 进度条 —— 屏幕水平居中（图随 progress 点亮 0~5 格） */}
      <img
        src={progress === 0 ? ASSET.progress0 : ASSET.progressN[progress - 1]}
        alt=""
        className="absolute left-1/2 -translate-x-1/2 object-contain drop-shadow-lg"
        style={{ height: LAYOUT.progressBar.height, top: LAYOUT.progressBar.top }}
      />
      {/* 星星数 —— 贴右（数字随 stars 真实得星变化） */}
      <div className="absolute right-4 md:right-8 top-4 md:top-6">
        <img src={ASSET.starCount} alt="" className="h-14 md:h-16 lg:h-[72px] object-contain drop-shadow-lg" />
        <span className="absolute inset-0 flex items-center justify-end pr-5 md:pr-6 font-display font-bold text-white text-xl md:text-2xl lg:text-3xl">
          {stars}
        </span>
      </div>
    </div>
  );
});

export default function SectionVisualNovel({
  isActive,
  onBack,
  onComplete,
}: {
  isActive?: boolean;
  onBack?: () => void;
  onComplete?: () => void;
} = {}) {
  const { lang } = useLang();
  const containerRef = useRef<HTMLDivElement>(null);
  // 实时可见性（非 once）：用来闸住空格监听 / 录音态，避免别的 section 的空格污染本页。
  const measuredInView = useInView(containerRef, { amount: 0.5 });
  const isInView = isActive ?? measuredInView;

  const [isRecording, setIsRecording] = useState(false);
  const voiceStartRef = useRef<number>(0); // 语音开始时间戳，用于计算单次录音时长
  const voiceReleaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleVoiceReleaseRef = useRef<() => void>(() => {});
  // 浏览器不支持语音时：用户按了麦克风才弹提示，几秒后自动消失（平时不常驻）
  const [voiceHintShown, setVoiceHintShown] = useState(false);
  const voiceHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showVoiceHint = () => {
    if (voiceHintTimerRef.current) clearTimeout(voiceHintTimerRef.current);
    setVoiceHintShown(true);
    voiceHintTimerRef.current = setTimeout(() => setVoiceHintShown(false), 3000);
  };
  useEffect(() => () => { if (voiceHintTimerRef.current) clearTimeout(voiceHintTimerRef.current); }, []);

  const [displayedDialogText, setDisplayedDialogText] = useState("");
  const dialogTextLength = useRef(0);
  const openingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 开场白打字机播完 → 出"继续"按钮（初始态第①步是恭喜句，操作=点继续）
  const [openingDone, setOpeningDone] = useState(false);

  // 🎬 步骤机状态（Phase 1）：step=当前第几步(0-based 索引 STEPS)；progress=进度条点亮格(只升不降)；stars=真实得星。
  const [step, setStep] = useState(0);
  const [progress, setProgress] = useState(0);
  const [stars, setStars] = useState(0);
  // 语音/选图步「答完」标记：AI 夸完(④⑩) / 选图答对或揭晓(⑥⑧) 后置 true → 卡片上出「继续」按钮，
  // 等孩子自己点再推进（不再自动滑）。每进新步在主 useEffect 里复位 false。
  const [stepAnswered, setStepAnswered] = useState(false);
  const current = STEPS[step];
  const isVoiceStep = current.type === 'voice'; // ④⑩：卡片内嵌语音 UI（标签+语音条+麦克风）
  const isPickStep = current.type === 'pick';   // ⑥⑧：卡片内嵌三选一选图 UI
  const isResultStep = current.type === 'result'; // ⑪：结算页（标题+副文案+五星动效+N颗星）
  const silenceCountRef = useRef(0);            // 本语音步「松开却没识别到字」的次数（沉默兜底：满2次不给⭐直接推进）
  // ⑪结算补星守卫：给星点只有 ④⑥⑧⑩(4个)，结算时补第5颗(走完全程的奖励)→ 实际能拿满5。
  // 用 ref 守卫确保每次进入结算只补一次(useEffect 依赖含 lang，语言切换会重跑，避免叠加超额)。离场复位。
  const resultStarGrantedRef = useRef(false);
  // 语音回复态：从「松开发送」到「advance 切步」全程 true。用它(而非瞬时 isStreaming)切换语音UI→AI回复气泡，
  // 避免流式结束(isStreaming=false)到 advance(1.1s)之间语音UI 闪回。进语音步 useEffect 里复位。
  const [voiceAnswering, setVoiceAnswering] = useState(false);
  // ⑩完整故事(Phase 4)：storyPrompt=AI 最近一次追问(切回麦克风时显示在问题区，替代原问题)；
  // storyRoundRef=已讲述轮次；storyHistoryRef=多轮对话历史(含 system)。
  const [storyPrompt, setStoryPrompt] = useState('');
  const storyRoundRef = useRef(0);
  const storyHistoryRef = useRef<ChatMessage[]>([]);

  // 选图步(⑥⑧)状态：pickWrong=已选错次数(满2次揭晓答案)；pickResult=本步判定结果(显示对错反馈)；
  // pickRevealed=两次错后强制揭晓(高亮正解、禁用点击、出继续)。
  const [pickWrong, setPickWrong] = useState(0);
  const [pickResult, setPickResult] = useState<'idle' | 'right' | 'wrong' | 'revealed'>('idle');
  const [pickSelected, setPickSelected] = useState<string | null>(null); // 当前高亮的卡 id（对/揭晓时）

  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // 语音识别（Web Speech API）。zh→zh-CN / en→en-US。
  const {
    text: recognizedText,
    isSupported: srSupported,
    unavailableReason: srReason,
    micDenied: srDenied,
    start: srStart,
    stop: srStop,
    reset: srReset,
  } = useSpeechRecognition(lang === 'zh' ? 'zh-CN' : 'en-US');

  // 语音题两个文字框的内部滚动容器：内容变长时自动滚到底，把长文字关在框里、不往外顶。
  // recogScrollRef=录音态语音条识别稿；aiScrollRef=松手后 AI 回复气泡。只服务语音步(④⑩)。
  const recogScrollRef = useRef<HTMLDivElement>(null);
  const aiScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = recogScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight; // 识别稿每新增一段 → 滚到最新
  }, [recognizedText]);
  useEffect(() => {
    const el = aiScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight; // AI 流式回复每蹦一字 → 滚到最新
  }, [displayedDialogText, voiceAnswering]);

  // 语音不可用时按麦克风才弹的友好提示文案（3s 自动消失，见 showVoiceHint）。
  // 静态原因(unsupported/insecure)优先；否则按运行时被拒(srDenied)给"麦克风被挡住"。
  const voiceHintText = lang === 'zh'
    ? (srReason === 'unsupported' ? '请用 Chrome 或 Edge 浏览器打开哦～'
      : srReason === 'insecure' ? '这个页面要用 HTTPS 才能开麦克风哦～'
      : '麦克风被挡住啦，点地址栏左边的图标允许一下吧～')
    : (srReason === 'unsupported' ? 'Please open in Chrome or Edge~'
      : srReason === 'insecure' ? 'This page needs HTTPS to use the mic~'
      : 'The mic is blocked — allow it from the address bar~');

  // 按下麦克风：不可用(不支持/被拒)时只弹提示、不进入录音态；可用才真正开录。
  const tryStartRecording = () => {
    if (!isInView) return;
    if (!srSupported || srDenied) { showVoiceHint(); return; }
    setIsRecording(true);
  };

  useEffect(() => {
    setIsStreaming(false);
    setVoiceAnswering(false); // 每进新步复位回复态 → 语音步回到「等待录音」UI
    setStepAnswered(false);   // 复位「答完」标记 → 新步默认不出继续按钮(由各步逻辑再点亮)
    setStoryPrompt('');       // ⑩追问文字清空(回到原问题)
    storyRoundRef.current = 0; // ⑩讲述轮次归零
    storyHistoryRef.current = []; // ⑩多轮历史清空(首次发送时建 system)
    srReset();                // 清空上一步语音识别稿(否则④的「啄木鸟」会残留到⑩语音条里)
    if (!isInView) return;

    // affirm 步(⑤⑦)：保留上一步 AI 回复文字，直接出"继续"按钮等用户点击
    if (current.type === 'affirm') {
      setOpeningDone(true);
      return;
    }

    // pick 步(⑥⑧)：问题文字固定显示在卡片内，不走打字机；进入时重置本步选图状态、清空反馈区。
    if (current.type === 'pick') {
      setPickWrong(0);
      setPickResult('idle');
      setPickSelected(null);
      setDisplayedDialogText('');
      setOpeningDone(false);
      return;
    }

    // result 步(⑪结算)：标题/副文案/五星/数字全在结算分支 JSX 里直接渲染(含星星动效)，不走打字机。
    // 走到结算 = 走完全程 → 直接钉满 5 星 + 进度第5格全亮(不依赖前面每个给星点是否都触发)。
    if (current.type === 'result') {
      setDisplayedDialogText('');
      setOpeningDone(true);
      setStars(5);       // 钉满5星：HUD ×5 + 结算页五星全亮
      setProgress(5);    // 进度条第5格全亮
      return;
    }

    // 非 affirm 步：清空文字、重置打字机
    dialogTextLength.current = 0;
    setDisplayedDialogText("");
    setOpeningDone(false);

    // 当前步要显示的文案
    const stepText = (lang === 'zh' ? current.zh : current.en) || '';

    // 打字机：逐字播当前步文案（存 ref，语音发送时若还在播则打断）
    const interval = setInterval(() => {
      dialogTextLength.current += 1;
      if (dialogTextLength.current <= stepText.length) {
        setDisplayedDialogText(stepText.slice(0, dialogTextLength.current));
      } else {
        clearInterval(interval);
        openingIntervalRef.current = null;
        setOpeningDone(true); // 播完 → 出"继续"
      }
    }, 100);
    openingIntervalRef.current = interval;
    return () => clearInterval(interval);
  }, [step, isInView, lang]);

  // 录音开/关由 isRecording 驱动（push-to-talk，卡片内嵌）：按下 → 起识别；松开 → 停识别 + 自动发送。
  // 不再亮 overlay 弹窗——语音 UI 全在卡片内。松开时若识别稿为空记一次沉默（兜底用）。
  useEffect(() => {
    if (!isInView) {
      srStop();
      return;
    }
    if (isRecording) {
      if (voiceReleaseTimerRef.current) {
        clearTimeout(voiceReleaseTimerRef.current);
        voiceReleaseTimerRef.current = null;
      }
      voiceStartRef.current = Date.now();
      track('voice_start', { scene: 'story' });
      srStart();
    } else {
      srStop();
      if (voiceStartRef.current) {
        track('voice_end', { scene: 'story', durationMs: Date.now() - voiceStartRef.current });
        voiceStartRef.current = 0;
        // 松开自动发送：给识别稿一点收尾时间，再决定「发送」或「记一次沉默」
        voiceReleaseTimerRef.current = setTimeout(() => {
          voiceReleaseTimerRef.current = null;
          handleVoiceReleaseRef.current();
        }, 350);
      }
    }
    return () => {
      if (voiceReleaseTimerRef.current) {
        clearTimeout(voiceReleaseTimerRef.current);
        voiceReleaseTimerRef.current = null;
      }
    };
  }, [isRecording, isInView, srStart, srStop]);

  useEffect(() => {
    srReset();
    setIsRecording(false);
  }, [lang]);

  // 首次按下就被拒（onerror='not-allowed'）→ srDenied 翻真 → 自动弹一次提示（后续按下由 tryStartRecording 兜住）。
  useEffect(() => {
    if (srDenied) { setIsRecording(false); showVoiceHint(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [srDenied]);

  // Global mouseup/touchend to stop recording even if mouse leaves the button
  useEffect(() => {
    if (!isInView) return;
    const handleUp = () => setIsRecording(false);
    if (isRecording) {
      window.addEventListener('mouseup', handleUp);
      window.addEventListener('touchend', handleUp);
    }
    return () => {
      window.removeEventListener('mouseup', handleUp);
      window.removeEventListener('touchend', handleUp);
    };
  }, [isRecording, isInView]);

  // Spacebar support — 仅本页在视野内时生效，避免跑酷页打字的空格远程触发录音
  useEffect(() => {
    if (!isInView) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return; // 输入框打字放行
      if (e.code === 'Space' && !e.repeat) setIsRecording(true);
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') setIsRecording(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [isInView]);

  // 离开视野 → 复位所有交互态，下次滚回来一定是干净的第①步初始态
  useEffect(() => {
    if (isInView) return;
    abortRef.current?.abort();
    srStop();
    if (voiceReleaseTimerRef.current) {
      clearTimeout(voiceReleaseTimerRef.current);
      voiceReleaseTimerRef.current = null;
    }
    setIsRecording(false);
    setIsStreaming(false);
    setVoiceAnswering(false);
    setStepAnswered(false);
    setStoryPrompt('');
    storyRoundRef.current = 0;
    storyHistoryRef.current = [];
    setStep(0);          // 步骤机归零 → 回到 ①
    setProgress(0);      // 进度条清空
    setStars(0);         // 星星清空
    resultStarGrantedRef.current = false; // 结算补星守卫复位 → 下次走完整流程可再补第5颗
    silenceCountRef.current = 0;
    srReset();
  }, [isInView]);

  // 松开麦克风的兜底分流：有识别稿 → 发送（④单轮 / ⑩多轮）；空 → 记一次沉默，满 2 次直接推进不给⭐。
  const handleVoiceRelease = () => {
    if (isStreaming) return;
    const text = recognizedText.trim();
    if (text) {
      silenceCountRef.current = 0;
      if (current.story) void sendStoryAnswer(text); // ⑩完整故事：多轮 + [COMPLETE] 判定
      else void sendVoiceAnswer(text);               // ④：单轮接住即推进
    } else {
      silenceCountRef.current += 1;
      if (silenceCountRef.current >= 2) {
        // 第二次仍无声音 → 直接推进，不给⭐
        silenceCountRef.current = 0;
        advance(false);
      } else if (current.story) {
        // ⑩第一次没声音 → 温柔引导显示在问题区(走 storyPrompt，语音UI 问题区读它)
        setStoryPrompt(lang === 'zh' ? '别急，慢慢说～你最先遇到的好朋友是谁呀？' : "Take your time~ Who was the first friend you met?");
      } else {
        // ④第一次没听清 → 温柔提示，留在原地等再录
        setDisplayedDialogText(lang === 'zh' ? '我没听清，再说一次？' : "I didn't catch that — say it again?");
      }
    }
  };
  handleVoiceReleaseRef.current = handleVoiceRelease;

  // ④语音题发送（单轮）：用啄木鸟 prompt 起一段独立对话，流式显示 AI 肯定回复 →
  // 接住即给⭐ + 自动推进（⑤肯定其实就是这条 AI 回复本身，停留 ~1.1s 让孩子看完再滑）。⑩走 sendStoryAnswer。
  const sendVoiceAnswer = async (text: string) => {
    if (openingIntervalRef.current) { clearInterval(openingIntervalRef.current); openingIntervalRef.current = null; }
    const history: ChatMessage[] = [
      { role: 'system', content: Q4_WOODPECKER_SYSTEM[lang] },
      { role: 'user', content: text },
    ];
    setVoiceAnswering(true); // 进入回复态 → 卡片切到 AI 回复气泡，全程不闪回语音UI（直到 advance 切步复位）
    setIsStreaming(true);
    setDisplayedDialogText('');
    srStop();
    srReset();

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const full = await streamChat(history, partial => setDisplayedDialogText(sanitizeAllBracketsForDisplay(partial)), controller.signal);
      setDisplayedDialogText(stripAllBrackets(full));
      setIsStreaming(false);
      // 语音题：无论 [OK] 与否都算答过（设计稿：答错也温柔带过并推进），给⭐ + 进度。
      // 「答完出按钮」：不再自动滑——AI 夸奖就地显示，出「继续」按钮等孩子自己点(advance 会跳过紧随的⑤肯定步)。
      setStars(s => Math.min(5, s + 1));
      setVoiceAnswering(true); // 维持回复态(不闪回语音UI)；按钮出现等点击
      setStepAnswered(true);   // → 卡片出继续按钮
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return; // 已离开/打断，静默
      setDisplayedDialogText(lang === 'zh' ? '让我想想……再跟我说一次吧！' : 'Let me think… tell me again!');
      setIsStreaming(false);
      setVoiceAnswering(false); // 出错留在原语音步重录 → 切回语音UI
    }
  };

  // ⑩完整故事发送：固定两轮。
  //   第1轮：AI 接住孩子的话 + 只追问一个缺失情节 → 切回麦克风，等孩子再讲。
  //   第2轮：AI 收尾夸奖 → 给⭐ + 出继续按钮进结算（无论讲得怎样，第2轮必收尾，不再多问）。
  const sendStoryAnswer = async (text: string) => {
    if (openingIntervalRef.current) { clearInterval(openingIntervalRef.current); openingIntervalRef.current = null; }
    storyRoundRef.current += 1;
    const round = storyRoundRef.current;
    // 第2轮(最后一轮)给 AI 一个收尾指令：强制收尾、不要再提问。
    // 「不知道」分支：孩子若答不上"谁帮你找到月亮"，先给提示(叽里咕噜)再夸奖，避免出现
    // 答"不知道"却被直接夸奖的尴尬(队友反馈的 bug)。
    const sys = round >= 2
      ? MOON_GUIDE_SYSTEM[lang] + (lang === 'zh'
          ? '\n\n【当前是最后一轮·收尾·此规则覆盖前面"只能一句话"的限制】不要再提任何问题。\n- 如果小朋友说"不知道/不会/忘了"，或没讲清是谁帮他找到月亮：请回复【两句话】——第一句温柔提示「是叽里咕噜帮你找到真月亮的呀～」，第二句夸夸他、祝贺他完成冒险；结尾加 [COMPLETE]。\n- 否则：只用【一句话】温暖地夸夸小朋友、祝贺他讲完了这个冒险故事，结尾加 [COMPLETE]。'
          : '\n\n[Final round · wrap up · this overrides the earlier "one sentence only" limit] Do NOT ask any more questions.\n- If the child says "I don\'t know / can\'t / forgot", or did not make clear who helped find the moon: reply in TWO sentences — first a gentle hint "It was Jiligulu who helped you find the real moon~", then praise them and congratulate them on finishing the adventure; end with [COMPLETE].\n- Otherwise: in just ONE warm sentence, praise the child and congratulate them on finishing the adventure story, then end with [COMPLETE].')
      : MOON_GUIDE_SYSTEM[lang];
    const base = storyHistoryRef.current.length
      ? storyHistoryRef.current
      : [{ role: 'system', content: sys } as ChatMessage];
    // 第2轮把 system 换成带收尾指令的版本(历史首条)
    if (round >= 2 && base.length) base[0] = { role: 'system', content: sys };
    const history: ChatMessage[] = [...base, { role: 'user', content: text }];

    setVoiceAnswering(true);
    setIsStreaming(true);
    setDisplayedDialogText('');
    setStoryPrompt('');       // 清旧追问，避免发送时语音条上方还残留上一句
    srStop();
    srReset();

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const full = await streamChat(history, partial => setDisplayedDialogText(sanitizeAllBracketsForDisplay(partial)), controller.signal);
      const clean = stripAllBrackets(full);
      setDisplayedDialogText(clean);
      storyHistoryRef.current = [...history, { role: 'assistant', content: clean }];
      setIsStreaming(false);

      // 固定第2轮收尾（不看 [COMPLETE]，避免 AI 不肯收尾一直追问）。
      if (round >= 2) {
        // 第2轮 → 给⭐ + 出继续按钮（AI 这条收尾夸奖就地显示）
        setStars(s => Math.min(5, s + 1));
        setVoiceAnswering(true);
        setStepAnswered(true);
      } else {
        // 第1轮，AI 已追问一个缺失情节 → 把这句追问存进 storyPrompt(切回麦克风后显示在问题区，
        // 替代原问题“现在把故事讲给我听好不好？”)，再切回语音UI 等孩子接着讲。
        setStoryPrompt(clean);
        setVoiceAnswering(false);
      }
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return;
      setDisplayedDialogText(lang === 'zh' ? '让我想想……再跟我说一次吧！' : 'Let me think… tell me again!');
      setIsStreaming(false);
      setVoiceAnswering(false);
      storyRoundRef.current = Math.max(0, storyRoundRef.current - 1);
    }
  };

  // 🎬 步骤机驱动：推进到下一步。离开「progressOn」步时点亮一格进度条（只升不降，一定走得到终点）。
  // grantStar 仅用于语义/埋点：语音/选图步的⭐已在各自逻辑里给；沉默兜底 advance(false) 表示「不给⭐但照常推进」。
  // 「答完出按钮」决策后：voice④/pick⑥/⑧ 答完会就地显示 AI 夸奖+继续按钮，那段夸奖正是 affirm⑤⑦ 的内容，
  //   故从 voice/pick 点继续推进时，跳过紧随其后的 affirm 步(避免同一句夸话连看两屏、连点两次按钮)。
  //   ⑨是 talk 不会被跳；affirm 步本身 progressOn=false，跳过不丢进度。
  const advance = (_grantStar = true) => {
    // 打断还没播完的打字机，避免残留 interval 改下一步文案
    if (openingIntervalRef.current) { clearInterval(openingIntervalRef.current); openingIntervalRef.current = null; }
    // 切步前同步清空文字，避免新步第一帧渲染时还显示旧步文案（如⑧肯定句用大字号闪现在⑨）
    setDisplayedDialogText('');
    if (current.progressOn) setProgress(p => Math.min(5, p + 1));
    // 从当前步往后找下一个「非 affirm」步作为落点（把紧随的 affirm 夸奖步并入刚答完的这步）。
    let next = step + 1;
    while (next < STEPS.length && STEPS[next].type === 'affirm') next += 1;
    // (进结算的补星/进度已在 result 步 useEffect 里钉满，这里不再处理。)
    if (next >= STEPS.length) {
      track('stage_complete', { stage: 'story' });
      onComplete?.();
      return;
    }
    setStep(next);
  };

  useEffect(() => {
    try {
      if (!new URLSearchParams(window.location.search).has('test')) return;
    } catch {
      return;
    }
    const driver = {
      complete: () => {
        track('stage_complete', { stage: 'story', smoke: true });
        onComplete?.();
        return { progress, stars, step };
      },
      state: () => ({ progress, stars, step }),
    };
    window.__otterStorySmoke = driver;
    return () => {
      if (window.__otterStorySmoke === driver) {
        delete window.__otterStorySmoke;
      }
    };
  }, [onComplete, progress, stars, step]);

  // 🖼 选图步(⑥⑧)判定（本地，不调 AI）：
  //   第一次点对 → 高亮正解 + ⭐ + 进度，停留后自动滑下一步。
  //   点错 → 抖一下 + 温柔提示(wrongHint)，可重选；满 2 次错 → 揭晓正解、不给⭐，出"继续"手动推进。
  const handlePick = (id: string) => {
    if (pickResult === 'right' || pickResult === 'revealed') return; // 已定案，忽略后续点击
    if (id === current.answer) {
      setPickSelected(id);
      setPickResult('right');
      setStars(s => Math.min(5, s + 1));
      // 答对后显示该步专属肯定句(设计稿⑤⑦「对！是kiwi！」式)，并入答题步——方案a，不单独跳 affirm 屏。
      setDisplayedDialogText(lang === 'zh' ? current.affirmText!.zh : current.affirmText!.en);
      setStepAnswered(true); // 「答完出按钮」：答对后不自动滑，出「继续」按钮等孩子点(advance 跳过紧随的⑦肯定步)
    } else {
      const next = pickWrong + 1;
      setPickWrong(next);
      if (next >= 2) {
        // 两次错 → 揭晓正解，高亮正确卡，不给⭐，等用户点继续
        setPickSelected(current.answer!);
        setPickResult('revealed');
        setDisplayedDialogText(lang === 'zh' ? '没关系，正确答案是这个哦～' : "It's okay — this is the right one~");
      } else {
        // 第一次错 → 提示重选
        setPickResult('wrong');
        setDisplayedDialogText(lang === 'zh' ? current.wrongHint!.zh : current.wrongHint!.en);
      }
    }
  };

  return (
    <div ref={containerRef} className="w-full h-full relative overflow-hidden bg-[#1E3A8A]">
      {/* 背景 / HUD / IP 立绘 —— 已拆为 memo 子组件，打字机/AI流式每字 setState 不再重渲染它们。 */}
      <Background />
      <Hud progress={progress} stars={stars} lang={lang} onBack={onBack} />
      <IpCharacter />

      {/* 卡片组 —— 卡片+按钮纵向列，水平居中。大小/位置全由顶部 LAYOUT 控制。 */}
      <div className="absolute inset-0 z-20 flex flex-col items-center pointer-events-none">

         {/* 卡片：宽度 = LAYOUT.card.width(px)，距顶 = LAYOUT.card.top(px)；高度由 aspect-ratio 自动等比。 */}
         {/* ⚠️ 绝不能加 max-h（会破坏 aspect-ratio→气泡被拉伸）；只用 width 控制尺寸。 */}
         <div
           className="relative aspect-[1402/1122] bg-no-repeat shrink-0"
           style={{
             width: LAYOUT.card.width,
             marginTop: LAYOUT.card.top,
             backgroundImage: `url('${ASSET.card}')`,
             backgroundSize: '100% 100%',
           }}
         >
           {/* 小提示气泡（⑩：故事讲得越详细越好）—— 挂在卡片右侧外缘、垂直偏上；黄底+尾巴指向左侧主气泡。 */}
           {/* z-30 盖过 HUD(z-20)；最大宽限制避免太宽，文字两行内。 */}
           {current.tip && isVoiceStep && !voiceAnswering && (
             <div className="absolute top-[24%] left-full -translate-x-1 z-30 w-[46%] max-w-[200px]">
               <div className="relative bg-otter-orange-light text-otter-text font-bold text-base md:text-lg leading-snug rounded-2xl px-4 py-3 shadow-xl border-2 border-white text-center">
                 {lang === 'zh' ? current.tip.zh : current.tip.en}
                 {/* 小尾巴：指向左侧主气泡 */}
                 <span className="absolute top-7 -left-2.5 w-0 h-0 border-t-[10px] border-b-[10px] border-r-[10px] border-t-transparent border-b-transparent border-r-otter-orange-light" />
               </div>
             </div>
           )}
           {isVoiceStep && !voiceAnswering ? (
             /* 语音步(④⑩)·等待录音态：语音题标签 / 问题 / 语音条(实时识别稿) / 麦克风。 */
             /* 一旦松开发送(voiceAnswering=true)就回落到普通气泡，全程显示 AI 回复——不再随 isStreaming 闪回。 */
             <div
               className="absolute left-[8%] right-[8%] top-[12%] bottom-[13%] flex flex-col items-center justify-center"
               style={{ gap: LAYOUT.voiceGap }}
             >
               {/* 语音题标签 */}
               <img src={ASSET.voiceLabel} alt="" style={{ height: LAYOUT.voiceLabel.height }} className="object-contain shrink-0" />
               {/* 问题文字：⑩追问时(storyPrompt)显示 AI 这句具体追问(小字、自然换行)；否则显示原问题(单行)。 */}
               {storyPrompt ? (
                 <div className="text-center text-lg md:text-xl lg:text-2xl font-bold leading-snug text-otter-text shrink-0 px-2 whitespace-pre-line">
                   {storyPrompt}
                 </div>
               ) : (
                 <div className="text-center text-2xl md:text-3xl lg:text-4xl font-bold leading-snug text-otter-text whitespace-nowrap shrink-0">
                   {lang === 'zh' ? current.zh : current.en}
                 </div>
               )}
               {/* 语音条：img 完整显示(不裁切→右上星星不被切)，按宽缩放；上下透明留白用负 margin 吸收，*/}
               {/* 负 margin 按「宽度百分比」算(随宽缩放)：实测留白上 280/1536=18.2% 下 346/1536=22.5%。 */}
               <div className="relative shrink-0 flex items-center justify-center" style={{ width: LAYOUT.voiceBar.width }}>
                 <img
                   src={ASSET.voiceBar}
                   alt=""
                   className="w-full object-contain"
                   style={{ marginTop: '-18.2%', marginBottom: '-22.5%' }}
                 />
                 {/* 识别稿：外层居中(短文字仍居中)，内层限高可滚(长文字在框内向下滚、自动到底)，不再外溢。 */}
                 <div className="absolute left-0 right-0 bottom-0 top-[3px] flex items-center justify-center px-[8%]">
                   <div
                     ref={recogScrollRef}
                     className={`max-h-full overflow-y-auto text-center font-bold leading-tight [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${recognizedText ? 'text-otter-text text-xl md:text-2xl' : 'text-otter-text/40 text-base md:text-lg'}`}
                   >
                     {recognizedText || (lang === 'zh' ? '点下面麦克风说话吧～' : 'Tap the mic below to talk~')}
                     {isRecording && <span className="animate-pulse">▍</span>}
                   </div>
                 </div>
               </div>
               {/* 麦克风：push-to-talk（按住录音，松开自动发送） */}
               <button
                 onMouseDown={tryStartRecording}
                 onTouchStart={(e) => { e.preventDefault(); tryStartRecording(); }}
                 disabled={isStreaming}
                 style={{ width: LAYOUT.mic.width, pointerEvents: 'auto' }}
                 className={`shrink-0 transition-transform disabled:opacity-50 ${isRecording ? 'scale-95' : 'hover:scale-105'}`}
                 aria-label={lang === 'zh' ? '按住说话' : 'Hold to talk'}
               >
                 <img src={ASSET.mic} alt="" className="w-full object-contain drop-shadow-lg" />
               </button>
               {/* 语音不可用提示（不支持/非HTTPS/权限被拒）——按了麦克风才弹，3s 自动消失，不常驻。 */}
               {voiceHintShown && (
                 <div className="absolute left-[6%] right-[6%] bottom-[1%] mx-auto text-center bg-white/95 text-otter-text font-bold text-sm md:text-base leading-snug rounded-xl px-4 py-2 shadow-lg border-2 border-otter-orange-light pointer-events-none">
                   {voiceHintText}
                 </div>
               )}
             </div>
           ) : isResultStep ? (
             /* 结算步(⑪)：卡片身体内垂直排布 —— 标题 / 副文案 / 五星横排(逐颗弹入动效) / 「N颗星！」。 */
             /* 不走打字机：标题等直接渲染。星按真实 stars 点亮(金色)，未拿到的灰显。继续按钮在屏幕底部(→onComplete)。 */
             <div
               className="absolute left-[8%] right-[8%] flex flex-col items-center justify-center text-center"
               style={{ top: `${LAYOUT.resultTop}%`, bottom: `${LAYOUT.resultBottom}%`, gap: LAYOUT.resultGap }}
             >
               {/* 标题：大字深棕粗体。位置微调 = LAYOUT.resultTitleY(px) */}
               <div className="text-4xl md:text-5xl font-display font-bold leading-tight text-otter-text shrink-0" style={{ marginTop: LAYOUT.resultTitleY }}>
                 {lang === 'zh' ? '冒险完成啦！' : 'Adventure complete!'}
               </div>
               {/* 副文案：中字深棕。位置微调 = LAYOUT.resultSubtitleY(px) */}
               <div className="text-2xl md:text-3xl font-bold leading-snug text-otter-text shrink-0" style={{ marginTop: LAYOUT.resultSubtitleY }}>
                 {lang === 'zh' ? '你真棒！获得' : 'You did great! You earned'}
               </div>
               {/* 五星横排：固定 5 个星位，逐颗弹入(stagger)。点亮 stars 颗(金色)，其余灰显。位置微调 = LAYOUT.resultStarsY(px) */}
               {/* 父容器 staggerChildren 让每颗依次登场；每颗 = 弹入(scale 0→1.25→1 回弹) + 落定呼吸 + 弹入瞬间白光"叮"。 */}
               <motion.div
                 className="flex items-center justify-center shrink-0"
                 style={{ marginTop: LAYOUT.resultStarsY }}
                 variants={{ hidden: {}, show: { transition: { staggerChildren: 0.18, delayChildren: 0.15 } } }}
                 initial="hidden"
                 animate="show"
               >
                 {[0, 1, 2, 3, 4].map(i => {
                   const lit = i < stars; // 该星位是否点亮(真实得星)
                   return (
                     <motion.div
                       key={i}
                       className="relative shrink-0"
                       style={{ width: LAYOUT.resultStar.width, marginRight: i < 4 ? LAYOUT.resultStarGap : 0 }}
                       // 逐颗弹入：scale 0→1.25→1 回弹 + 淡入(关键帧自带 overshoot，用 easeOut 不叠加二次回弹)，时长~0.42s
                       variants={{
                         hidden: { scale: 0, opacity: 0 },
                         show: { scale: [0, 1.25, 1], opacity: [0, 1, 1], transition: { duration: 0.42, ease: 'easeOut', times: [0, 0.65, 1] } },
                       }}
                     >
                       {/* 星图：点亮=原色金星；未拿到=灰显(grayscale + 半透明) */}
                       <img
                         src={ASSET.star}
                         alt=""
                         className={`w-full object-contain drop-shadow-lg transition-none ${lit ? '' : 'grayscale opacity-30'}`}
                       />
                       {/* 落定后呼吸：仅点亮的星轻微缩放循环，让画面不死板(延迟到本颗弹完后再起) */}
                       {lit && (
                         <motion.img
                           src={ASSET.star}
                           alt=""
                           className="absolute inset-0 w-full object-contain pointer-events-none"
                           animate={{ scale: [1, 1.06, 1] }}
                           transition={{ repeat: Infinity, duration: 2.4, ease: 'easeInOut', delay: 0.15 + i * 0.18 + 0.42 }}
                         />
                       )}
                       {/* 点睛白光"叮"：弹入瞬间一次性径向高光(白色)，scale 放大、透明度 0→0.8→0(~0.5s)，仅点亮星 */}
                       {lit && (
                         <motion.span
                           className="absolute inset-0 pointer-events-none rounded-full"
                           style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.9) 0%, rgba(255,255,255,0) 60%)' }}
                           initial={{ scale: 0.5, opacity: 0 }}
                           animate={{ scale: [0.5, 1.4], opacity: [0, 0.8, 0] }}
                           transition={{ duration: 0.5, ease: 'easeOut', delay: 0.15 + i * 0.18 + 0.18 }}
                         />
                       )}
                     </motion.div>
                   );
                 })}
               </motion.div>
               {/* 「N 颗星！」：数字橙色高亮(更大) + 文字深棕。N 取真实 stars。位置微调 = LAYOUT.resultNumberY(px) */}
               <div className="text-3xl md:text-4xl font-bold leading-snug text-otter-text shrink-0" style={{ marginTop: LAYOUT.resultNumberY }}>
                 {lang === 'zh' ? (
                   <><span className="text-otter-orange font-display text-4xl md:text-5xl">{stars}</span> 颗星！</>
                 ) : (
                   <><span className="text-otter-orange font-display text-4xl md:text-5xl">{stars}</span> {stars === 1 ? 'star!' : 'stars!'}</>
                 )}
               </div>
             </div>
           ) : isPickStep ? (
             /* 选图步(⑥⑧)：选图题标签 / 问题 / 三张竖卡横排。本地判定，不调 AI。 */
             /* 标签/问题与语音步对齐(top-12%、标签同高46)；问题单行不折。反馈语另作绝对定位贴底(见下)，*/
             /* 不占垂直流 → 卡片(PICK_CARD_WIDTH)可随意调大，不会把反馈语挤出气泡身体。 */
             <div
               className="absolute left-[5%] right-[5%] top-[12%] bottom-[15%] flex flex-col items-center justify-center"
               style={{ gap: LAYOUT.pickGap }}
             >
               {/* 选图题标签（与语音题标签同高同位） */}
               <img src={ASSET.pickLabel} alt="" style={{ height: LAYOUT.pickLabel.height }} className="object-contain shrink-0" />
               {/* 问题文字：单行不折行（卡片够宽），字号同语音题 */}
               <div className="text-center text-2xl md:text-3xl lg:text-4xl font-bold leading-snug text-otter-text whitespace-nowrap shrink-0">
                 {lang === 'zh' ? current.zh : current.en}
               </div>
               {/* 三张选项卡横排（宽度由 PICK_CARD_WIDTH 统一控制） */}
               <div className="flex items-stretch justify-center shrink-0" style={{ gap: LAYOUT.pickGap }}>
                 {current.options!.map(id => {
                   const isPicked = pickSelected === id;
                   const settled = pickResult === 'right' || pickResult === 'revealed';
                   // 定案后：正解卡高亮放大、其余变暗；未定案：hover 微放大。
                   const ring = isPicked ? 'ring-4 ring-otter-orange scale-105' : settled ? 'opacity-40' : 'hover:scale-105';
                   return (
                     <button
                       key={id}
                       onClick={() => handlePick(id)}
                       disabled={settled}
                       style={{ pointerEvents: 'auto', width: PICK_CARD_WIDTH }}
                       className={`shrink-0 relative rounded-2xl transition-all disabled:cursor-default ${ring}`}
                     >
                       <img src={ASSET.pickCard(id)} alt="" className="w-full object-contain drop-shadow-lg rounded-2xl" />
                       <span className="absolute left-0 right-0 text-center text-sm md:text-base font-bold text-otter-text leading-tight" style={{ bottom: PICK_CARD_LABEL_BOTTOM }}>
                         {PICK_CARD_LABELS[id] ? (lang === 'zh' ? PICK_CARD_LABELS[id].zh : PICK_CARD_LABELS[id].en) : id}
                       </span>
                     </button>
                   );
                 })}
               </div>
               {/* 反馈语：答对/答错/揭晓时，居中盖在气泡身体中央(选项已定案不用再看)，半透明白药丸托底、*/}
               {/* z-50 确保在最上层不被继续按钮压住。脱离 flex 流：卡片再大也不挤它。 */}
               {pickResult !== 'idle' && displayedDialogText && (
                 <div className="absolute inset-0 z-50 flex items-center justify-center pointer-events-none px-[6%]">
                   <span className={`rounded-2xl bg-white/90 px-6 py-3 text-center text-xl md:text-2xl font-bold leading-snug shadow-lg ${pickResult === 'right' ? 'text-otter-orange' : 'text-otter-text'}`}>
                     {displayedDialogText}
                   </span>
                 </div>
               )}
             </div>
           ) : voiceAnswering ? (
             /* 语音答完态(④⑩)·AI 回复气泡：AI 整句回复用「中等字号」显示(区别于短 talk 句的超大字)， */
             /* 自然换行(不走 wrapCJK 的6字硬折)，配流式光标。修复「AI回复大字闪现/大→小跳变」。 */
             /* 外层定位区居中(短回复仍居中)；内层顶对齐限高可滚(长回复在气泡内向下滚、自动到底)，不再上下外溢。 */
             <div className="absolute left-[9%] right-[9%] top-[13%] bottom-[20%] flex items-center justify-center">
               <div
                 ref={aiScrollRef}
                 className="max-h-full overflow-y-auto text-center text-lg md:text-xl lg:text-2xl font-bold leading-snug text-otter-text whitespace-pre-line [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
               >
                 {displayedDialogText}
                 {isStreaming && <span className="animate-pulse">▍</span>}
               </div>
             </div>
           ) : (
             /* 普通步(talk/affirm)：文字绝对定位于气泡身体(14%~78%)，flex 居中。result 步走上面专属结算分支。 */
             <div className="absolute left-[10%] right-[10%] top-[14%] bottom-[22%] flex items-center justify-center text-center text-3xl md:text-4xl lg:text-5xl font-bold leading-relaxed text-otter-text whitespace-pre-line">
               <span>
                 {lang === 'zh' ? wrapCJK(displayedDialogText) : displayedDialogText}
                 {isStreaming && <span className="animate-pulse">▍</span>}
               </span>
             </div>
           )}
         </div>

         {/* 继续按钮（按钮2.png）—— 独立锚定屏幕底部：absolute bottom = LAYOUT.button.bottom，水平居中。 */}
         {/* 与卡片解耦：调 LAYOUT.card.top 改卡片↔进度条间距时，按钮原地不动。文案播完才出现。 */}
         {/* 「答完出按钮」决策：除「语音录音中/选图未答」本身外，每步答完都出继续按钮等用户点。 */}
         {/*   · talk/result：打字机播完(openingDone)出按钮。 */}
         {/*   · voice④⑩：AI 夸完(stepAnswered)出按钮 → 点击 advance 跳过紧随的⑤⑦肯定步。 */}
         {/*   · pick⑥⑧：答对(stepAnswered) 或 两次错揭晓(revealed) 出按钮。 */}
         {/*   · affirm⑤⑦ 已并入答题步(advance 跳过)，正常不会单独到达；保留判断作兜底。 */}
         {((openingDone && (current.type === 'talk' || current.type === 'result' || current.type === 'affirm'))
           || stepAnswered
           || (isPickStep && pickResult === 'revealed')) && (
           <button
             onClick={() => advance()}
             className="absolute left-1/2 -translate-x-1/2 hover:scale-105 active:scale-95 transition-transform shrink-0 pointer-events-auto"
             style={{ width: LAYOUT.button.width, bottom: LAYOUT.button.bottom }}
             aria-label={lang === 'zh' ? '继续' : 'Continue'}
           >
             {lang === 'zh' ? (
               <img src={ASSET.continueBtn} alt="" className="w-full object-contain drop-shadow-xl" />
             ) : (
               <div className="kid-button-primary w-full font-display font-bold text-white text-2xl tracking-wide" style={{ height: 56 }}>
                 Continue ▶
               </div>
             )}
           </button>
         )}
      </div>

    </div>
  );
}
