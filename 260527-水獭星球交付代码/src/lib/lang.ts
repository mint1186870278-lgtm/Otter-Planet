import { createContext, useContext } from 'react';

export type Language = 'zh' | 'en';

interface LangContextType {
  lang: Language;
  toggleLang: () => void;
}

export const LangContext = createContext<LangContextType>({
  lang: 'zh',
  toggleLang: () => {},
});

export const useLang = () => useContext(LangContext);
