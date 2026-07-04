import React from 'react';
import { useLang } from '../lib/lang';
import { Globe, Map, Backpack, Smile, Settings } from 'lucide-react';
import { motion } from 'motion/react';

interface NavbarProps {
  hideIcons?: boolean;
  iconsFlyOut?: boolean;
}

export default function Navbar({ hideIcons = false, iconsFlyOut = false }: NavbarProps) {
  const { lang, toggleLang } = useLang();

  const labels = {
    zh: { map: '地图', backpack: '背包', friends: '好友', settings: '设置', lang: '中文' },
    en: { map: 'Map', backpack: 'Bag', friends: 'Pals', settings: 'Settings', lang: 'EN' }
  };

  const currentLabels = labels[lang];

  return (
    <>
      {/* Lang Switch — always visible */}
      <div className="absolute top-6 left-8 z-50">
        <button
          onClick={toggleLang}
          className="kid-button-secondary w-14 h-14 !rounded-full group relative flex-col gap-1 shadow-md border-0"
        >
          <div className="text-otter-orange group-hover:scale-110 transition-transform flex items-center justify-center">
            <Globe className="w-6 h-6" />
          </div>
          <span className="absolute -bottom-8 text-sm font-bold text-white drop-shadow-md">
            {currentLabels.lang}
          </span>
        </button>
      </div>

      {/* Right icons — fly out when iconsFlyOut, hidden when hideIcons */}
      <motion.div
        className="absolute top-6 right-8 z-50 flex items-center gap-4"
        animate={
          iconsFlyOut ? { x: 200, opacity: 0 } : hideIcons ? { x: 200, opacity: 0 } : { x: 0, opacity: 1 }
        }
        transition={{ duration: 0.5 }}
      >
        <div className="flex gap-4">
          <NavIcon icon={<Map className="w-7 h-7" />} label={currentLabels.map} />
          <NavIcon icon={<Backpack className="w-7 h-7" />} label={currentLabels.backpack} />
          <NavIcon icon={<Smile className="w-7 h-7" />} label={currentLabels.friends} />
          <NavIcon icon={<Settings className="w-7 h-7" />} label={currentLabels.settings} />
        </div>
      </motion.div>
    </>
  );
}

function NavIcon({ icon, label }: { icon: React.ReactNode, label: string }) {
  return (
    <button className="flex flex-col items-center gap-3 group">
      <div className="kid-button-secondary w-14 h-14 !rounded-full">
        <div className="text-otter-orange group-hover:scale-110 transition-transform">
          {icon}
        </div>
      </div>
      <span className="text-sm font-bold drop-shadow-md">{label}</span>
    </button>
  );
}
