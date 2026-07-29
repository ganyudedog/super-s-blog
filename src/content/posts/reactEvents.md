---
title: React 事件系统（基于 React 18 / 现代事件系统源码视角）
published: 2025-10-18
description: 对react事件系统的深入解析以及自己的理解
category: Notes
tags: [frondend, typescript, react]
draft: false
---

> 现代事件系统（Modern Event System）自 React 17 起重构：弃用“document 顶层统一监听 + 阻断捕获阶段再二次分发”的旧插件体系（EventPluginRegistry + extractEvents），转为 **“按根容器分组的事件委托 + 优先级调度 + 简化的合成事件层”**。React 18 在此之上加入事件优先级与并发调度的更紧耦合。

## 1. 设计目标

- 统一不同浏览器的事件差异（冒泡、属性名、事件对象字段）。
- 在并发模式下，把 **离散（Discrete）事件**（点击、键盘等）以同步优先级先快速刷新，连续（Continuous）事件（mousemove、scroll）允许被打断/批处理。
- 兼容旧 onChange 合成逻辑（跨 input/textarea/checkbox/自定义输入法组合）。
- 提供跨根的独立事件委托（多个 createRoot 不互相干扰）。
- 降低内部插件系统复杂度，避免老版本的“事件插件注入”模型。
- 在上层暴露了统一的，稳定的，与dom原生事件相同的事件接口。

## 2. 总览：从原生事件到组件回调的链路

```
原生事件触发 (DOM) → 绑定在根容器的 listener 捕获/冒泡阶段 → dispatchEvent (react-dom/src/events/DOMModern) 
	→ 根据事件类型分类（离散/连续/其他）与优先级 getEventPriority
		→ accumulateSinglePhaseListeners（搜集 Fiber 链上对应 prop 回调）
			→ processDispatchQueue (按捕获→目标→冒泡序列执行) + SyntheticEvent 包装
				→ 回调执行期间：批处理更新（自动 batching） + 可能同步 flush（离散事件）
```
### 事件注册
1. 我在 JSX 上写的 `<div onClick={fn} />`，在 render 阶段变成一个 HostComponent Fiber，props 里有 **onClick: fn**。
2. commit 阶段，React 为这个 Fiber 创建 DOM 节点，并把这份 props 存到 DOM 关联的内部存储（类似 dom.__reactProps），但并没有在这个 div 上直接 `addEventListener`。
3. 根容器上，React 为 `click` 这种 domEventName 只注册一次原生 listener，用来桥接——一旦事件冒泡到根，就调用 `dispatchEventForPluginEventSystem`。

注意: react中**不存在**完全不依赖原生事件的事件，即便是*合成事件*

### 事件触发
	React 事件系统中的所有 DOM 事件（包括各种合成事件）都或多或少依赖某些浏览器原生事件作为入口；
原生事件是通过根容器上的 `addEventListene`· 进入 React 的，一旦进入之后，React 会在内部根据逻辑“手动”派发对应的合成事件（构造 SyntheticEvent、收集 listeners 并逐个调用），而不会再通过额外的 `addEventListener` 或 `element.dispatchEvent` 去依赖浏览器帮它二次触发。

React DOM 事件的触发入口本质上还是依赖于根容器上的 `addEventListener` 所注册的原生事件；
原生事件一旦进入 React 事件系统之后，事件的类型判断、语义抽象（各种合成事件）以及捕获/冒泡阶段的监听器收集与执行，都由 React 在内部完成，而不是再通过新的 `addEventListener` 或 DOM 事件去驱动。

**react事件触发的本质是对dispatchEvent的调用**

核心源码入口（React 18）：
- `packages/react-dom/src/events/DOMPluginEventSystem.js`
- `dispatchEvent` / `dispatchDiscreteEvent` / `dispatchContinuousEvent`
- `getEventListenerSet` / `listenToNativeEvent` / `addTrappedEventListener`
- `accumulateSinglePhaseListeners`
- `processDispatchQueue`
- 合成事件类：`SyntheticEvent` 与具体专用（ChangeEvent, KeyboardEvent 等）
- 优先级映射：`getEventPriority`（→ Scheduler / lanes）

## 3. 根级事件委托机制

每个 `root`（`createRoot(container)`）会在 **容器节点本身**（而非全局 document）注册一组“已追踪的原生事件”监听器(只有在fiber节点中注册了该事件，才会有监听器的出现)：

