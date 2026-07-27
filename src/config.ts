export const siteConfig = {
  title: "ganyudedog's blog",
  subtitle: 'code / graphics / notes',
  description: '记录代码、图形与日常观察。',
  author: {
    name: '甘雨的狗',
    role: 'Frontend & creative coding',
    bio: '记录代码、图形与日常观察，也保存那些值得反复推敲的实现细节。',
    focus: 'WebGL / react',
    location: 'China',
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
