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
- `WUWA 尤诺.mp4` - 动态壁纸视频
- `preview.gif` - 预览动图
- `project.json` - 元数据

### 技术架构

```
┌─────────────────────────────────────────┐
│         Splash Animation                │
├─────────────────────────────────────────┤
│  Phase 1: 水滴下落                       │
│           (GSAP 控制 Sprite 从顶部下落)   │
├─────────────────────────────────────────┤
│  Phase 2: 波纹扩散                       │
│           (DisplacementFilter + 噪声)    │
├─────────────────────────────────────────┤
│  Phase 3: 壁纸浮现                       │
│           (视频从模糊到清晰，配合波纹)     │
├─────────────────────────────────────────┤
│  Phase 4: 光效增强（可选）                │
│           (Shader 添加水面反射效果)       │
└─────────────────────────────────────────┘
```

### 技术选型

| 功能 | 技术 | 说明 |
|------|------|------|
| 水滴动画 | PixiJS Sprite + GSAP | 控制水滴下落轨迹和动画 |
| 波纹效果 | PixiJS DisplacementFilter | 位移贴图实现水面扭曲 |
| 柏林噪声 | GLSL Shader | 控制波纹的随机性和自然感 |
| 视频背景 | HTML5 `<video>` 或 PixiJS VideoTexture | 播放 MP4 素材 |
| 光效增强 | PixiJS Filter + GLSL | 添加水面反射、光斑等效果 |

### Shader 资源获取
- [ShaderGif](https://shadergif.com/) - GLSL 社区，有教程和示例（无需翻墙）
- [Neort](https://neort.io/popular) - 数字艺术家社区（无需翻墙）
- [Shaderoo](https://shaderoo.org/) - Shadertoy 镜像替代（无需翻墙）
- [Smoothstep](https://smoothstep.io/) - 动画 Shader 模板（无需翻墙）
- [shader-web-background](https://github.com/xemantic/shader-web-background) - GLSL 背景库

### 资源清单

| 资源 | 位置 | 说明 |
|------|------|------|
| 动态壁纸视频 | `public/background/WUWA 尤诺.mp4` | 主要背景素材 |
| 水滴素材 | 需制作或生成 | 透明背景 PNG 或 SVG |
| 柏林噪声 Shader | 手写或从社区获取 | 控制波纹效果 |

### 动画流程

1. 水滴从顶部下落 (GSAP 动画)
2. 水滴触碰水面，DisplacementFilter 开始扭曲
3. 柏林噪声控制波纹扩散和随机性
4. 视频从模糊逐渐清晰，配合波纹浮现
5. 可选：添加水面反射、光斑等 Shader 光效
6. 动画完成，过渡到主页面

---

## 待办事项

- [x] 配置 `astro.config.mjs` 添加 React 集成
- [x] 安装 gsap 依赖
- [ ] 创建开场动画组件（水滴 + 波纹 + 视频背景）
- [ ] 编写柏林噪声 GLSL Shader
- [ ] 制作或获取水滴素材（PNG/SVG）
- [ ] 创建 Live2D 模型展示组件（页面边缘装饰）
- [ ] 导出 Live2D 模型并放入 `public/models/`
- [ ] 下载 `live2dcubismcore.min.js` 放入 `public/`