```ts
function listenToNativeEvent(eventType, target, passive, priority) {
	const listenerSet = getEventListenerSet(target) // Map<eventType, ActiveFlag>
	if (!listenerSet.has(eventType)) {
		addTrappedEventListener(target, eventType, priority, /* capture */ false)
		addTrappedEventListener(target, eventType, priority, /* capture */ true)
		listenerSet.add(eventType)
	}
}
```

区别旧版：旧系统把所有类型统一挂在 `document`（或 window）上；现代系统允许多根并存，各自只处理自身 subtree 的事件。

进一步澄清几点常见误解：

- **事件类型不是靠 `e.target` 猜出来的**：
	- 监听器在绑定时就已经按 `domEventName`（如 `'click'`、`'keydown'`）区分类型了；`e.target` 只用来定位“从哪个 DOM 节点对应的 Fiber 开始向上收集监听”。
	- React 会通过 `getClosestInstanceFromNode(nativeEvent.target)` 找到最近的 Fiber，再沿 Fiber 的 `return` 链向上收集该事件类型对应的 `onClick` / `onClickCapture` 等 prop。
- **`target` 与 `currentTarget` 的区别**：
	- `SyntheticEvent.target` 始终指向原始触发事件的 DOM 节点（通常等于 `nativeEvent.target`）。
	- `SyntheticEvent.currentTarget` 在分发时会被 React 反复设置为“当前正在执行 listener 对应的 DOM/Fiber”，执行一个 listener 改一次，用完再重置。
	- 因此，打印出来的 `currentTarget` 序列其实反映的是 React 事件队列的遍历顺序，而不是浏览器原生冒泡路径本身。

一个简化示例，帮助理解捕获/冒泡与 target/currentTarget 的关系：

```tsx
function App() {
  const log = (label: string) => (e: React.MouseEvent) => {
	console.log(
	  label,
	  "phase=",
	  (e as any)._reactName?.endsWith("Capture") ? "capture" : "bubble",
	  "target=",
	  (e.target as HTMLElement).id,
	  "currentTarget=",
	  (e.currentTarget as HTMLElement).id,
	);
  };

  return (
	<div id="outer" onClickCapture={log("outer")} onClick={log("outer")}>
	  <div id="inner" onClickCapture={log("inner")} onClick={log("inner")}>
		<button id="btn" onClick={log("button")}>
		  Click me
		</button>
	  </div>
	</div>
  );
}
```

当点击按钮 `#btn` 时：

- 所有日志里的 `target` 都是 `btn`（原始触发点不变）。
- `currentTarget` 会依次是 `outer` / `inner` / `btn`（按捕获→目标→冒泡的队列顺序变化），说明 React 在执行每个 listener 前都会设置一次 `currentTarget`。

### 底层原理
	根容器上的原生监听器的作用，只是当原生事件冒泡到 React 根容器时，把 nativeEvent 交给 React 的事件系统入口dispatchEventForPluginEventSystem。
真正去“感知哪些 Fiber 上注册了这个事件、把它们收集成队列并依次执行”的，是 **dispatchEventForPluginEventSystem 内部调用的 dispatchEvent / accumulateSinglePhaseListeners / processDispatchQueue** 这一整条链路。

也就是说，**根监听器=桥，dispatchEventForPluginEventSystem=入口，dispatchEvent=真正调度中心**

## 4. 原生事件进入 React：dispatchEvent 工作流

当某个事件触发时，底层监听器（`dispatchEventForPluginEventSystem`）会：

1. 解析原生事件 → 得到 target DOM。
2. 通过 `getClosestInstanceFromNode(dom)` 找到最近的 Fiber（HostComponent / HostText）。
3. 依据事件类型算出 **事件优先级**：`getEventPriority(domEventName)`：
	 - 离散 (DiscreteEventPriority)：click, keydown, submit, change 等。
	 - 用户阻塞/连续 (ContinuousEventPriority)：mousemove, drag, scroll 等。
	 - 默认 (DefaultEventPriority)：大多数不会立即视觉反馈的事件。
4. 根据优先级决定执行策略：
	 - 离散：包装在 `flushSync` 或使用高优先级 lanes；保证更新立即生效，减少输入延迟。
	 - 连续：允许在同一帧/时间片中批量执行多次回调触发的更新。
