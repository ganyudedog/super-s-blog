---
title: 浏览器的 Worklet 与 Worker：从线程模型到渲染管线
published: 2026-10-11
description: 比较了浏览器的worker以及worklet，重点写了一下worklet的分类以及作用
category: Notes
tags: [frontend, browser, worklet]
draft: true
---

## 引子

## 一、Worklet 是什么

Worklet 是浏览器提供的一类**轻量级扩展接口**，允许开发者将自定义逻辑插入到浏览器的**渲染管线或音频管线**的特定阶段。

它和 Worker 经常被放在一起讨论，因为两者都涉及"独立上下文"，但它们的定位、线程模型、生命周期完全不同。

## 二、Worker 与 Worklet 的本质区别

### 2.1 核心差异

| 维度 | Worker | Worklet |
| :--- | :--- | :--- |
| **线程** | 一定独立 | 运行在渲染管线指定线程，不一定独立 |
| **生命周期** | 你控制（`new` / `terminate`） | 浏览器控制（注册后被动调用） |
| **状态** | 可持久保存 | 不允许保存状态（规范要求） |
| **通信** | `postMessage` | 通过 CSS 属性 / 参数传递 |
| **定位** | 外置耗时 JS 任务 | 进入浏览器底层管线 |

### 2.2 一句话概括

> **Worker 是你自己开的"外挂线程"，用来跑耗时 JS；Worklet 是浏览器留给你的"管线插件接口"，让你在渲染/音频管线的特定阶段插入自定义逻辑。前者你控制，后者浏览器控制。**

### 2.3 关键修正：Worklet 不一定是"新开线程"

这是最容易误解的一点。

- **Worker**：一定是独立线程。每个 Worker 有自己的事件循环、内存空间。
- **Worklet**：运行在渲染管线内部的专用线程上，但是否独立取决于 Worklet 类型和浏览器实现。

| Worklet | 运行位置 | 是否独立线程 |
| :--- | :--- | :--- |
| **PaintWorklet** | 主线程（或合成线程，取决于浏览器） | 不一定 |
| **LayoutWorklet** | 主线程 | 否 |
| **AnimationWorklet** | 合成器线程 | 是，独立于主线程 |
| **AudioWorklet** | 音频渲染线程 | 是，独立线程 |

更准确的说法：**Worklet 运行在"渲染管线指定的线程"上，这个线程可能是主线程，也可能是合成线程，但一定不是你自己 `new` 出来的 Worker 线程。**

### 2.4 Worklet 的隔离是"执行上下文隔离"，不是"并发"

- Worker 的隔离是**内存隔离**——两个 Worker 不能直接共享变量，必须通过 `postMessage` 通信。
- Worklet 的隔离是**执行上下文隔离**——它不共享主线程的 `window`、`document`，但它是**被浏览器引擎主动调用的**，你无法控制调用频率。

## 三、Worklet 分类

根据介入的管线阶段不同，Worklet 主要分为以下几类：

| Worklet 类型 | 介入的管线阶段 | 运行线程 | 用途 |
| **PaintWorklet** | Paint（绘制） | 主线程 / 合成线程 | 自定义元素背景/边框的绘制逻辑 |
| **LayoutWorklet** | Layout（布局） | 主线程 | 自定义元素的布局和尺寸计算 |
| **AnimationWorklet** | Composite（合成） | 合成器线程 | 创建与滚动关联的高性能动画 |
| **AudioWorklet** | 不直接介入渲染管线 | 音频渲染线程 | 自定义音频处理 |

## 四、PaintWorklet

### 4.1 核心作用

**PaintWorklet 的价值不在"动态效果"，而在于"动态的绘制逻辑"。**

静态 CSS 的 `background-image` 只能引用一个**已存在的、固定尺寸的图片文件**。PaintWorklet 让你**用代码画图**，浏览器在需要绘制元素背景时调用你的 `paint()` 函数，把当前元素的实际尺寸传给你。

### 4.2 基本用法

```javascript
// checkerboard.js
class CheckerboardPainter {
  paint(ctx, geometry, properties) {
    // ctx: 类似 CanvasRenderingContext2D
    // geometry: { width, height } 当前元素的绘制尺寸
    // properties: 可读取的 CSS 属性值
    const size = 32;
    ctx.fillStyle = 'red';
    ctx.fillRect(0, 0, geometry.width, geometry.height);
  }
}
registerPaint('checkerboard', CheckerboardPainter);
```

