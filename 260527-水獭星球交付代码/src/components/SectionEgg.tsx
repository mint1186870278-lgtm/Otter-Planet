import { useState } from 'react';
import { useLang } from '../lib/lang';
import { motion, AnimatePresence } from 'motion/react';
import { track, isTestSession, isLocal } from '../lib/analytics';

// 提交端点（后端提供真实地址后填 .env 的 VITE_EGG_SUBMIT_URL）
const SUBMIT_URL = import.meta.env.VITE_EGG_SUBMIT_URL || '/api/otter-egg';
// 演示模式：VITE_EGG_DEMO=true 时跳过真实请求，直接走 success（端点没好也能完整演示）
const DEMO_MODE = import.meta.env.VITE_EGG_DEMO === 'true';

// 小水獭插画图位：把图放到 public/otter-baby.webp 即可自动启用；缺图时回退 emoji 🦦
const EGG_IMG = '/otter-baby.webp';

// 邮箱格式校验（仅英文版用；中文版留微信号不做格式校验）
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type SubmitStatus = 'idle' | 'loading' | 'success' | 'error';

export default function SectionEgg() {
  const { lang } = useLang();

  const [hasClaimed, setHasClaimed] = useState(false); // 领蛋后为 true，不可重复领
  const [formOpen, setFormOpen] = useState(false);     // 点了"想看后续内容"才展开留资输入框
  const [contact, setContact] = useState('');          // 英文版填邮箱，中文版填微信号
  const [contactError, setContactError] = useState(false);
  const [status, setStatus] = useState<SubmitStatus>('idle');
  const [skipped, setSkipped] = useState(false); // 点了"以后再说"
  const [eggImgOk, setEggImgOk] = useState(true); // 蛋图加载失败则回退 emoji

  // 中英分流：两套文案非互译，按各自语境写（不是翻译）。「神秘惊喜」钩子团队待定，先留口子。
  const t = {
    zh: {
      claim: '领取我的小水獭 🦦',
      claimedTitle: '恭喜你领到了一只小水獭！',
      claimedDesc: '它正在悄悄长大，会陪你去更多冒险哦～',
      // 留资前的引导：先抛出"期待后续版本吗"，点了才展开输入框
      teaser: '期待和小水獭一起解锁更多冒险吗？\n后续新版本上线，第一时间想收到通知就点这里 👇',
      teaserBtn: '我想看后续内容 ✨',
      // 注：团队后续可能加「填微信号有神秘惊喜」的钩子，现在先用朴实版，文案集中在此方便改。
      mailGuide: '留下你的微信号，我们会告诉你水獭宝宝的成长近况~',
      placeholder: '你的微信号',
      submit: '提交',
      submitting: '提交中…',
      skip: '以后再说',
      invalid: '请填写微信号',
      success: '记下啦！水獭宝宝的近况我们会通过微信告诉你 📬',
      fail: '提交失败，请稍后再试',
      retry: '重试',
      skippedMsg: '没关系～小水獭已经是你的啦，它会慢慢长大的 🌱',
    },
    en: {
      claim: 'Claim your baby otter 🦦',
      claimedTitle: 'You got a baby otter!',
      claimedDesc: "It's quietly growing — soon it'll join you on more adventures!",
      teaser: "Can't wait to unlock more adventures with your otter?\nTap here to be the first to know when the next version drops 👇",
      teaserBtn: 'Yes, keep me posted ✨',
      mailGuide: "Join our waiting list — leave your email to follow the baby otter's journey 💌",
      placeholder: 'Your email',
      submit: 'Join',
      submitting: 'Joining…',
      skip: 'Maybe later',
      invalid: 'Please enter a valid email',
      success: "You're on the list! We'll send the baby otter's news to your inbox 📬",
      fail: 'Something went wrong, please try again',
      retry: 'Retry',
      skippedMsg: "That's okay — the baby otter is yours, and it will keep growing 🌱",
    },
  }[lang];

  const handleClaim = () => {
    if (hasClaimed) return;
    setHasClaimed(true);
  };

  const submitContact = async () => {
    if (status === 'loading') return;
    const value = contact.trim();
    // 校验分流：英文版邮箱走正则；中文版微信号无标准格式，只校验非空
    const valid = lang === 'en' ? EMAIL_RE.test(value) : value !== '';
    if (!valid) {
      setContactError(true);
      return;
    }
    setContactError(false);
    setStatus('loading');

    // 埋点：留存提交动作（只报动作 + 类型，绝不报微信号/邮箱内容本身）
    track('retention_submit', { lang, kind: lang === 'zh' ? 'wechat' : 'email' });

    // 演示兜底 / 本地环境：跳过真实请求，假装成功，让全流程可演（本地测的留资不进线上库）
    if (DEMO_MODE || isLocal()) {
      setTimeout(() => setStatus('success'), 600);
      return;
    }

    try {
      // 按语言带不同字段：中文留微信号 wechat，英文留邮箱 email；两种后端都要能接收存储
      // 自测浏览器（?test=1）留资带 test:1，看板默认剔除
      const testFlag = isTestSession() ? { test: 1 } : {};
      const payload = lang === 'zh'
        ? { wechat: value, lang: 'zh', source: 'otter-egg', ...testFlag, ts: Date.now() }
        : { email: value, lang: 'en', source: 'otter-egg', ...testFlag, ts: Date.now() };
      const res = await fetch(SUBMIT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(String(res.status));
      setStatus('success');
    } catch (_e) {
      setStatus('error');
    }
  };

  const mailboxDone = status === 'success' || skipped;

  return (
    <div className="w-full h-full relative overflow-hidden flex flex-col items-center justify-center bg-[url('/egg-bg.webp')] bg-cover bg-center px-6 py-10">

      {/* 阶段 1：领蛋按钮（未领时居中显示）*/}
      <AnimatePresence mode="wait">
        {!hasClaimed ? (
          <motion.div
            key="claim"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.85 }}
            transition={{ duration: 0.35, ease: 'easeOut' }}
            className="flex flex-col items-center"
          >
            <motion.button
              onClick={handleClaim}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.96 }}
              className="kid-button-primary !bg-otter-orange !shadow-[0_8px_0_#cc7400] text-2xl md:text-4xl font-display font-bold px-10 md:px-16 py-5 md:py-7 rounded-[28px] text-white"
            >
              {t.claim}
            </motion.button>
          </motion.div>
        ) : (
          /* 领蛋后：蛋 + 文案 + 留资区 */
          <motion.div
            key="claimed"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4 }}
            className="flex flex-col items-center w-full max-w-xl"
          >
            {/* 蛋（呼吸 + 轻摇动画）*/}
            <motion.div
              initial={{ scale: 0.4, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              transition={{ type: 'spring', stiffness: 220, damping: 16, delay: 0.1 }}
              className="mb-6"
            >
              <motion.div
                animate={{ scale: [1, 1.06, 1], rotate: [-3, 3, -3] }}
                transition={{ repeat: Infinity, duration: 3.2, ease: 'easeInOut' }}
                className="flex items-center justify-center"
                style={{ filter: 'drop-shadow(0 10px 20px rgba(0,0,0,0.2))' }}
              >
                {eggImgOk ? (
                  <img
                    src={EGG_IMG}
                    alt="little otter"
                    onError={() => setEggImgOk(false)}
                    className="w-40 h-40 md:w-56 md:h-56 object-contain"
                  />
                ) : (
                  <span className="text-[7rem] md:text-[10rem] leading-none">🦦</span>
                )}
              </motion.div>
            </motion.div>

            {/* 温馨文案 */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, duration: 0.4 }}
              className="text-center mb-8"
            >
              <h2 className="font-display font-bold text-white text-2xl md:text-4xl drop-shadow-md mb-2 flex items-center justify-center gap-2">
                {t.claimedTitle}
                <img src="/Star.webp" alt="" className="w-7 h-7 md:w-10 md:h-10 object-contain drop-shadow" />
              </h2>
              <p className="text-white/90 font-bold text-base md:text-xl">
                {t.claimedDesc}
              </p>
            </motion.div>

            {/* 阶段 2：留资区（淡入 + 上滑浮现）—— 英文留邮箱 / 中文留微信号 */}
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.55, duration: 0.45, ease: 'easeOut' }}
              className="w-full"
            >
              <div className="kid-panel p-6 md:p-8 flex flex-col items-center gap-4">
                {mailboxDone ? (
                  /* 完成态：提交成功 或 跳过 */
                  <p className="text-center text-otter-text font-bold text-lg md:text-2xl leading-relaxed py-2">
                    {status === 'success' ? t.success : t.skippedMsg}
                  </p>
                ) : !formOpen ? (
                  /* 引导态：先问"期待后续版本吗"，点了才展开输入框 */
                  <>
                    <p className="text-center text-otter-text font-bold text-base md:text-xl leading-relaxed whitespace-pre-line">
                      {t.teaser}
                    </p>
                    <button
                      onClick={() => { track('retention_form_open', { lang }); setFormOpen(true); }}
                      className="kid-button-primary !bg-otter-orange !shadow-[0_6px_0_#cc7400] w-full text-lg md:text-xl font-display font-bold py-3 rounded-2xl text-white"
                    >
                      {t.teaserBtn}
                    </button>
                    {/* 可跳过：领蛋已成功，不强迫留资 */}
                    <button
                      onClick={() => { track('retention_skip'); setSkipped(true); }}
                      className="text-otter-text/60 hover:text-otter-text text-sm md:text-base font-bold underline underline-offset-2"
                    >
                      {t.skip}
                    </button>
                  </>
                ) : (
                  <>
                    <p className="text-center text-otter-text font-bold text-base md:text-xl leading-relaxed whitespace-pre-line">
                      {t.mailGuide}
                    </p>

                    <div className="w-full flex flex-col gap-1">
                      <input
                        type={lang === 'en' ? 'email' : 'text'}
                        inputMode={lang === 'en' ? 'email' : 'text'}
                        value={contact}
                        onChange={e => { setContact(e.target.value); if (contactError) setContactError(false); }}
                        onKeyDown={e => { if (e.key === 'Enter') submitContact(); }}
                        disabled={status === 'loading'}
                        placeholder={t.placeholder}
                        autoFocus
                        className="w-full px-4 py-3 rounded-2xl border-2 border-otter-orange/40 focus:border-otter-orange outline-none text-lg text-otter-text disabled:opacity-50"
                      />
                      {contactError && (
                        <span className="text-red-500 text-sm font-bold pl-2">{t.invalid}</span>
                      )}
                      {status === 'error' && (
                        <span className="text-red-500 text-sm font-bold pl-2">{t.fail}</span>
                      )}
                    </div>

                    <button
                      onClick={submitContact}
                      disabled={status === 'loading'}
                      className="kid-button-primary !bg-otter-orange !shadow-[0_6px_0_#cc7400] w-full text-lg md:text-xl font-display font-bold py-3 rounded-2xl text-white disabled:opacity-60"
                    >
                      {status === 'loading' ? t.submitting : status === 'error' ? t.retry : t.submit}
                    </button>

                    {/* 可跳过：领蛋已成功，不强迫留资 */}
                    <button
                      onClick={() => { track('retention_skip'); setSkipped(true); }}
                      disabled={status === 'loading'}
                      className="text-otter-text/60 hover:text-otter-text text-sm md:text-base font-bold underline underline-offset-2 disabled:opacity-50"
                    >
                      {t.skip}
                    </button>
                  </>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