5. 调用 `accumulateSinglePhaseListeners`：沿 Fiber return 链向上查找该事件对应的 prop，如 `onClickCapture`（捕获阶段）或 `onClick`（冒泡阶段），按阶段分组。
6. 构造 dispatch 队列：`[{event, listeners[]}]`。
	- 这里的 `listeners[]` 不是“原生 DOM 监听器集合”，而是 **当前阶段需要依次执行的 React listener 队列**。
	- 每一项大致形如 `{ listener, currentTarget }`：
		- `listener`：对应某个 Fiber/DOM 节点上声明的 `onClick` / `onClickCapture` 等回调函数。
		- `currentTarget`：对应这个 listener 所在的 DOM/Fiber 节点，用来在执行前设置到 `syntheticEvent.currentTarget` 上。
	- 换句话说，`listeners[]` 就是“在当前捕获/冒泡阶段中，应该被触发的那些节点及其事件处理函数”的有序列表。
7. `processDispatchQueue`：按优先顺序执行 listener；如果调用 `event.stopPropagation()`，终止当前阶段后续 listener。

伪代码概览：
```ts
function dispatchEvent(domEventName, nativeEvent, targetContainer) {
	const targetFiber = getClosestInstanceFromNode(nativeEvent.target)
	const priority = getEventPriority(domEventName)
	const dispatchQueue = []
	accumulateSinglePhaseListeners(dispatchQueue, targetFiber, domEventName, nativeEvent)
	processDispatchQueue(dispatchQueue, priority)
}
```

结合源码，可以把 `processDispatchQueue` 和 `listeners[]` 的形状再展开一点（示意）：

```ts
function processDispatchQueue(queue, priority) {
	for (const item of queue) {
		const { event, listeners } = item
		for (let i = 0; i < listeners.length; i++) {
			const { listener, currentTarget } = listeners[i]
			// 在调用前，React 会把 currentTarget 设置为“当前要执行 listener 的那个节点”
			event.currentTarget = currentTarget
			listener(event)
			if (event.isPropagationStopped()) break
		}
	}
}
```

对应到我们上面的描述：

- `dispatchQueue`：按阶段（捕获/冒泡）分组的一系列 `{ event, listeners[] }`。
- `listeners[]`：这一阶段中“要触发的 Fiber/DOM 节点及其事件处理函数”的队列。
- `currentTarget`：在执行每个 listener 前被设置，体现了“现在轮到哪个节点处理这个事件”，也是你在日志里看到的 currentTarget 变化序列的来源。

## 5. SyntheticEvent（合成事件）层

现代版本仍使用 `SyntheticEvent` 封装：

```ts
function SyntheticEvent(nativeEvent, type) {
	this.nativeEvent = nativeEvent
	this.type = type
	this.target = nativeEvent.target
	this.currentTarget = null
	this.isDefaultPrevented = () => nativeEvent.defaultPrevented
	this.isPropagationStopped = () => false
}
```

关键点（17+ 的变化）：
- **不再事件池化**（旧版本会在回调结束后把对象字段清空，需异步持久化 `event.persist()`；现在每次创建一个普通对象，便于调试且降低并发坑）。
	- 这里的**事件池化**指的是 React 旧版为了性能，把 SyntheticEvent 对象放在一个复用池里，用完就清空字段并回收，下次事件再复用同一个对象；17+ 取消了这个机制，每次事件都新建一个普通对象，避免异步访问被清空的坑。
- 仍提供 `preventDefault/stopPropagation`，内部标记布尔值并调用原生对应方法（如果可用）。
- React 在分发时设置 `event.currentTarget = 正在执行 listener 对应的 DOM/Fiber`，执行后再重置。

## 6. 事件优先级与调度（与 Lanes 的衔接）

React 18 把事件分级 → 映射到渲染 lanes 及 Scheduler 优先级：

| 事件类别 | 典型事件 | EventPriority | 处理策略 |
|----------|----------|---------------|----------|
| 离散 Discrete | click, keydown, submit, change | DiscreteEventPriority | 触发 `flushSync`，同步渲染（高优） |
| 连续 Continuous | mousemove, drag, scroll | ContinuousEventPriority | 可被打断的并发渲染 |
| 默认 Default | animationend, transitionend | DefaultEventPriority | 普通优先级，批处理 |
| Idle | 某些空闲类（少见内置） | IdleEventPriority | 低优先级，延后执行 |

内部映射大致：
```ts
function getEventPriority(name) {
	switch (name) {
		case 'click': return DiscreteEventPriority
		case 'keydown': return DiscreteEventPriority
		case 'mousemove': return ContinuousEventPriority
		default: return DefaultEventPriority
	}
}
```

