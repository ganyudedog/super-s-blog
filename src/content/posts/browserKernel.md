---
title: 关于1px在浏览器页面上的绘制
published: 2025-12-30
description: 对于浏览器内核的部分学习
category: Notes
tags: [browser, frondend, kernel]
draft: false
---

> 本文从“一个像素如何诞生并显示到屏幕”讲起，结合现代浏览器多进程架构（Browser/Renderer/Compositor/GPU）梳理流水线：网络 → 解析与构树 → 布局 → 分层与绘制 → 合成与光栅化 → GPU 渲染 → 最终合成。同时解释重排（reflow）、重绘（repaint）与 transform 的执行位置与成本差异。

## 0. 多进程/多线程总览（简化）
- Browser Process：网络、导航、进程管理、UI。
- Renderer Process（渲染进程）：HTML/CSS/JS 执行、DOM/CSSOM、布局、绘制列表、部分合成逻辑。
- Compositor Thread（合成线程，通常在渲染进程中独立线程）：分层、合成、提交帧。
- Raster/Tile Worker（光栅线程池）：把绘制指令光栅化为位图（tiles）。
- GPU Process：接收合成与光栅命令，执行 GPU 渲染与最终合帧（display compositor）。

注意：**JS 引擎（主线程）与样式/布局/绘制共享“渲染主线程”时间片，互斥执行；长时间 JS 会阻塞渲染与输入响应。**

## 1. 网络阶段（Browser/Network → Renderer）
- URL 解析、DNS、TCP/TLS 建连，发起请求。
- 接收响应流，经分块（chunked）逐步把字节流送到渲染进程。
- HTML 解析器边下边解析（streaming），可早期触发 CSS/JS 资源请求（预扫描器 preloader）。

## 2. 解析与构树（Renderer 主线程）
- HTML → 词法/语法分析 → DOM 树。
- CSS → 解析为 CSSOM（包含选择器、层叠、继承、指定值/计算值/使用值等计算阶段）。
- JS 可读写 DOM/CSSOM，可能触发布局与样式计算强制同步（如读取 offsetHeight / getComputedStyle）。
- 当 DOM 与 CSSOM 可用于布局时，进入样式计算（Style Recalc），为每个元素确定最终“使用值”（computed style）。

## 3. 布局/排版（Layout/Reflow）
- 输入：DOM + 计算好的样式。
- 产物：布局树（或合并在 Render Tree 中），每个盒模型节点的几何信息（位置、尺寸、margin/line box 等）。
- 这一步决定“元素在哪里、占多大”。改变会触发 reflow（重排）。

## 4. 分层与层叠上下文（Stacking Contexts → Layer Tree）
- 根据 z-index、position、transform、opacity、will-change、CSS filters、3D、视频/Canvas 等创建新的层（Graphics Layers/Composited Layers）。
- 层与层之间有层叠顺序（stacking order），同层内部再按绘制顺序生成 Paint Record。
- 产物：Layer Tree（每一层可单独合成、滚动、动画）。

## 5. 绘制列表（Paint/Display List）
- 渲染引擎把每个层内的节点转换为绘制指令（绘制背景、边框、文本、位图、路径等），生成 Display List。
- 某些浏览器会做绘制指令优化（合并、顺序调整以减少重叠绘制）。

## 6. 合成与切片（Compositing & Tiling）
- Compositor Thread 接管具有合成资格的层（composited layers），将其切分为 tiles（瓦片），便于增量更新与并行光栅。
- 维护合成帧（Compositor Frame）：记录每个层的变换矩阵、透明度、裁剪等。
- 滚动/transform/opacity 等只涉及合成属性的变化可由合成线程直接更新帧，无需回到主线程重排/重绘。

## 7. 光栅化（Rasterization）
- Raster 线程池把每个 tile 的绘制列表转换为位图（raster buffer），通常用 GPU 加速（Skia + GPU 或软件回退）。
- 可采用多级分辨率/优先策略（先光栅可见区，懒加载不可见区）。