```css
.textarea {
  background-image: paint(checkerboard);
}
```

### 4.3 它解决什么问题

想要一个"棋盘格背景"，且格子大小要随元素宽度自适应：

- **传统 CSS**：预先做好一张大图，或用 `repeating-linear-gradient` 拼出来（复杂且不灵活）。
- **PaintWorklet**：用代码画图，天然适配元素尺寸——元素变大，格子跟着变大。

### 4.4 能用于动态效果吗

可以，但**动画的驱动逻辑不在 PaintWorklet 里**。

用 JS 监听滚动，更新 CSS 自定义属性（如 `--scroll-pos`），PaintWorklet 订阅该属性。属性一变，浏览器自动调用 `paint()` 重绘。

PaintWorklet 只负责"你让我画什么，我就画什么"，它本身不知道什么是"动画"。

## 五、LayoutWorklet

### 5.1 核心价值

**让 JS 直接参与布局算法的执行，而不是"在布局后改位置"。**

它的 `layout()` 函数接收**约束空间（ConstraintSpace）**——可用的宽高、边距、子元素列表——然后你**手动计算出每个子元素应该放在哪里**，最后返回一个 fragment 描述。

### 5.2 解决什么问题

现有布局模式无法表达的布局，比如：

- 只有特定标签的浮动元素才需要避让的复杂多栏布局。
- 瀑布流算法需要根据内容高度动态计算列位置。

用普通 JS 读取布局后再修改，会触发强制同步布局（Layout Thrashing），性能很差。LayoutWorklet 让你在布局引擎内部直接计算，避免了来回读写。

## 六、AnimationWorklet

### 6.1 核心价值

**把动画逻辑从主线程移到合成器线程，让它不受主线程卡顿的影响。**

用 `requestAnimationFrame` 做滚动动画时，主线程稍微卡一下，动画就掉帧。AnimationWorklet 运行在独立的线程上，主线程再忙，动画依然能保持流畅。

### 6.2 独特能力

支持 ScrollTimeline，让动画直接绑定到滚动位置，而不是时间。这正是 `requestAnimationFrame` 做不到的"丝滑"体验。

## 七、AudioWorklet：Worklet 里的异类

### 7.1 为什么说它更像 Worker

- 不介入渲染管线，独立处理音频。
- 独立线程，有状态。
- 定位上更接近"外置任务"的模型。

### 7.2 典型用途

用于麦克风采样、PCM 处理、音频渲染进程的转发等场景。

### 7.3 在 Vite 中的处理

目前 Vite **没有**像 `?worker` 那样内置专门针对 AudioWorklet 的官方查询后缀。推荐方案：

```javascript
import workletUrl from './processor.ts?worker&url'

await audioContext.audioWorklet.addModule(workletUrl)
```

**为什么不直接用 `?url`**：`?url` 只是简单地复制文件，**不会对 TypeScript 进行编译**。生产构建时浏览器拿到的是原始的 `.ts` 文件，无法执行。

## 八、总结

### 8.1 核心认知

| 问题 | 答案 |
| :--- | :--- |
| Worklet 是线程吗 | 不一定，运行在渲染管线指定线程 |
| 谁控制生命周期 | 浏览器，不是你 |
| 能保存状态吗 | 不能（规范要求，AudioWorklet 例外） |
| 和 Worker 的本质区别 | Worker 外置任务，Worklet 插入管线 |

### 8.2 一句话总结

> **Worklet 不是"用 JS 替代 CSS"，而是"让 JS 进入浏览器原本只允许 CSS/引擎进入的禁区"。PaintWorklet 进入"绘制生成"禁区，LayoutWorklet 进入"布局算法"禁区，AnimationWorklet 进入"合成器线程"禁区。这些禁区用普通 JS 也能"曲线救国"，但要么性能差，要么做不到。**

### 8.3 参考表格

| Worklet | 你理解的"它做什么" | 它实际的核心价值 |
| :--- | :--- | :--- |
| **PaintWorklet** | 画动态背景 | 用代码生成适配元素尺寸的图形 |
| **LayoutWorklet** | 改布局 | 让 JS 参与布局计算，避免 Layout Thrashing |
| **AnimationWorklet** | 做动画 | 在独立线程运行动画，不受主线程卡顿影响 |
| **AudioWorklet** | 处理音频 | 独立线程，有状态，更接近 Worker 模型 |