之后在调度更新时通过 `requestUpdateLane` / `ensureRootIsScheduled` 选择对应 lanes 集合，保障高优事件插队。

## 7. 监听阶段与回调执行顺序

- React 为捕获与冒泡分别收集 listener 队列：
	- 捕获：`onClickCapture` 自底向上收集，再自顶向下执行（符合 W3C 捕获顺序）。
	- 冒泡：`onClick` 自底向上收集、保持“自内到外”执行顺序。
- 若在执行过程中调用 `stopPropagation()`：
	- 仅阻止当前阶段剩余 listener；另一个阶段（若尚未执行）受影响取决于调用点（阻止后不会继续冒泡阶段后续 listener）。

## 8. 与原生 DOM 事件的差异汇总

| 维度 | React 现代事件 | 原生 DOM |
|------|----------------|----------|
| 委托位置 | 绑定在每个根容器 | 一般直接绑在元素或 document | 
| 多根隔离 | 支持，多根事件互不穿透 | 不存在“多根”概念 | 
| 事件对象 | SyntheticEvent 包装，标准化属性，无需 persist | 原生 `Event`（浏览器差异） |
| 事件池化 | 已取消（17+） | 不适用 |
| 批处理 | 回调内 setState 自动批处理（18 支持跨事件源） | 无（除非自己合并） |
| 优先级 | getEventPriority → lanes → Scheduler | 无内建优先级概念 |
| onChange 语义 | 统一抽象（可能监听 input, keydown, composition events） | 各控件/浏览器触发时机不同 | 
| 停止传播 | `stopPropagation` 阻止 React 内部队列继续（不影响浏览器已经过的阶段） | 标准 DOM 行为 |
| 异步并发 | Continuous 事件可被打断 / 重新进入 | 原生不管你的渲染调度 |
| Passive/非 passive | React 内部按类型决定是否添加 passive 监听 | 开发者自己指定 | 
| Disabled 元素行为 | 某些事件（如 `onClick`）在 disabled button 上不会触发（一致性处理） | 浏览器原生差异存在 |

### 8.1 Portal 冒泡与原生 DOM 路径对比

Portal 是一个能体现“**React 合成冒泡链 ≠ 原生 DOM 冒泡路径**”的典型场景：Portal 子节点真实挂载在根容器之外的 DOM 树中，但 React 仍然让事件冒泡到其 React 祖先组件。

示例 HTML 结构（简化）：

```html
<body>
	<div id="root"></div>
	<div id="outside-wrapper"></div>
</body>
```

React 代码：

```tsx
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";

function PortalButton() {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
	const wrapper = document.getElementById("outside-wrapper")!;
	const host = document.createElement("div");
	host.id = "portal-host";
	wrapper.appendChild(host);
	hostRef.current = host;
	return () => host.remove();
  }, []);

  if (!hostRef.current) return null;

  return createPortal(
	<button
	  onClick={(e) => {
		console.log("[React] portal button clicked");
		console.log("native composedPath:", e.nativeEvent.composedPath());
	  }}
	>
	  Portal Btn
	</button>,
	hostRef.current,
  );
}

function App() {
  return (
	<div
	  id="react-root-inner"
	  onClick={() => {
		console.log("[React] parent synthetic onClick");
	  }}
	  style={{ border: "2px solid #09f", padding: 24, margin: 8 }}
	>
	  <h3>React Root Container</h3>
	  <PortalButton />
	</div>
  );
}

const rootEl = document.getElementById("root")!;
createRoot(rootEl).render(<App />);

// 原生监听（对比用）
rootEl.addEventListener("click", () => {
  console.log("[Native] rootEl listener (不会因 Portal 点击触发)");
});
document.getElementById("outside-wrapper")!.addEventListener("click", () => {
  console.log("[Native] outside-wrapper listener (会因 Portal 点击触发)");
});
```

点击 `Portal Btn` 时：

- React 合成事件层会依次打印：
	- `[React] portal button clicked`
	- `[React] parent synthetic onClick`（说明事件“冒泡”到了 React 祖先 `App`）
- 原生层面：
	- `nativeEvent.composedPath()` 中包含按钮 → `#portal-host` → `#outside-wrapper` → `body` → ...，**不包含** `#root`。
	- `rootEl` 上的原生 `click` 监听器不会被触发，只会触发 `outside-wrapper` 等沿原生 DOM 路径的监听。

