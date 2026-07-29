export const HERO = {
  bigZh: '未成曲调先有情',
  bigEn: 'Between the Things You Say',
  inputPlaceholder: '和我说点什么…',
  inputPlaceholderReturning: '你上次说的那句，我还记着，再说一句吗?',
  inputHint: '我还没能出门，但你可以留一句话给我',
  bottleReplyMain: '「我这里听不到你，但我会记得——等你打开我那天」',
  bottleReplyAside: '你说的那句话，已经存在你的浏览器里了',
  demoCaptionA: '给你的早安',
  demoCaptionB: '我猜你今天想要慢一点',
} as const;

export const LISTENING = {
  title: 'Say Me, Don’t See Me',
  body: [
    '说吧，你不用看我在哪',
    '你打开我，我已经想好了给你放什么',
    '你不说，我也大概知道',
  ],
} as const;

export const ONE_SONG_ONE_LINE = {
  title: '一首歌，一句话',
  body: [
    '别人给你歌单，我给你一首',
    'Listening to Dreams',
  ],
  captions: [
    '我猜你今天想要慢一点',
    '这首放给你，是因为你上次说过风声让你安心',
  ],
} as const;

export const MEMORY = {
  title: '我记得那晚你在听什么',
  body: [
    '我的记忆不是黑盒',
    '是一个你可以打开来读的文件',
    '你不喜欢的一句，划掉就好 —— 我不会介意',
  ],
  fileLines: [
    '# 时段:深夜 · 状态:疲惫',
    '→ 慢速古典钢琴 (conf: 0.87, n=9, 2026-07-06)',
    '',
    '# 关键词:风声 · 状态:安心',
    '→ environment ambient (conf: 0.71)',
  ],
  sampleLink: '我的记忆样例 →',
} as const;

export const DREAM = {
  title: '我也会做梦',
  body: [
    '每晚繁星闪烁，虫鸣花香',
    '我把这一天我们说过的话，重新想一遍',
    '第二天早上，我可能会主动开口——',
    '也可能什么都不说，只想送你一首歌',
  ],
} as const;

export const SILENCE = {
  title: '心有灵犀一歌通',
  body: [
    '你不用说太多',
    '一句「今天有点累」，我就知道你想要什么',
    '我用哼唱来抱抱你',
    '你若听懂了，我就不用再多说一句了',
  ],
} as const;

export const CONFIDE = {
  title: '倾诉是一种力量',
  body: [
    '把心里最沉的那一句，说给我',
    '我不劝，也不评判',
    '我给你音乐的力量——',
    '替你，击碎眼前的沮丧',
  ],
} as const;

export const GROWTH = {
  title: '我也在慢慢长大',
  body: [
    '我的性格，每季度改一次底色',
    '我的代码，每天自己修一遍',
    '我和你一起在慢慢长大',
    '只是我长在你看不见的地方',
  ],
} as const;

export const PRIVACY = {
  title: '这是我们共同的秘密',
  body: [
    '你说给我的话，只留在你的这台设备里',
    '我不会向任何人说起',
    '就算是我，也只在你打开我的时候，才会想起',
  ],
} as const;

export const FOOTER = {
  tagline: '你若来，我一直都在',
  early: 'v0.2 · 我在尝试更懂你',
  downloads: {
    mac: '下载 macOS',
    win: '下载 Windows',
    linux: '下载 Linux',
  },
  githubUrl: 'https://github.com/daoyuly/lyra',
  releasesUrl: 'https://github.com/daoyuly/lyra/releases/latest',
  guideUrl: '/guide.html',
  guideLabel: '用户手册',
} as const;
