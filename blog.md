# super's blog 使用与架构说明

本文档面向博客的日常维护，说明如何添加文章、管理分类和标签、修改站点内容，以及各部分代码的职责。除非需要继续开发开屏、水面或鼠标特效，日常更新不需要进入 `src/splashScreen/`。

## 一、项目功能概览

本站是一个以 Astro 为主体、React 和 Three.js 承载实时图形效果的个人博客。

当前提供以下功能：

- 首页开屏动画、背景视频和持续水面效果。
- 首页展示最新 3 篇非草稿文章。
- 归档页按发布时间倒序展示全部非草稿文章。
- 笔记页展示 `category: Notes` 的文章。
- 随笔页展示 `category: Essay` 的文章。
- 文章详情页根据 Markdown 文件自动生成。
- 站点统计自动计算文章数、笔记数和去重后的标签数。
- 关于页、个人资料、顶部导航和响应式布局。
- Astro 页面过渡，切换页面时保留背景视频和水面场景。

当前尚未提供以下功能：

- 独立的分类列表页和分类详情页。
- 标签详情页或点击标签筛选。
- 后台管理界面或在线编辑器。
- 评论、搜索、RSS 和分页。
- 正式启用的 Live2D 模型。

## 二、日常维护速查

不修改动画时，最常用的文件如下：

| 需求 | 修改位置 | 说明 |
|---|---|---|
| 添加、修改、删除文章 | `src/content/posts/` | 一篇文章对应一个 `.md` 文件 |
| 修改文章字段规则 | `src/content.config.ts` | 定义标题、日期、分类、标签和草稿等字段 |
| 修改站点名称和个人资料 | `src/config.ts` | 标题、副标题、简介、作者资料、GitHub 和邮箱 |
| 修改顶部导航 | `src/config.ts` | 编辑 `navItems` |
| 修改关于页内容 | `src/pages/about.astro` | 关于页正文和资料项 |
| 修改首页文章数量 | `src/components/home/HomeView.astro` | 当前使用 `posts.slice(0, 3)` |
| 修改文章列表卡片 | `src/components/blog/PostCard.astro` | 日期、分类、标题、摘要和标签的展示方式 |
| 修改文章详情结构 | `src/pages/posts/[id].astro` | 文章标题区、元信息和 Markdown 正文容器 |
| 修改文章正文排版 | `src/styles/global.css` | 主要查看 `.article-prose` 相关规则 |
| 修改归档页 | `src/pages/archive.astro` | 全部文章列表和页面文案 |
| 修改笔记页 | `src/pages/notes.astro` | `Notes` 分类筛选和页面文案 |
| 修改三栏布局和公共页面框架 | `src/layouts/Layout.astro` | 顶栏、个人栏、统计栏和主内容槽位 |
| 修改背景视频素材 | `public/background/` 和 `BackgroundVideo.astro` | 不涉及水面 Shader，但需注意文件路径 |
| 添加文章图片等静态资源 | `public/` | 页面中使用以 `/` 开头的公开路径 |

通常不需要修改：

- `src/splashScreen/WaterScene.tsx`
- `src/splashScreen/PointerWaterLayer.tsx`
- `src/splashScreen/water/`
- `src/scripts/homeReveal.ts`

这些位置负责开屏、水面、鼠标拖动和入场时序，与文章内容无关。

## 三、添加一篇文章

### 1. 创建文件

在 `src/content/posts/` 中创建 Markdown 文件，例如：

```text
src/content/posts/my-first-post.md
```

建议文件名只使用小写英文字母、数字和连字符。文件名会成为文章 ID，并用于生成网址：

```text
my-first-post.md  ->  /posts/my-first-post
```

修改文件名会改变文章地址。文章发布后如果已有外部链接，尽量不要随意重命名。

`src/content.config.ts` 的匹配规则预留了 `.mdx`，但当前项目没有启用 `@astrojs/mdx` 集成。日常写作请使用 `.md`；需要在正文中直接使用组件时，再单独接入 MDX。

### 2. 添加文章元信息

每篇文章开头必须有 frontmatter：

```markdown
---
title: 我的第一篇文章
published: 2026-07-27
updated: 2026-07-28
description: 用一两句话概括文章内容，这段文字会显示在文章卡片和页面描述中。
category: Frontend
tags: [Astro, CSS, Blog]
draft: false
---

这里开始写正文。

## 第一个章节

正文支持标准 Markdown。
```

字段说明：

