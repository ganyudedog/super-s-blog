# 技术栈与依赖说明

## 项目概述
基于 Astro v7 构建的个人博客，支持 WebGL 动画与 Live2D 模型交互。

---

## 核心依赖

| 包名 | 版本 | 用途 |
|------|------|------|
| `astro` | ^7.1.1 | 静态站点生成框架 |
| `pixi.js` | ^8.19.0 | WebGL 2D 渲染引擎 |
| `react` | ^19.2.7 | UI 组件管理 |
| `react-dom` | ^19.2.7 | React DOM 渲染 |
| `@astrojs/react` | ^6.0.1 | Astro 的 React 集成（Islands 架构） |
| `@pixi/react` | ^8.0.5 | PixiJS 的 React 渲染器 |
| `three` | ^0.185.1 | 开屏水面、透视、光照与水花的 WebGL 3D 渲染 |
| `untitled-pixi-live2d-engine` | ^1.3.1 | Live2D Cubism 2-5 模型渲染支持 |

---

## 外部依赖（需手动下载）

| 文件 | 用途 | 来源 |
|------|------|------|
| `live2dcubismcore.min.js` | Cubism 3/4/5 运行时 | [Cubism SDK for Web](https://www.live2d.com/download/cubism-sdk/download-web/) |
| `live2d.min.js` | Cubism 2.1 运行时（旧版） | [GitHub](https://github.com/dylanNew/live2d/tree/master/webgl/Live2D/lib) |

---

## 版本兼容性说明

### PixiJS v8 + React
- `@pixi/react` v8 **强制要求 React 19**
- 使用 `extend()` API 注册 PixiJS 类，通过 `<pixiSprite>`, `<pixiContainer>` 等 JSX 元素使用
- 动画通过 `useTick` hook 驱动每帧回调
- 在 Astro 中使用 `client:only="react"` 指令（PixiJS 依赖浏览器 API，不支持 SSR）

### Live2D 模型
- 模型格式：`.model3.json`（Cubism 3/4/5）或 `.model.json`（Cubism 2.1）
- 模型文件放置位置：`public/models/`
- `live2dcubismcore.min.js` 需通过 `<script>` 标签在页面加载前引入

---

## 开发命令

```bash
pnpm dev          # 启动开发服务器
pnpm build        # 构建生产版本
pnpm preview      # 预览构建结果
```

---

## 开场动画设计方案（水滴波纹主题）

### 效果描述
水滴滴下 → 泛起波纹（柏林噪声控制） → 动态壁纸从水纹中浮起显现

### 素材位置
`public/background/`
- `WUWA 尤诺H.264.mp4` - 网页实际使用的 H.264 动态壁纸视频
- `WUWA 尤诺.mp4` - Wallpaper Engine 导出的 HEVC 原文件，仅保留归档
- `preview.gif` - 预览动图
- `project.json` - 元数据

### 技术架构

```
┌─────────────────────────────────────────┐
│         Splash Animation                │
├─────────────────────────────────────────┤
│  Phase 1: 水滴下落                       │
│           (Three.js 椭球 + 重力时间线)    │
├─────────────────────────────────────────┤
│  Phase 2: 高度纹理                       │
│           (柏林噪声 + 径向衰减波)         │
├─────────────────────────────────────────┤
│  Phase 3: 真实水面                       │
│           (透视平面 + 法线 + 夜间光照)     │
├─────────────────────────────────────────┤
│  Phase 4: 撞击水花                       │
│           (InstancedMesh + 水柱 + 水环)   │
└─────────────────────────────────────────┘
```

### 技术选型

| 功能 | 技术 | 说明 |
|------|------|------|
| 水滴动画 | Three.js Mesh | 椭球形水滴下落并在撞击时隐藏 |
| 波纹高度 | GLSL + WebGLRenderTarget | 第一遍渲染生成可复用高度纹理 |
| 柏林噪声 | GLSL Shader | 控制基础水面和径向波纹的不规则性 |
| 水面显示 | Three.js ShaderMaterial | 第二遍渲染位移平面、法线和夜间反射 |
| 光效 | Blinn-Phong + Fresnel | 左上方真实光源驱动高光与边缘反射 |
| 水花 | InstancedMesh | 撞击时生成水滴粒子、水柱与扩散水环 |
| 视频背景 | HTML5 `<video>` | 后续读取高度纹理作为壁纸扭曲滤镜 |

### Shader 资源获取
- [ShaderGif](https://shadergif.com/) - GLSL 社区，有教程和示例（无需翻墙）
- [Neort](https://neort.io/popular) - 数字艺术家社区（无需翻墙）
- [Shaderoo](https://shaderoo.org/) - Shadertoy 镜像替代（无需翻墙）
- [Smoothstep](https://smoothstep.io/) - 动画 Shader 模板（无需翻墙）
- [shader-web-background](https://github.com/xemantic/shader-web-background) - GLSL 背景库

### 资源清单

| 资源 | 位置 | 说明 |
|------|------|------|
| 动态壁纸视频 | `public/background/WUWA 尤诺H.264.mp4` | 网页主要背景素材，1920x1080、30 FPS、13.37 秒 |
| 水滴素材 | 不需要 | Three.js 几何体实时渲染 |
| 柏林噪声 Shader | `src/splashScreen/water/height.frag` | 控制水面高度和波纹 |

### 动画流程

1. Three.js 初始化透视相机和夜晚水面
2. Height Pass 持续生成柏林噪声高度纹理
3. 水滴从顶部加速下落并撞击水面
4. 撞击点向高度纹理注入径向衰减波
5. Water Pass 读取高度纹理，计算位移、法线、反射和左上方光照
6. 撞击同步生成水花粒子、水柱和扩散水环
7. 后续将同一高度纹理用于动态壁纸浮现滤镜

---

## 博客主页布局与入场动画实施方案

### 目标与约束

主页由五部分组成：背景视频、顶部栏、左侧个人块、右侧统计块和中间路由块。顶部栏独立于内容网格；个人块、统计块和路由块放在同一个透明结构容器内。容器只负责布局，不再增加一层可见卡片背景，避免出现卡片套卡片。

渲染层级固定为：

```text
z-index 0   背景视频
z-index 10  持续存在的 Three.js 水面 Canvas
z-index 20  个人块、统计块、路由块
z-index 30  顶部栏
```

根节点使用 `isolation: isolate` 建立独立层叠上下文。背景视频和水面使用 `position: fixed`，页面内容正常滚动。水面 `pointer-events: none`，不拦截导航和文章交互。

### 组件边界

保持 Astro 负责静态页面、语义结构、路由和 SEO，不将整站改造成 React SPA。React 岛只继续承载 Three.js 水面。

```text
Layout.astro
├─ BackgroundVideo.astro        # 固定背景视频层
├─ SplashScreen.tsx             # 持续存在的水面层，后续可更名 WaterLayer
├─ TopBar.astro                  # 顶部导航
└─ MainGrid.astro               # 透明的网格结构容器
   ├─ PersonalPanel.astro       # 左侧个人块
   ├─ StatsPanel.astro          # 右侧统计块
   └─ RoutePanel.astro          # 中间路由内容，内部承载 <slot />
```

页面入场由一个轻量脚本统一监听 `water:reveal` 事件并创建 GSAP 时间线。项目已经安装 `gsap`，不再引入 Framer Motion 或第二套动画状态系统。

### Fuwari 风格桌面布局

参考 Fuwari 的主网格节奏，桌面使用“稳定侧栏 + 弹性正文 + 辅助栏”，而不是把所有区域压进等宽轨道：

```text
┌──────────────┬──────────────────────────────────┬────────────┐
│ 个人侧栏 15rem │      路由/文章正文 minmax(0, 1fr)   │ 统计 13rem │
└──────────────┴──────────────────────────────────┴────────────┘
```

容器最大宽度为 `1280px`，列间距为 `1.25rem`。路由区自身不绘制外层卡片背景，文章列表中的每篇文章才是独立卡片，避免卡片套卡片。所有可见表面圆角不超过 8px，背景统一为 `rgba(5, 10, 18, 0.3)`，文字层保持 `opacity: 1`。

### 响应式布局

DOM 顺序直接写成“个人、统计、路由”，保证移动端视觉顺序和键盘/读屏顺序一致；桌面端只通过 Grid 定位改变位置。

| 范围 | 布局 |
|------|------|
| `>= 1280px` | 三列：15rem 个人栏、弹性正文、13rem 统计栏 |
| `768px - 1279px` | 两列：15rem 侧栏 + 弹性正文，统计块位于个人块下方 |
| `< 768px` | 单列：个人块 → 统计块 → 路由块 |

移动端补充规则：

- 顶部栏保留品牌、当前路由和菜单按钮，其余导航进入菜单。
- 面板宽度使用 `min-width: 0`，长标题允许换行。
- 不使用固定高度，避免个人资料和统计数据溢出。
- 视频继续全屏 `cover`，建议 `object-position: 54% 50%`，优先保住人物脸部、伸出的手和身体主体。
- 长页面滚动时背景视频与水面固定，内容层滚动。

### 背景视频策略

实际使用 `public/background/WUWA 尤诺H.264.mp4`：

```html
<video autoplay muted loop playsinline preload="auto" aria-hidden="true">
```

视频元素在开屏初始化时立即静音播放并预加载，但初始由 `clip-path` 完全隐藏。这样可以利用水滴动画阶段缓冲首个 GOP，避免页面内容开始出现时才请求视频。

视频约 21.1 MB、13.65 Mbps，功能上可直接使用，但对移动网络偏大。第一版先保持原画质；性能阶段再生成一个较低码率 H.264 版本，并保留当前文件作为高质量版本。`preview.gif` 和 `project.json` 不参与网页运行。

视频加载失败时保留当前深蓝背景，不阻塞顶部栏和内容入场。不能因为 `canplaythrough` 未触发而无限延迟页面；最多等待首帧一个很短的保护窗口，之后正常显示 UI。

### 水面与视频融合

不做完整镜面反射。人物已经存在于背景视频中，再生成一次镜像人物容易产生双影，而且需要额外渲染和采样成本。水层实现“视频透过水体后的折射与吸收”，更符合人物进入水中的视觉目标。

#### Canvas 透明化

当前 `WaterScene` 使用不透明 renderer 和 `scene.background`。接入时调整为：

- renderer 开启 `alpha: true`。
- Three 场景不再直接绘制不透明背景色。
- 使用单独的深蓝 DOM 背景遮罩保持开屏初始画面；视频浮现时该遮罩同步淡出。
- 水面几何继续绘制，水面以上的 Canvas 区域保持透明，让底层视频可见。
- 光源位置保持左上方不变。

#### 单视频源复用

只创建一个 `<video>` 元素。Three.js 通过这个元素创建 `VideoTexture`，而不是创建第二个隐藏视频，从而避免双重网络请求和双重视频解码。

`water.frag` 新增以下输入：

```text
uVideoTexture       同一个背景视频的 VideoTexture
uResolution         Canvas 实际像素尺寸
uVideoCoverScale    object-fit: cover 的缩放关系
uVideoCoverOffset   cover 裁切后的 UV 偏移
uRevealProgress     视频/水面融合进度
```

使用 `gl_FragCoord / uResolution` 得到屏幕 UV，再通过 cover 缩放与偏移映射到视频 UV，保证 DOM 视频和水面 Shader 采样到同一位置。窗口变化时只更新 cover 参数，不重新创建纹理。

#### 噪声范围和水下滤镜

复用高度纹理现有通道：R 为水面高度，G 为波峰，B 为风浪信号。由水面深度渐变、R/B 通道和低频噪声共同生成柔软的 `submergeMask`，不能使用一条固定水平直线切割人物。

遮罩内对视频应用：

1. 根据水面法线与噪声偏移 UV，产生折射扭曲。
2. 使用 3 次采样做轻微方向模糊，移动端可降为 1 次采样。
3. 随“水深”降低红色、轻微降低饱和度并增加青蓝吸收。
4. 根据波峰和左上方光源增加少量焦散亮纹。
5. 在遮罩边缘使用较宽的 `smoothstep` 过渡，避免人物出现硬切边。

水面颜色在页面浮现阶段从当前夜间深蓝逐渐过渡到与视频相符的浅蓝/青色。只改变 `uDeepColor`、`uSurfaceColor`、吸收强度和透明度，不改变现有光源方向、风向与波纹传播。

### UI 对光源的响应

不为 DOM 面板增加 WebGL 光照。复用 Three.js 左上方光源的屏幕位置，以 CSS 变量表达：

```text
--scene-light-x
--scene-light-y
--scene-light-energy
```

面板通过伪元素绘制低透明度径向高光，并让靠近光源的上边/左边略亮、远离光源的一侧阴影略深。光源当前固定，因此只在初始化和 resize 时计算一次，不需要每帧读取布局。

左右面板闪入时可以让高光扫过一次，完成后回到非常弱的静态响应。正文文字区域不使用强烈高光，保证可读性。

### 入场触发点与 GSAP 时间线

当前水冠在 `impactAge = 1.38s` 时隐藏。按“水花消失前 0.2 秒”计算，页面入场事件应在：

```text
REVEAL_IMPACT_AGE = 1.18s
页面启动后的约 2.88s = 0.65s 延迟 + 1.05s 下落 + 1.18s 水花阶段
```

在 `WaterScene` 内只触发一次 `water:reveal` 自定义事件。事件包含 `impactAge`、光源屏幕坐标和视频手部锚点，页面脚本收到事件后启动统一时间线。

以 `T = 0` 表示收到事件：

| 时间 | 元素 | 动画 |
|------|------|------|
| `T + 0.00s` | 背景视频 | `clip-path: inset(100% 0 0 0)` → `inset(0)`，从底部向上展开，持续约 1.15s |
| `T + 0.00s` | 水面 | 夜间遮罩淡出，水色与吸收参数过渡到视频配色，持续约 1.1s |
| `T + 0.28s` | 顶部栏 | 从 `yPercent: -110` 向下伸出，透明度同步恢复，持续约 0.68s |
| `T + 0.50s` | 个人块 | 从左侧 `x: -64`、轻微模糊和透明状态闪入，持续约 0.7s |
| `T + 0.50s` | 统计块 | 从右侧 `x: 64`、轻微模糊和透明状态闪入，持续约 0.7s |
| `T + 0.72s` | 路由块 | 视频已经露出且仍在上推时，以手部为锚点推向最终位置；`opacity: 0 → 1`，持续约 0.82s |
| `T + 1.35s` | 全部 UI | 移除 `inert`，允许键盘、鼠标和触摸交互 |

所有布局尺寸在动画开始前就确定，只动画 `transform`、`opacity` 和 `clip-path`，不动画 Grid 轨道、宽高或外边距，避免布局抖动。

### “手推出路由块”的定位

视频中手掌大约位于源画面的归一化坐标 `(0.46, 0.22)`。不能将这个点直接写成视口百分比，因为 `object-fit: cover` 在手机和超宽屏会裁切画面。

实现一个 cover 坐标映射函数：

1. 输入视频尺寸 `1920x1080`、视口尺寸和 `object-position`。
2. 计算 `scale = max(viewportWidth / 1920, viewportHeight / 1080)`。
3. 计算视频被裁切后的 x/y 偏移。
4. 将 `(0.46, 0.22)` 映射到真实视口坐标。
5. 再转换为路由块内部坐标，写入 `transform-origin` 和 CSS 变量 `--hand-x/--hand-y`。

路由块初始使用较小缩放、沿“手掌到路由块中心”的方向偏移，并从透明变为可见；不从极小尺寸放大，避免产生弹窗或营销页效果。移动端同样通过 cover 映射重新计算锚点。

水滴撞击点同样不再使用媒体查询或固定世界坐标。每次初始化与 resize 时，从相机的 NDC 中心 `(0, 0)` 发射射线并与水面平面求交；水滴、水花网格、深度壳、喷溅粒子和高度纹理波纹中心全部同步到该交点，因此交点投影在任何宽高比下都保持为视口中心。

### 路由与页面生命周期

- 文章使用 Astro 内容集合管理，统一校验标题、日期、描述、分类、标签与草稿状态。
- 首页查询最新文章并播放完整水滴与入场动画；归档、笔记、关于和文章详情页复用静态内容布局，不重复首页开屏。
- `src/pages/posts/[id].astro` 根据内容集合生成静态文章路由，主页、归档和笔记页共用 `PostCard.astro`。
- 站内路由切换不重复播放开屏；使用 `sessionStorage` 记录本次会话已完成。
- 后续可使用 Astro 内建页面过渡持久化背景视频和水面，避免切换路由时视频从头加载。
- 路由块内部的内容切换只做短距离淡入，不重复顶部栏和侧栏动画。

### 性能与降级

- 继续限制 Three.js 像素比不超过 1.5；低性能移动端将高度纹理从 768 降到 512。
- 页面不可见时暂停视频和 Three.js 循环，恢复可见后继续。
- `navigator.connection.saveData` 开启时可不自动播放视频，使用静态首帧。
- `prefers-reduced-motion: reduce` 下跳过位移、闪入和 clip 动画，仅做 160ms 左右淡入，并可暂停背景视频。
- WebGL 初始化失败时保留视频、深蓝滤镜和完整 DOM 内容，水面作为渐变背景降级。
- 同一个视频元素只解码一次；水面 Shader 不增加完整反射 pass。

### 可访问性

- 背景视频使用 `muted`、无 controls、`aria-hidden="true"`。
- 顶部栏使用 `<header>` 和 `<nav>`，路由内容使用 `<main>`，侧栏使用语义明确的 `<aside>`。
- UI 在动画结束前使用 `inert`，但在脚本失败或 reduced-motion 模式下立即解除。
- 面板文字对视频背景保持足够对比度，不依赖玻璃模糊才能阅读。
- 单列 DOM 顺序固定为个人、统计、路由，读屏顺序不受桌面 Grid 定位影响。

### 实施顺序

1. 创建语义化 Astro 页面框架和三列/两列/单列响应式 Grid，不接动画。
2. 接入 H.264 背景视频，完成 cover 裁切、加载失败与 reduced-motion 降级。
3. 将 SplashScreen 改为持续水面层，拆出深蓝遮罩并支持透明 Canvas。
4. 在 `impactAge = 1.18s` 发出一次 `water:reveal`，建立 GSAP 主时间线。
5. 完成顶部栏、左右块和手部锚点路由块动画。
6. 将同一个 video 元素接入 `VideoTexture`，实现水下遮罩、扭曲、吸收和浅色水面。
7. 添加 UI 的静态光源响应、路由持久化和会话级开屏策略。
8. 使用 Playwright 验证桌面、超宽屏、平板和手机关键帧，以及 Canvas 非空、视频播放、层级和文本无重叠。

### 验收标准

- 桌面正文列随视口伸缩且保持主导宽度，个人栏与统计栏维持稳定可读宽度。
- 手机顺序严格为个人 → 统计 → 路由，横向无溢出。
- 页面入场在水冠消失前约 0.2 秒启动，五部分动画互相衔接但不同时拥挤出现。
- 视频首尾循环无明显闪黑；加载失败不阻塞内容。
- 视频人物在水面范围内发生连续、柔和的噪声折射和颜色吸收，没有硬水平切线。
- 水面位于视频之上、UI 之下，UI 始终可交互且文字清晰。
- reduced-motion、save-data 和 WebGL 失败场景都有可用降级。

---

## 待办事项

- [x] 配置 `astro.config.mjs` 添加 React 集成
- [x] 安装 Tailwind CSS
- [x] 安装 Three.js 和类型依赖
- [x] 创建 Three.js 双通道开场动画（水滴 + 水花 + 波纹）
- [x] 编写柏林噪声高度 Shader 和夜间水面 Shader
- [x] 添加视频背景浮现效果
- [x] 创建顶部栏与三列/两列/单列主页布局
- [x] 创建个人块、统计块与中间路由块
- [x] 添加 GSAP 统一入场时间线和视频手部锚点映射
- [x] 将背景视频作为 VideoTexture 接入水面滤镜
- [x] 接入 Astro 内容集合、文章卡、归档/笔记/关于与动态文章路由
- [x] 使用 Tailwind CSS 重写页面组件并精简全局 CSS
- [ ] 添加会话级开屏、reduced-motion 和 save-data 降级
- [ ] 创建 Live2D 模型展示组件（页面边缘装饰）
- [ ] 导出 Live2D 模型并放入 `public/models/`
- [ ] 下载 `live2dcubismcore.min.js` 放入 `public/`