## 8. GPU 渲染与最终合成（GPU Process）
- Compositor 将各层（或 tiles）的纹理提交给 GPU；
- GPU 执行顶点/片元着色，把每个层按变换矩阵、透明度、混合模式叠加，生成最终帧（framebuffer）；
- Display Compositor 把帧提交到平台显示系统（如 Windows DWM、macOS Core Animation），显示在屏幕。

总结路径（从字节到像素）：
Network → DOM/CSSOM → Style → Layout → Layer/Display List → Compositor（tiling）→ Raster → GPU → Compose to screen。

---

## 重排（Reflow）与重绘（Repaint）与合成（Composite Only）

- 重排（Reflow/Layout）：
	- 触发：影响几何的更改（添加/删除 DOM、改变元素尺寸/位置、字体、内容、窗口尺寸、读取会强制布局的属性）。
	- 成本：高。会从该节点到子树/祖先链重算布局，可能级联影响。

- 重绘（Repaint/Paint）：
	- 触发：视觉样式变化但不影响几何（颜色、阴影、背景图等）。
	- 成本：中。跳过布局，但需要生成/提交绘制列表，可能导致光栅化更新。

- 仅合成（Composite Only）：
	- 触发：修改合成属性（transform、opacity、filter 部分、will-change 标注的属性、独立图层的滚动/位移等）。
	- 成本：低。无需回主线程做布局/绘制，直接由合成线程更新层的变换矩阵/透明度并让 GPU 重新合并。

经验法则：Layout > Paint > Composite（成本从高到低）。

---

## transform 的底层原理与执行位置

- 执行位置：优先在合成线程 + GPU 完成。
	- 只更改 transform/opacity（且该元素是合成层）时，主线程不介入：合成线程更新层的变换矩阵（如 2D/3D 矩阵），GPU 在最终合成阶段进行坐标变换和混合。
	- 这使动画流畅，不受 JS/布局阻塞影响（前提：动画驱动在合成线程，如 CSS 动画/WAAPI，且无 layout 依赖）。

- 如何成为合成层：
	- 隐式：某些属性天然触发（position: fixed/ sticky 在特定条件、video/canvas/3D transform 等）。
	- 显式：`will-change: transform`/`transform: translateZ(0)` 等提示引擎把元素提为独立合成层（注意滥用会增加内存与合成开销）。

- 原理简述：
	- 每个合成层有自己的纹理（raster buffer）。transform 仅改变合成矩阵，不改纹理内容；
	- 合成时 GPU 对该纹理做矩阵变换（顶点着色阶段）并混合输出（片元阶段），避免重新绘制内容。

与 JS 动画/样式动画的差异：
- CSS 动画/transition 对 transform/opacity 可下放到合成线程；
- JS 驱动（requestAnimationFrame）修改非合成属性会回到主线程并可能引发布局/重绘，导致掉帧风险。

---

## 常见触发与优化清单

- 避免同步布局抖动（layout thrashing）：
	- 把读写分离：先批量读（宽高/滚动位置），后批量写（样式）。
	- 使用 `getBoundingClientRect`/`offsetWidth` 后立即写样式，会强制刷新布局。

- 降低重排：
	- 合理拆分 DOM、使用 `contain`（如 `contain: layout paint;`）限制影响范围；
	- 使用 CSS Grid/Flex 的“自适应”而非 JS 逐项计算位置；
	- 大规模 DOM 变更可先在离线文档片段操作，然后一次插入。

- 降低重绘：
	- 合理使用 `will-change` 只在动画前临时启用；
	- 精简阴影/模糊半径、减少大面积渐变与透明叠加区域。

- 利用仅合成路径：
	- 动画尽量用 transform/opacity；
	- 关键元素提层（注意内存与合层数量控制）。

---

## 一图串联（逻辑顺序）

```
Browser/Network → Renderer(Main)
	HTML/CSS → DOM + CSSOM → Style
	↓
Layout(Reflow) → Render/Layout Tree
	↓
Stacking Contexts → Layer Tree
	↓
Paint → Display List
	↓
Compositor(Thread) → Tiling → Raster(Workers)
	↓
GPU(Process) → Merge Layers → Present
```

结论速记：
- 改几何 = 走 Layout → Paint → Composite；
- 改视觉（不改几何）= 走 Paint → Composite；
- 改合成属性（transform/opacity）= 直接 Composite（最省）。