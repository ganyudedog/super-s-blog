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

## 开场动画设计方案

### 效果描述
下雪 → 雪花落到手臂上 → 角色出现 → 动态背景

### 技术架构

```
┌─────────────────────────────────────────┐
│         Splash Animation                │
├─────────────────────────────────────────┤
│  Layer 0: Shader 背景                    │
│           (GLSL 雪景/极光/粒子效果)       │
├─────────────────────────────────────────┤
│  Layer 1: PixiJS 粒子系统               │
│           (雪花飘落，可与 Shader 互动)     │
├─────────────────────────────────────────┤
│  Layer 2: 角色图片                       │
│           (GSAP 控制淡入/缩放)           │
└─────────────────────────────────────────┘
```

### 技术选型

| 功能 | 技术 | 说明 |
|------|------|------|
| 动态背景 | PixiJS Filter + GLSL | 从 Shadertoy 移植雪景着色器 |
| 雪花粒子 | PixiJS ParticleContainer | 高性能粒子系统 |
| 角色出现 | gsap | 时间线控制动画序列 |
| 交互触发 | @pixi/react | React 管理状态 |

### Shader 资源获取
- [Shadertoy](https://www.shadertoy.com/) - 搜索 `snow`、`winter`、`aurora`、`particle`
- [shader-web-background](https://github.com/xemantic/shader-web-background) - GLSL 背景库
- [okaybabe-shaders](https://github.com/Okay-Babe/okaybabe-shaders) - React Shader 组件

### 资源清单（Shader 方案大幅减少图片需求）

| 资源 | 数量 | 说明 |
|------|------|------|
| 角色静态图 | 1-2 张 | 透明背景 PNG，用于淡入出现 |
| 角色动作帧（可选） | 若干张 | 如果需要角色动起来 |
| Shader 代码 | 0 张图片 | 从 Shadertoy 移植或手写 |

### 动画流程

1. 背景渐入 (Shader 动态生成)
2. 雪花开始飘落 (PixiJS 粒子 + Shader 粒子)
3. 雪花累积在手臂区域 (粒子 + 碰撞检测)
4. 角色淡入 (GSAP 动画)
5. 角色响应鼠标/触摸 (可选交互)
6. 动画完成，过渡到主页面

---

## 待办事项

- [x] 配置 `astro.config.mjs` 添加 React 集成
- [ ] 安装 gsap 依赖
- [ ] 创建开场动画组件（Shader + PixiJS 粒子）
- [ ] 从 Shadertoy 移植雪花着色器
- [ ] 创建 Live2D 模型展示组件（页面边缘装饰）
- [ ] 导出 Live2D 模型并放入 `public/models/`
- [ ] 下载 `live2dcubismcore.min.js` 放入 `public/`
- [ ] 准备角色静态图片（1-2 张 PNG）
