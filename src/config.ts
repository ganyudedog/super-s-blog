export const siteConfig = {
  title: "super's blog",
  subtitle: 'code / graphics / notes',
  description: '记录代码、图形与日常观察。',
  author: {
    name: 'Super',
    role: 'Frontend & creative coding',
    bio: '记录代码、图形与日常观察，也保存那些值得反复推敲的实现细节。',
    focus: 'WebGL / Shader',
    location: 'China',
    github: 'https://github.com/',
    email: 'hello@example.com',
  },
} as const;

export const navItems = [
  { label: '首页', href: '/index' },
  { label: '归档', href: '/archive' },
  { label: '笔记', href: '/notes' },
  { label: '关于', href: '/about' },
] as const;