这说明：

- 原生 DOM 冒泡链只沿真实 DOM 父链传播，Portal 子节点不会“原生冒泡”到 React 根容器。
- React 合成事件系统则沿 Fiber return 链把 Portal 视为正常子树的一部分，让事件可以像普通子组件一样冒泡到其 React 祖先组件。

如果在 Portal 按钮回调中调用 `e.stopPropagation()`：

- React 合成冒泡会停止，`parent synthetic onClick` 不再执行。
- 原生冒泡仍然存在，除非同时调用 `e.nativeEvent.stopPropagation()`；因此 `outside-wrapper` 的原生监听仍然可能触发。

## 9. onChange 的特殊统一

`onChange` 在不同输入元素：
- text/textarea：监听 `input` + `composition` 辅助确保输入法过程正确。
- checkbox/radio：监听 `click` / `change`。
- file：必须原生 `change`。
- contentEditable：监听 `beforeinput` / `input`（新浏览器）回退到旧策略。

React 会在收集阶段把这些多源事件统一转换为一个“变化”合成事件回调，保证开发者心智简单。

## 10. 更新批处理与 flushSync

- 所有事件（不论离散还是连续）在 React 18 默认进入批处理上下文（`batchedUpdates`）。
- 离散事件触发的更新若需同步视觉反馈，React 会在事件回调边界后同步 `flushSync`（或直接使用同步 lanes）。
- 开发者显式调用 `flushSync(() => setState())` 仍可在任意事件或异步逻辑中强制同步。

## 11. 常见坑与调试提示

| 场景 | 说明 | 建议 |
|------|------|------|
| 事件对象异步访问 | 17+ 不再池化，可安全异步使用 | 仍建议只取需要字段避免深拷贝 |
| stopPropagation 不影响原生 | 只阻止 React 内部队列 | 若要完全阻止浏览器默认冒泡需要同时调用原生方法 |
| 自定义原生 addEventListener 绕过 React | 直接监听元素可能与 React 事件顺序不同 | 尽量统一用 React 事件或清晰区分职责 |
| 性能监控 | 连续事件高频（mousemove）内重计算导致卡顿 | 使用节流/分片 + startTransition 包裹低优刷新 |
| 多根应用通信 | 不共享事件委托层 | 跨根通信使用全局 store 或消息总线 |

## 12. 极简示意综合伪代码

```ts
// 绑定阶段（初始化根时）
for (const domEventName of allSupportedEvents) {
	listenToNativeEvent(domEventName, rootContainer, /* passive */ shouldBePassive(domEventName), getEventPriority(domEventName))
}

// 运行时分发
function dispatchEvent(domEventName, nativeEvent) {
	const targetFiber = getClosestInstanceFromNode(nativeEvent.target)
	const priority = getEventPriority(domEventName)
	const dispatchQueue = []
	accumulateSinglePhaseListeners(dispatchQueue, targetFiber, domEventName, nativeEvent)
	processDispatchQueue(dispatchQueue, priority) // 内部设置 currentTarget -> invoke -> reset
}

function processDispatchQueue(queue, priority) {
	for (const item of queue) {
		const {event, listeners} = item
		for (let i=0;i<listeners.length;i++) {
			const {listener, currentTarget} = listeners[i]
			event.currentTarget = currentTarget
			listener(event)
			if (event.isPropagationStopped()) break
		}
	}
}
```

## 13. 与旧版（<=16）事件系统的核心区别速览

| 方面 | 旧系统（Legacy Plugin） | 现代系统（17+） |
|------|-----------------------|------------------|
| 插件机制 | `EventPluginRegistry` + `extractEvents` | 内联逻辑 + 分类（离散/连续） |
| 委托目标 | `document` 单一 | 每个 `root container` | 
| 事件池 | 有（需 `persist`） | 无 | 
| 优先级耦合 | 不显式 | `getEventPriority` → `lanes` | 
| 并发支持 | 有限（同步栈假设多） | 设计即支持并发 | 
| 自定义插件扩展 | 支持（复杂） | 不再公开一般插件接口 |

## 14. 总结

React 18 的事件系统 = “**根级委托 + 合成封装 + 事件优先级 + 自动批处理 + 与 Fiber/Lanes 调度融合**”。它在保持跨浏览器一致性与开发者易用性的同时，让输入类事件的响应延迟最小化，并给连续事件留出并发切片空间。
