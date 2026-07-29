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

export const navItems = [
  { label: '首页', href: '/index' },
  { label: '笔记', href: '/notes' },
  { label: '随笔', href: '/essay' },
  { label: '关于', href: '/about' },
  { label: '友链', href: '/friend' }
] as const;

export interface FriendItem {
  name: string;
  description: string;
  href: string;
  avatar: string;
}

export const friendItems:FriendItem[] = [] ;

export const friendSiteInfo: FriendItem = {
  href: '',
  name: siteConfig.title,
  description: '月相流转之间，我以我为锚点。',
  avatar: '/image/favicon.ico',
};
