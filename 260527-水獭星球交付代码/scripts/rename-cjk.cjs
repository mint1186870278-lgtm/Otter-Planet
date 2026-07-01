const fs = require('fs');
const path = require('path');

// 中文名 → 英文名 映射(同目录内文件名)
const MAP = {
  'public/section-visual-novel-material': {
    '背景new.webp': 'bg.webp',
    '主卡片.webp': 'card.webp',
    'ip人物.webp': 'ip.webp',
    '按钮1.webp': 'btn-back.webp',
    '按钮2.webp': 'btn-continue.webp',
    '进度条初始.webp': 'progress-0.webp',
    '进度条1.webp': 'progress-1.webp',
    '进度条2.webp': 'progress-2.webp',
    '进度条3.webp': 'progress-3.webp',
    '进度条4.webp': 'progress-4.webp',
    '进度条5.webp': 'progress-5.webp',
    '冒险标签无文字.webp': 'adv-label.webp',
    '星星数初始无数字.webp': 'star-count.webp',
    '语音题标签.webp': 'voice-label.webp',
    '语音条文字框.webp': 'voice-bar.webp',
    '麦克风按钮.webp': 'mic.webp',
    '选图题标签.webp': 'pick-label.webp',
    '星星.webp': 'star.webp',
    '组件框.webp': 'frame.webp',
  },
  'public/star-progress-bar': {
    '星星.webp': 'star.webp',
    '星星进度条0.webp': 'progress-0.webp',
  },
  '.': {
    '星星闪闪.png': 'shining-star.png',
  },
};

let done = 0, miss = 0;
for (const [dir, files] of Object.entries(MAP)) {
  for (const [from, to] of Object.entries(files)) {
    const src = path.join(dir, from);
    const dst = path.join(dir, to);
    if (fs.existsSync(src)) {
      fs.renameSync(src, dst);
      console.log('✓ ' + dir + '/  ' + from + ' → ' + to);
      done++;
    } else {
      console.log('✗ 找不到(可能已改): ' + src);
      miss++;
    }
  }
}
console.log(`\n重命名 ${done} 个, 跳过 ${miss} 个`);
