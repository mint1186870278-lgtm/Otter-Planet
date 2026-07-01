// src/hooks/useSpeechRecognition.ts
// 基于浏览器原生 Web Speech API 的流式语音识别。
// interimResults = true → 边说边出临时稿（实时刷新），断句后变成锁定稿。
// 主要在 Chrome / Edge 上稳定；Safari/Firefox 支持不全，isSupported 会是 false。
// 上线要全浏览器/更高准确率时，把这个 Hook 内部换成 Deepgram / Gladia 的 WebSocket 即可，
// 对外暴露的 { isListening, text, start, stop, reset, isSupported } 接口保持不变。

import { useCallback, useEffect, useRef, useState } from 'react';

function getSR(): any {
  if (typeof window === 'undefined') return null;
  return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
}

// 语音不可用的原因，供 UI 显示对应友好提示
//  - 'insecure'：浏览器有该 API，但页面非 HTTPS（Chrome 在非安全上下文会拒绝麦克风，start() 静默失败）
//  - 'unsupported'：浏览器压根没有该 API（Safari/Firefox 等）
//  - null：可用
export type SpeechUnavailableReason = 'insecure' | 'unsupported' | null;

function detectReason(): SpeechUnavailableReason {
  if (typeof window === 'undefined') return 'unsupported';
  if (!getSR()) return 'unsupported';
  // localhost 被浏览器视为安全上下文（dev 能用）；线上真域名走 HTTP 时 isSecureContext=false
  if (window.isSecureContext === false) return 'insecure';
  return null;
}

export function useSpeechRecognition(lang: string = 'zh-CN') {
  const recognitionRef = useRef<any>(null);
  const finalRef = useRef('');          // 已锁定文本（跨自动重启累积）
  const keepAliveRef = useRef(false);   // push-to-talk 期间是否应保持监听

  const [isListening, setIsListening] = useState(false);
  const [text, setText] = useState('');             // final + interim，实时
  // 运行时被拒：API 可用、上下文安全，但用户/系统拒绝了麦克风权限（onerror='not-allowed'）。
  // 与 unavailableReason 互补：后者是加载时就能判定的静态原因，这个是按下后才暴露的动态原因。
  const [micDenied, setMicDenied] = useState(false);
  // 不可用原因（惰性初始化，首帧即正确）。非 HTTPS 时即使 API 存在也判为不可用，避免按了静默失败。
  const [unavailableReason] = useState<SpeechUnavailableReason>(() => detectReason());
  const isSupported = unavailableReason === null;

  const start = useCallback(() => {
    const SR = getSR();
    if (!SR) return;

    // 防御：若已有实例，先摘掉回调再中止，避免旧实例在 onend 里自我重启 → 双识别器并行
    const prev = recognitionRef.current;
    if (prev) {
      prev.onresult = null;
      prev.onerror = null;
      prev.onend = null;
      try { prev.abort(); } catch { /* ignore */ }
    }

    // 复位本轮
    finalRef.current = '';
    setText('');
    setMicDenied(false);
    keepAliveRef.current = true;

    const rec = new SR();
    rec.lang = lang;
    rec.continuous = true;       // 持续听
    rec.interimResults = true;   // 关键：实时临时稿

    rec.onresult = (e: any) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const seg = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalRef.current += seg;
        else interim += seg;
      }
      setText(finalRef.current + interim);
    };

    rec.onerror = (e: any) => {
      // 权限被拒（浏览器拦截 / 系统未授权）：关掉自动续录，避免 onend→start 无限静默重试；
      // 并置 micDenied=true 让 UI 弹出「麦克风被挡住」提示。其余（no-speech / aborted 等）静默。
      if (e?.error === 'not-allowed' || e?.error === 'service-not-allowed') {
        keepAliveRef.current = false;
        setMicDenied(true);
        setIsListening(false);
      }
    };

    rec.onend = () => {
      // Chrome 在静音时会自动结束；若用户还按着，自动续上以保持连续录音
      if (keepAliveRef.current) {
        try { rec.start(); } catch { /* 已在跑则忽略 */ }
      } else {
        setIsListening(false);
      }
    };

    recognitionRef.current = rec;
    setIsListening(true);
    try { rec.start(); } catch { /* 重复 start 忽略 */ }
  }, [lang]);

  const stop = useCallback(() => {
    keepAliveRef.current = false;
    recognitionRef.current?.stop();
  }, []);

  const reset = useCallback(() => {
    keepAliveRef.current = false;
    const rec = recognitionRef.current;
    if (rec) { rec.onend = null; try { rec.abort(); } catch { /* ignore */ } }
    finalRef.current = '';
    setText('');
    setIsListening(false);
  }, []);

  // 卸载清理
  useEffect(() => () => {
    keepAliveRef.current = false;
    const rec = recognitionRef.current;
    if (rec) { rec.onend = null; try { rec.abort?.(); } catch { /* ignore */ } }
  }, []);

  return { isListening, text, isSupported, unavailableReason, micDenied, start, stop, reset };
}