| 字段 | 必填 | 类型 | 用途 |
|---|---|---|---|
| `title` | 是 | 字符串 | 文章标题和浏览器页面标题 |
| `published` | 是 | 日期 | 发布时间，也是全部列表的排序依据 |
| `updated` | 否 | 日期 | 最后更新时间；当前模板暂未显示该字段 |
| `description` | 是 | 字符串 | 首页卡片摘要、文章导语和 SEO 描述 |
| `category` | 是 | 字符串 | 文章分类；`Notes` 具有特殊筛选含义 |
| `tags` | 否 | 字符串数组 | 文章标签；省略时自动使用空数组 |
| `draft` | 否 | 布尔值 | 是否为草稿；省略时默认为 `false` |

日期推荐统一使用 `YYYY-MM-DD`：

```yaml
published: 2026-07-27
```

不要给布尔值加引号：

```yaml
draft: true   # 正确
draft: "true" # 错误，会被当作字符串
```

### 3. 编写正文

正文可以直接使用常见 Markdown：

````markdown
## 二级标题

普通段落可以包含 **粗体**、*斜体* 和 [链接](https://example.com)。

- 无序列表
- 第二项

1. 有序列表
2. 第二项

> 引用内容

`行内代码`

```ts
const message = '带语言标记的代码块';
```
````

文章详情页会将正文放入 `.article-prose` 容器。标题、段落、链接、行内代码和代码块的公共样式位于 `src/styles/global.css`。

### 4. 添加图片

最直接的方式是把图片放到 `public/images/posts/`：

```text
public/images/posts/my-first-post/cover.webp
```

在 Markdown 中使用公开路径：

```markdown
![图片说明](/images/posts/my-first-post/cover.webp)
```

建议：

- 一篇文章使用一个同名子目录，避免素材混乱。
- 优先使用 WebP 或经过压缩的 PNG/JPEG。
- `alt` 不要留空，除非图片确实只是装饰。
- 不要在文章里引用电脑上的绝对路径。

### 5. 草稿与发布

未完成文章使用：

```yaml
draft: true
```

草稿会被以下位置统一排除：

- 首页最新文章。
- 归档页。
- 笔记页。
- 站点统计。
- 文章详情路由。

准备发布时改为：

```yaml
draft: false
```

开发服务器运行时，保存文件后页面通常会自动更新。正式部署后需要重新构建和发布站点。

## 四、分类与标签

### 当前分类机制

当前项目没有单独的“分类配置文件”。分类直接写在每篇文章的 `category` 字段中，并且区分大小写。

现有分类包括：

| 分类值 | 当前行为 | 卡片颜色 |
|---|---|---|
| `Frontend` | 普通文章分类 | 玫红色 |
| `Creative Coding` | 普通文章分类 | 默认青色 |
| `Notes` | 同时进入 `/notes`，并计入笔记数量 | 琥珀色 |
| `Essay` | 同时进入 `/essay` | 翡翠色 |
| 其他新分类 | 正常显示在文章和归档中 | 默认青色 |

### 添加普通分类

要添加一个新分类，不需要修改配置，只需在文章中使用新的值：

```yaml
category: Backend
```

该文章会正常出现在首页、归档和详情页，分类名称也会显示出来。

需要注意：新增分类不会自动产生 `/categories/backend` 页面，也不会自动加入顶部导航。当前项目只是显示分类名称。

### 让新分类拥有独立颜色

分类卡片的颜色映射位于：

```text
src/components/blog/PostCard.astro
```

当前逻辑对 `Frontend`、`Notes` 和 `Essay` 单独处理，其他分类使用默认青色。分类较多时，建议把颜色映射提取为对象，而不是继续增加嵌套条件。

文章详情页中的分类目前统一使用青色，对应文件：

```text
src/pages/posts/[id].astro
```

如果希望列表和详情颜色完全一致，应同时修改这两个位置，或抽出共享的分类配置。

### 添加一种新的“笔记型”分类

`/notes` 当前只识别完全一致的 `Notes`：

```ts
data.category === 'Notes'
```

因此 `Note`、`notes`、`随笔` 都不会进入笔记页，也不会计入笔记数量。如果只是新增普通分类，不要修改这里；如果希望多个分类都属于笔记，需要同时调整：

```text
src/pages/notes.astro
src/layouts/Layout.astro
```

### 标签

标签写成数组：

```yaml
tags: [Astro, WebGL, Shader]
```

标签会显示在文章卡片和详情页中。统计面板会对所有已发布文章的标签去重后计数。

标签名称同样区分大小写，例如 `WebGL` 和 `webgl` 会被计为两个标签。建议先复用现有拼写，避免重复。

当前标签不可点击，也没有标签详情页。

## 五、文章内容的显示流程

文章从文件到页面的流程如下：

```text
src/content/posts/*.md
        |
        v
src/content.config.ts
读取文件并校验 frontmatter
        |
        v
getCollection('posts')
        |
        +--> HomeView.astro       首页最新 3 篇
        +--> archive.astro        全部文章
        +--> notes.astro          Notes 分类
        +--> essay.astro          Essay 分类
        +--> Layout.astro         统计文章、笔记和标签数量
        +--> posts/[id].astro     生成文章详情页
```

`src/content.config.ts` 使用 Astro Content Collections 和 Zod 校验文章结构。字段缺失或类型错误时，开发服务器和构建过程会直接报告问题，防止不完整内容进入页面。

文章详情路由位于 `src/pages/posts/[id].astro`。构建时它会：

1. 获取全部非草稿文章。
2. 以文章 `id` 生成静态路径。
3. 调用 `render(post)` 渲染 Markdown 正文。
4. 把正文交给 `ContentLayout.astro` 和公共站点布局。

## 六、页面与路由

| 地址 | 文件 | 功能 |
|---|---|---|
| `/` | `src/pages/index.astro` | 首次进入时播放完整开屏，结束后地址替换为 `/index` |
| `/index` | `src/pages/index/index.astro` | 首页内容，不重复播放开屏 |
| `/archive` | `src/pages/archive.astro` | 全部非草稿文章，按时间倒序 |
| `/notes` | `src/pages/notes.astro` | 仅显示 `Notes` 分类 |
| `/essay` | `src/pages/essay.astro` | 仅显示 `Essay` 分类 |
| `/about` | `src/pages/about.astro` | 作者与站点介绍 |
| `/posts/<id>` | `src/pages/posts/[id].astro` | Markdown 文章详情 |
| 其他不存在的地址 | `src/pages/404.astro` | 自定义页面未找到提示 |

顶部导航配置位于 `src/config.ts`：

```ts
export const navItems = [
  { label: '首页', href: '/index' },
  { label: '笔记', href: '/notes' },
  { label: '随笔', href: '/essay' },
  { label: '关于', href: '/about' },
  { label: '友链', href: '/friend' },
] as const;
```

新增导航项前，应先在 `src/pages/` 创建对应页面。Astro 根据该目录自动生成路由。

## 七、架构介绍

### 总体分层

```text
页面与路由层
src/pages/
    |
    v
公共布局层
src/layouts/Layout.astro
src/layouts/ContentLayout.astro
    |
    +-------------------+
    |                   |
    v                   v
内容与界面层          视觉运行层
src/content/           src/splashScreen/
src/components/        src/scripts/homeReveal.ts
src/config.ts           public/background/
    |                   |
    +---------+---------+
              v
        浏览器最终页面
```

### 内容层

- `src/content/posts/` 保存文章正文。
- `src/content.config.ts` 定义文章数据结构。
- 页面通过 `getCollection('posts')` 查询文章。
- 内容在构建时加载，适合博客这种更新频率较低的静态内容。

### 页面与路由层

- `src/pages/` 中的文件直接决定访问地址。
- `[id].astro` 是动态路由模板，用于批量生成文章详情页。
- 页面主要负责查询数据和组合组件，不承载水面实现细节。

### 布局层

`src/layouts/Layout.astro` 是全站骨架，包含：

- 页面 `<head>`、标题和描述。
- 背景视频。
- Three.js 水面 React 岛。
- 顶部导航。
- 左侧个人资料。
- 右侧站点统计。
- 中间的页面内容槽位。
- Astro 页面过渡和路由内容替换。

`src/layouts/ContentLayout.astro` 在公共骨架上封装普通内容页，让归档、笔记、关于和文章详情保持一致的中间栏结构。

### 组件层

```text
src/components/home/
├─ BackgroundVideo.astro  背景视频
├─ HomeView.astro         查询并选择首页最新文章
├─ PersonalPanel.astro    个人资料
├─ RoutePanel.astro       首页文章列表容器
├─ StatsPanel.astro       站点统计
└─ TopBar.astro           顶部导航

src/components/blog/
└─ PostCard.astro         可复用文章卡片
```

首页、归档和笔记页共用 `PostCard.astro`，因此修改文章卡片会同时影响这三个位置。

### 样式层

- 组件内部主要使用 Tailwind CSS 工具类。
- `src/styles/global.css` 保存全局背景、布局表面、响应式规则、文章正文排版和视觉层级。
- 文章正文不是手写 Tailwind 类，而是由 `.article-prose` 统一控制。
- 仅修改正文阅读体验时，优先调整 `.article-prose`，不要进入水面 Shader。

### 视觉运行层

视觉部分与内容系统相互独立：

```text
BackgroundVideo.astro       HTML 视频背景
SplashScreen.tsx            React 入口和视觉层组合
WaterScene.tsx              开屏水滴、水面、水花和光照
PointerWaterLayer.tsx       鼠标拖动泡沫层
src/splashScreen/water/     GLSL Shader
homeReveal.ts               开屏和页面内容入场时序
```

文章内容、分类、标签、个人介绍和普通页面样式都不需要修改这些文件。

### 静态资源层

`public/` 中的文件会以网站根路径直接公开：

```text
public/images/example.webp -> /images/example.webp
public/background/video.mp4 -> /background/video.mp4
```

主要目录：

- `public/background/`：背景视频及相关素材。
- `public/audio/`：音频资源。
- `public/live2d/`：Live2D 运行时文件。
- `public/models/`：未来可放置导出的 Live2D 模型。

## 八、站点资料修改

站点和作者资料集中在 `src/config.ts`：

```ts
export const siteConfig = {
  title: "super's blog",
  subtitle: 'code / graphics / notes',
  description: '记录代码、图形与日常观察。',
  author: {
    name: 'Super',
    role: 'Frontend & creative coding',
    bio: '作者简介',
    focus: 'WebGL / Shader',
    location: 'China',
    github: 'https://github.com/',
    email: 'hello@example.com',
  },
} as const;
```

这些字段会影响：

- 浏览器标题和站点描述。
- 顶部品牌名称。
- 左侧个人资料面板。
- 关于页。
- GitHub 和邮箱链接。

关于页如果要增加更长的独立正文，应修改 `src/pages/about.astro`，而不是把全部内容塞进 `bio`。

## 九、开发服务器

按项目约定，开发服务器使用后台模式：

```bash
astro dev --background
```

管理后台服务器：

```bash
astro dev status
astro dev logs
astro dev stop
```

当前项目通常运行在：

```text
http://localhost:4321/
```

添加文章后建议检查：

1. 首页是否按日期显示最新文章。
2. `/archive` 是否出现文章。
3. `category: Notes` 的文章是否进入 `/notes`。
4. `/posts/<文件名>` 是否能打开。
5. 标题、摘要、标签和图片是否在窄屏下正常换行。
6. 草稿是否确实不可访问。

## 十、常见问题

### 文章没有出现在列表中

依次检查：

- 文件是否放在 `src/content/posts/`。
- 扩展名是否为 `.md`。
- `draft` 是否为 `true`。
- frontmatter 是否缺少必填字段。
- `published` 是否是可识别的日期。
- 开发服务器是否报告内容校验错误。

### 文章没有进入笔记页

确认分类完全一致：

```yaml
category: Notes
```

### 新分类没有独立页面

这是当前设计。`category` 只负责标记和显示，不会自动创建分类路由。需要分类浏览功能时，再增加分类页面和导航入口。

### `updated` 没有显示

当前 schema 接受 `updated`，但文章详情模板尚未渲染它。需要显示时修改 `src/pages/posts/[id].astro`。

### 标签数量比预期多

标签按字符串精确去重，大小写不同会被视为不同标签。统一 `WebGL`、`Three.js` 等固定写法。

### 图片显示为 404

如果图片位于 `public/images/posts/example.webp`，Markdown 路径应写成：

```markdown
![说明](/images/posts/example.webp)
```

不要在路径中包含 `public`。

## 十一、技术栈

| 技术 | 职责 |
|---|---|
| Astro 7 | 页面、路由、内容集合和静态生成 |
| Markdown / MDX | 文章内容 |
| React 19 | Three.js 客户端岛的组件边界 |
| Three.js | 水滴、水面、水花和视频纹理渲染 |
| Tailwind CSS 4 | 页面和组件样式 |
| GSAP | 开屏后的统一入场时间线 |
| GLSL | 水面、泡沫、粒子和光照 Shader |
| PixiJS / Live2D | 已安装的后续扩展能力，当前未作为主要页面功能启用 |

## 十二、后续扩展建议

内容规模增大后，可以按以下顺序扩展：

1. 把分类名称和颜色提取到共享配置，避免多个组件各自判断。
2. 增加 `/categories/` 和 `/tags/` 页面。
3. 在 schema 中把分类改为枚举或独立 collection，减少拼写不一致。
4. 为文章增加封面、置顶、系列和阅读时间字段。
5. 增加 RSS、站点地图、搜索和分页。

在这些需求出现前，保持当前单一 `posts` collection 更简单，也足够支撑个人博客。

## 官方参考

- [Astro Content Collections](https://docs.astro.build/en/guides/content-collections/)
- [Astro Routing](https://docs.astro.build/en/guides/routing/)
- [Astro Components](https://docs.astro.build/en/basics/astro-components/)
- [Astro Styles and CSS](https://docs.astro.build/en/guides/styling/)
