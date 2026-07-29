// 站点总配置
export const siteConfig = {
  title: "ganyudedog's blog",
  subtitle: 'code / graphics / notes',
  description: '记录代码、图形与日常观察。',
  author: {
    name: '甘雨的狗',
    role: 'Frontend & creative coding',
    bio: '当是干雩逢甘雨,愿以清心报卿心',
    focus: 'WebGL / react',
    location: 'China | 中国',
    github: 'https://github.com/ganyudedog',
    email: '2655314552@qq.com',
  },
} as const;

// topbar配置
export const navItems = [
  { label: '首页', href: '/index' },
  { label: '笔记', href: '/notes' },
  { label: '随笔', href: '/essay' },
  { label: '关于', href: '/about' },
  { label: '友链', href: '/friend' }
] as const;

// 标签颜色只控制文字和边框；新增标签时在这里补充即可。
export const tagColors = {
  browser: 'border-cyan-200/70 text-cyan-100',
  frondend: 'border-pink-200/70 text-pink-100',
  kernel: 'border-violet-200/70 text-violet-100',
  leetcode: 'border-amber-200/70 text-amber-100',
  think: 'border-emerald-200/70 text-emerald-100',
  typescript: 'border-sky-200/70 text-sky-100',
  react: 'border-blue-200/70 text-blue-100',
} as const;

export const defaultTagColor = 'border-slate-200/60 text-slate-100';

export function getTagColor(tag: string) {
  return tagColors[tag as keyof typeof tagColors] ?? defaultTagColor;
}

// 友链以及个人配置
export interface FriendItem {
  name: string;
  description: string;
  href: string;
  avatar: string;
}

export const friendItems:FriendItem[] = [
  {
    name: '社亦园的旅行笔记',
    description: '世界没了我可能会更好，所以我要继续活着',
    href: 'https://blog.sheyiyuan.com/',
    avatar: 'https://blog.sheyiyuan.com/icons/01.png'
  },
  {
    name: '一曝十寒',
    description: '纵使不安彷徨，即便茫然无措，也依然迈步前行',
    href: 'https://yuhhhy.cn/',
    avatar: 'https://yuhhhy.cn/images/avatar.jpg'
  },
  {
    name: "Bakka's Blog",
    description: '喜欢创作',
    href: 'https://bakkac.github.io/BakkacBlog/',
    avatar: 'https://bakkac.github.io/BakkacBlog/kumiko.jpg'
  }
];

export const friendSiteInfo: FriendItem = {
  href: '',
  name: '甘雨的狗',
  description: '月相流转之间，我以我为锚点。',
  avatar: '/image/favicon.ico',
};
