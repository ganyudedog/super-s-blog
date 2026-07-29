---
title: react fiber架构
published: 2025-10-08
description: 对react底层结构的深入了解
category: Notes
tags: [browser, frondend, kernel]
draft: false
---

## 为什么需要 Fiber（动机）

传统（React 15 及之前）的调和(栈调和)是“同步、不可中断”的：一次大型渲染会长时间占用主线程，导致输入卡顿。Fiber 在 React 16 引入，核心目标是把“渲染阶段”切成可中断、可恢复的小单元，并引入可控的调度与优先级，从而实现时间分片与更细粒度的更新控制。

要点回顾：
- 渲染阶段可被打断、回滚、重做；提交阶段依然同步一次性完成。
- 提供优先级/车道（lanes）模型，允许高优先级更新“插队”。
- 双缓存 Fiber 树（current/workInProgress）切换，保证提交的一致性与原子性。

## Fiber 是什么（数据结构与链表拓扑）

Fiber 不是 DOM，也不是元素（ReactElement）。它是“一次渲染工作的节点单元”，记录：
- type/key/ref、pendingProps、memoizedProps、memoizedState；
- child/sibling/return 三指针（形成一棵可深度优先遍历的树/链表）；
- alternate 指针：指向该 Fiber 在另一棵树中的“镜像”（用于双缓存切换）；
- lanes/childLanes：当前节点及子树携带的优先级信息；
- flags/subtreeFlags：本次提交需要对 DOM 做的变更类型（Placement/Update/Deletion 等）。

通过这些字段，React 能在渲染阶段逐个处理 Fiber，记录副作用列表（effect list），最后在提交阶段一次性应用到宿主（DOM/原生端）。

## 双缓存：current 与 workInProgress

- current：当前已生效的 Fiber 树；
- workInProgress（WIP）：正在构建的新树（由 current 的 alternate 复用/拷贝）；
- 提交（commit）后，两者指针交换：WIP 变为新的 current，旧 current 成为下一轮的 WIP 基底。

价值：在渲染阶段，无需触碰真实 DOM；所有变更只写入 WIP。只有当整轮渲染准备就绪，才在提交阶段针对 flags 进行真实 DOM 操作，保证原子性与一致性。

## 两个阶段：渲染（可中断）与提交（同步）

1) 渲染阶段（render/reconcile）：
   - 计算新的 Fiber 树；
   - 执行函数组件（读取 hooks 队列）、diff 子元素、生成/合并 flags；
   - 可被调度器打断、回溯、重做；不会产生真实 DOM 变更。

2) 提交阶段（commit）：
   - before-mutation：如 getSnapshotBeforeUpdate（类）或布局快照；
   - mutation：根据 flags 对宿主执行插入/更新/删除；
   - layout：运行布局类副作用（useLayoutEffect cleanup → create），随后触发被动副作用（useEffect）。

渲染阶段的“可中断”与提交阶段的“原子同步”，构成了 Fiber 的关键语义。

## Fiber 节点的创建过程（源码走读）

下面以 React 18 源码结构为线索，梳理 Fiber 的“从无到有、从旧到新”的创建与复用过程，便于把心智模型对齐实际实现。

术语约定：
- current/WIP：当前已提交的 Fiber 与本轮正在构建的副本（workInProgress）。
- tag：Fiber 节点类型枚举（FunctionComponent/ClassComponent/HostRoot/HostComponent/HostText/Fragment 等）。
- lanes：优先级位集；
- flags/subtreeFlags：副作用标记。

1) 根的创建：createFiberRoot / createHostRootFiber
- 入口（新根）：`createRoot(container)` → `createContainer(container, ConcurrentRoot)` → `createFiberRoot`
- `createFiberRoot`：
  - 分配 `FiberRoot` 对象（非 Fiber，保存调度/更新队列/指针等根上下文）。
  - 创建 HostRoot 类型的 Fiber：`createHostRootFiber(tag)`，设置 `fiber.stateNode = root`，并让 `root.current = fiber` 建立互指。
  - 初始化更新队列、优先级结构（根的 lanes），准备成为“current 树”的根。

2) 首次挂载（从 ReactElement 到 Fiber）：createFiberFrom* 与 mountChildFibers
- 入口：调用 `root.render(element)` 或 `ReactDOM.render(element)` → `updateContainer(element, root)`，把 ReactElement 包装成一次更新入队到 HostRoot。
- 渲染阶段 `beginWork(current, workInProgress, renderLanes)`：
  - 对 HostRoot：从更新队列取出 element（或 children），进入子节点调和。
  - 子节点调和在“挂载”路径走 `mountChildFibers`，核心会把 ReactElement → Fiber：
    - 单个节点：`createFiberFromElement(element, mode, lanes)`
    - 文本节点：`createFiberFromText(text, mode, lanes)`
    - 数组/迭代：遍历为多个子 Fiber；
    - Fragment/Portal：对应 `createFiberFromFragment`/`createFiberFromPortal`。
  - 这些工厂函数内部通常调用底层 `createFiber(tag, pendingProps, key, mode)` 分配 Fiber 并填充关键字段：type/key/pendingProps/ref/return/sibling/index/flags/lanes 等。
  - 最终用 `placeSingleChild/placement` 等标记副作用，供 commit 阶段插入真实宿主节点。

3) 更新时的复用：createWorkInProgress 与 reconcileChildFibers
- 当存在 current（已提交）时，更新渲染会尽量“克隆并复用”旧节点，避免全新分配：
  - `workInProgress = createWorkInProgress(current, pendingProps)`：
    - 若 `current.alternate`（旧的 wip）存在则复用；否则分配一个新 Fiber，互设 `alternate` 指针形成“孪生对”。
    - 拷贝结构性字段（如 child/sibling/memoizedState/flags 清洗等），挂上新的 `pendingProps` 与 `lanes`。
  - 子节点调和走 `reconcileChildFibers(current.child, workInProgress, nextChildren, renderLanes)`：
    - 按 key+type 复用匹配的旧子 Fiber，移动/插入/删除通过 flags 标记（Placement/Deletion）；
    - 新子不存在于旧集中 → `createFiberFrom*` 分配新 Fiber；
    - 旧子无匹配 → 标记 Deletion，commit 时移除宿主节点与清理 effect。

4) 关键字段回顾（创建时会初始化/继承）
- 标识：`tag`/`type`/`key`/`elementType`/`ref`
- 树形结构：`return`（父）、`child`、`sibling`、`index`
- 渲染数据：`pendingProps`、`memoizedProps`、`memoizedState`
- 双缓存：`alternate`（与 current/WIP 成对）
- 调度：`lanes`/`childLanes`
- 副作用：`flags`/`subtreeFlags`

5) 创建 vs 复用的判定要点
- 首次挂载：无 current，所有子均由 `createFiberFrom*` 新建；
- 更新：尽量通过 key+type 命中复用，命中则 `createWorkInProgress` 克隆；未命中则走新建/删除；
- 文本/Fragment/Portal 有专门的 create 函数保证 tag 与宿主处理正确。

6) 极简流程图（挂载）

```ts
createRoot → createFiberRoot → (root.current = hostRootFiber)
updateContainer(element)
  ↓ scheduleUpdateOnFiber → renderRoot(Concurrent/Sync)
beginWork(hostRoot)
  children = element
  mountChildFibers(null, hostRootWIP, children)
    ↳ createFiberFromElement/Text/Fragment → createFiber → 链接 child/sibling/return → 标记 Placement
completeWork → 收集 effect list → commitRoot（插入 DOM）
```

7) 极简流程图（更新）

```ts
updateContainer(newElement)
  ↓ scheduleUpdateOnFiber → renderRoot(…)
beginWork(current, wip)
  wip = createWorkInProgress(current, pendingProps)
  reconcileChildFibers(current.child, wip, nextChildren)
    ↳ 命中：复用并设置 flags（Update/Placement 等）
    ↳ 未命中：createFiberFrom* 新建或标记 Deletion
completeWork → commitRoot（更新/移动/删除 DOM）
```

源码锚点（关键函数名，便于检索）：
- `createFiberRoot`、`createHostRootFiber`、`createFiber`
- `createFiberFromElement`、`createFiberFromText`、`createFiberFromFragment`、`createFiberFromPortal`
- `createWorkInProgress`
- `mountChildFibers`、`reconcileChildFibers`、`placeSingleChild`
- `beginWork`、`completeWork`

实战提示：保证 key 稳定且语义正确（同层唯一且表达身份），能让 `reconcileChildFibers` 在更新时最大化复用，从而减少 `createFiberFrom*` 的新建与 DOM 变更，提升性能与状态稳定性。

## 从任意更新定位根节点（scheduleUpdateOnFiber → HostRoot）

当组件内触发一次更新（`setState` / `dispatch` / `useState` 等）时，React 需要从“源 Fiber”精准找到对应的根，以便对该根发起一次渲染调度。这条链路非常关键：

- 向上爬 `return` 链：从源 fiber 起，逐级访问 `fiber.return`，把这次更新对应的 `lane` 依次合并进每一级的 `fiber.lanes` 与 `fiber.childLanes`；
- 直到遇到 `HostRoot`（根 fiber）：取其 `stateNode`，它是 `FiberRoot` 容器对象，记录调度/优先级/缓存等根级上下文；
- 标记根已更新并交给调度器：调度器依据根上“最高优先级的 lane”安排一次渲染（并发/同步视模式与场景而定）。

概念伪代码（抽象化）：

```ts
function scheduleUpdateOnFiber(sourceFiber: Fiber, lane: Lane) {
  const root = markUpdateLaneFromFiberToRoot(sourceFiber, lane)
  if (root == null) return
  markRootUpdated(root, lane)      // 记录 root 有此 lane 的新工作
  ensureRootIsScheduled(root)      // 依据最高优先级安排 render
}

function markUpdateLaneFromFiberToRoot(fiber: Fiber, lane: Lane): FiberRoot | null {
  let node: Fiber | null = fiber
  let parent: Fiber | null = fiber.return
  while (parent !== null) {
    parent.lanes |= lane            // 自身携带该 lane
    parent.childLanes |= lane       // 告知“我的子树里有该 lane 的活”
    // 综合得出该fiber节点的更新优先级以及子树优先级
    node = parent
    parent = parent.return
  }
  return node?.tag === HostRoot ? (node.stateNode as FiberRoot) : null
}
```

要点与边界：
- 只要源 fiber 在一棵有效的 Fiber 树内，`return` 链必达 `HostRoot`；Portal 拥有自己的 `HostRoot`/`FiberRoot`，更新会爬到各自容器根；
- `lanes` 与 `childLanes` 的逐级传播，让“要不要深入这颗子树”变成 O(1) 判断：若当前渲染的 `renderLanes` 与子树不相交，可整体剪枝；
- 并发模式下，同一根会挂着多条 lane，调度器总是先处理最高优先级，低优先级留待稍后或被中断后恢复。

## 调度与优先级（Lanes 简述）

React 18 使用 lanes（多位 bitset）表达优先级与合并策略：
- 用户输入/离散事件使用高优先级 lane；
- 过渡更新（startTransition）使用低一档 lane，可被更高优先级打断；
- 多个更新可被合并到同一 lane，成批处理；
- childLanes 让父节点快速知道哪个子树仍有待处理的更高优先级工作。

开发者接口：
- startTransition(fn)：把 fn 内的 state 更新标记为“非紧急”，让交互优先；
- useDeferredValue(value)：延迟昂贵派生的刷新，保持输入流畅；
- 自动批处理：跨事件源的 setState 也会合并，减少渲染次数。

## Diff 与 Flags（副作用列表）

渲染阶段对比新旧子元素（type + key）：
- 相同 type/key → 复用 Fiber，标记 Update；
- key 不同或 type 变化 → Placement/Deletion；
- 文本变化 → HostText Update。

所有需要落地的变更被收集到 effect list（由 flags 串起），提交阶段按顺序对宿主执行。

## 可中断、可恢复、可回溯如何成立

- 单元工作模型：`performUnitOfWork(fiber)` 处理一个 Fiber 后返回“下一个要做的”节点；
- 在每个单元间检查“是否超出时间预算/有更高优先级任务到来”，若是则 yield（让出线程）；
- 重新进入时，从上次的“下一个节点”继续；若有更高优先级更新，调度器会从根或合适位置重新开始，低优先级工作稍后恢复；
- 因为渲染阶段不做副作用、Fiber 节点保存上下文，重放是安全的。

示意伪代码：

```ts
let nextUnit: Fiber | null = rootFiber;
function workLoop(deadline: Deadline) {
  while (nextUnit && deadline.timeRemaining() > 0) {
    nextUnit = performUnitOfWork(nextUnit); // 深度优先：child → sibling → return
  }
  if (nextUnit) {
    schedule(workLoop); // 让出线程，稍后继续
  } else {
    commitRoot(); // 渲染完成，进入提交
  }
}
```

## 对开发者的实践意义

- 渲染函数必须“纯”，避免请求/订阅/直接改 DOM 等副作用；
- 初始/非阻塞副作用放 useEffect；需要布局读写放 useLayoutEffect，但注意阻塞绘制；

## 时间分片（Time Slicing）详解

### 1. 定义
在单线程环境下，将一次可能阻塞主线程的大渲染/计算拆解为多个可中断的小工作单元（Fiber 节点），在帧预算耗尽前主动让出执行权，稍后继续，以提升响应性。

### 2. 目标
- 保持输入/动画流畅（降低输入延迟 First Input Delay）。
- 允许不同优先级更新“插队”（高优先级先完成，低优先级分片继续）。

### 3. 误区对比
| 误区 | 现实 |
|------|------|
| 多线程并行 | 仍单线程，协作式调度 |
| 每帧固定切一刀 | 按“是否超预算”动态 yield |
| 自动优化任意 JS 任务 | 只覆盖 React 的 render phase，纯 CPU 任务需你自己拆 |

### 4. React 实现要点（简化）
1. Fiber 链表结构（child/sibling/return）提供“下一个工作单元”。
2. Scheduler 维护优先级/任务队列（lanes）。
3. `performUnitOfWork(fiber)` 执行 → 检查时间 → 超预算则 yield（通过 MessageChannel 安排下次调度）。
4. 最终一次完整 render 产出 effect list，进入同步 commit（不可分片）。

### 5. 与 rAF / rIC
| API | 行为 | 局限 |
|-----|------|------|
| requestAnimationFrame | 帧头一次回调 | 不看“剩余时间” |
| requestIdleCallback | 浏览器空闲回调 | 可能饿死 / 支持不齐全 |
| React Scheduler | 自控截止时间 + 优先级 | 需自主管理时间预算 |

### 6. 开发者需要做什么
| 动作 | 目的 |
|------|------|
| 保持 render 纯函数 | 允许中断/回放安全 |
| 避免巨量同步循环 | 让切片真正有机会让出 |
| 用 `startTransition` 标记非紧急更新 | 优先处理输入类更新 |
| 大列表虚拟化 | 减少单次渲染工作量 |
| 拆分昂贵计算（或放 Web Worker） | 不阻塞主线程 |

### 7. 何时看不到切片收益
- 仍用 `ReactDOM.render`（未用 18 `createRoot`）。
- 全部都是高优先级同步更新。
- 渲染中存在长阻塞计算（无 yield 点）。

### 8. 示例（思想类比）
```js
let i = 0;
function work() {
  const start = performance.now();
  while (i < bigTasks.length && performance.now() - start < 5) {
    doUnit(bigTasks[i++]);
  }
  if (i < bigTasks.length) {
    setTimeout(work); // 主动让出
  }
}
work();
```

### 9. 速记
> 时间分片 = “把可中断的 render 分块 + 按预算执行 + 支持优先级插队”，核心收益是在不牺牲最终一致性的情况下提升交互响应性。

### React 18 调度器与时间切片：中断与继续（源码视角）

这一小节更细地结合核心函数与伪代码，说明“如何中断”和“如何基于 Fiber 的 child/sibling/return 指针找到下一个工作单元”。

#### 1) 调度器（Scheduler）与截止时间（deadline）

- 更新入队后，经 `scheduleUpdateOnFiber → ensureRootIsScheduled` 将根任务提交给 Scheduler：

```ts
function ensureRootIsScheduled(root) {
  const nextLanes = getNextLanes(root)                  // 选出该根的最高优先级 lanes
  const priority = lanesToSchedulerPriority(nextLanes)  // lanes → SchedulerPriority
  scheduleCallback(priority, () => performConcurrentWorkOnRoot(root))
}
```

- Scheduler 用 `MessageChannel` 驱动循环，维护一个“是否超出时间预算”的判断：`shouldYield()`（等价于“deadline.timeRemaining() <= 0”）。

#### 2) 并发渲染入口与工作循环

```ts
function performConcurrentWorkOnRoot(root) {
  const lanes = getNextLanes(root)
  // 渲染该优先级集合
  renderRootConcurrent(root, lanes)
  // 渲染完成则提交；否则因让出或更高优先级插队，稍后继续/重启
  if (workInProgressRootDidComplete) commitRoot(root)
  else ensureRootIsScheduled(root)
}

function renderRootConcurrent(root, lanes) {
  prepareFreshStack(root, lanes) // 若首次或优先级改变，准备一棵新的 WIP 栈
  workLoopConcurrent()
}

function workLoopConcurrent() {
  while (workInProgress !== null && !shouldYield()) {
    workInProgress = performUnitOfWork(workInProgress)
  }
}
```

- 关键点：每做完一个 Fiber，就检查一次 `shouldYield()`；一旦超预算即“中断返回”。

#### 3) 单元工作：如何找到“下一个节点”

`performUnitOfWork` 通过 Fiber 的三指针（child/sibling/return）按“深度优先”的顺序推进：

```ts
function performUnitOfWork(fiber: Fiber): Fiber | null {
  // 1) begin：构建/对比子树，决定 child
  const next = beginWork(fiber.alternate, fiber, renderLanes)
  fiber.memoizedProps = fiber.pendingProps

  if (next !== null) {
    // 有子：设置父指针，继续向下
    next.return = fiber
    return next
  }
  // 2) 无子：进入 complete，向上归并并尝试走兄弟
  return completeUnitOfWork(fiber)
}

function completeUnitOfWork(node: Fiber): Fiber | null {
  let fiber: Fiber | null = node
  while (fiber !== null) {
    completeWork(fiber.alternate, fiber)   // 计算 DOM 更新 payload/flags，并把 flags 向上聚合到 subtreeFlags
    const sibling = fiber.sibling
    if (sibling !== null) {
      sibling.return = fiber.return
      return sibling                     // 转向兄弟分支，继续 DFS
    }
    fiber = fiber.return                  // 无兄弟则回到父，继续向上归并
  }
  return null                              // 回到根，说明本次渲染完成
}
```

- 这就是“记录下一个节点”的本质：
  - 有 child 先走 child；
  - child 处理完后，complete 阶段尝试走 sibling；
  - 无 sibling 则回溯到 return（父），继续寻找父的兄弟；
  - 回溯至根返回 null，表示 WIP 树构建完成。

#### 4) 如何被中断、如何恢复

- 中断触发：
  - `workLoopConcurrent` 中每处理一个 Fiber 都会检查 `shouldYield()`，时间预算用尽即返回，保留 `workInProgress` 指针（或可从它的父/兄恢复）。
  - 更高优先级更新到来时，`getNextLanes` 会改变，`prepareFreshStack` 重置 WIP，从 HostRoot 以更高优先级重算（低优先级稍后恢复）。

- 恢复继续：
  - 若是“时间预算用尽”的中断：下一次 `performConcurrentWorkOnRoot` 会继续 `workLoopConcurrent`，从当前 `workInProgress`（尚未完成的 Fiber）接着跑。
  - 若被“更高优先级”打断：会基于新 lanes 从根重新开始；先完成高优，再回到低优（保留在 baseQueue/childLanes 的信息确保不会丢工作）。

#### 5) 与 lanes 的关系（谁可以插队）

- `lanes` 描述优先级；`getNextLanes(root)` 计算当下应该干的最高优先级集合；
- 当一条更高优先级的 lane 入队，`ensureRootIsScheduled` 会以对应的 SchedulerPriority 重新排程，使得高优先任务插队；
- 低优先仍保留在队列/子树（`childLanes`）上，等待下一次调度。

#### 6) 小结

- 中断靠 `shouldYield()`（时间片结束）或更高优先级更新插入；
- “下一个工作单元”由 Fiber 的 child/sibling/return 三指针按 DFS 顺序确定；
- 恢复继续要么从 `workInProgress` 接着跑，要么在高优先级完成后再回到低优先级；
- 渲染阶段不触碰真实 DOM，只有在提交阶段一次性根据 flags/subtreeFlags 落地变更，保证一致性与原子性。
- 使用 startTransition 标注非紧急更新，提升输入响应；
- 大列表/重计算：虚拟化、分片计算、Web Worker；
- key 稳定且语义正确，避免状态错位与不必要重建。

## 关联主题速记

- 时间分片（Time Slicing）：基于 Fiber 的切片与让出，改进交互响应；
- 自动批处理：跨事件上下文的 setState 合并；
- 错误边界：错误在 Fiber 子树内被捕获，避免整棵树崩塌；
- 并发根（createRoot）：启用并发能力，否则仍以旧策略运行。

一句话总结：
> Fiber = “链表化的工作单元 + 双缓存 + 可中断渲染 + 可控调度”，渲染阶段切片、提交阶段原子落地，让大型应用在保持一致性的同时获得更好的交互流畅度。

## Scheduler 的任务队列（taskQueue/timerQueue，React 18 源码视角）

这部分属于“调度层”（独立于 Fiber 树），负责在浏览器主线程上以可中断的方式按优先级运行回调。React 通过它把一次“对某个根的渲染工作”提交为一个回调，调度层再决定何时执行/是否让出。

核心结构（两个最小堆，来源于 scheduler 包）：
- timerQueue（按 startTime 排序）：延迟开始的任务（有 delay）。
- taskQueue（按 expirationTime 排序）：已经可以执行的任务。

任务对象（简化自源码）：

```ts
type Task = {
  id: number
  callback: null | ((didTimeout: boolean) => void | (() => any))
  priorityLevel: SchedulerPriority // Immediate/UserBlocking/Normal/Low/Idle
  startTime: number               // = now + delay
  expirationTime: number          // = startTime + timeout(priority)
  sortIndex: number               // 用于堆排序：timerQueue 用 startTime；taskQueue 用 expirationTime
}
```

关键 API 与流程（伪代码，字段/函数名对应源码）：

```ts
// 1) 注册任务：把 React 的“要做的事”提交给调度器
function scheduleCallback(priority: SchedulerPriority, cb, options?) {
  const now = getCurrentTime()
  const delay = options?.delay ?? 0
  const startTime = now + delay
  const timeout = priorityToTimeout(priority) // Immediate:-1, UserBlocking:250ms, Normal:5s, Low:10s, Idle:很大值
  const expirationTime = startTime + timeout
  const task: Task = { id: nextId++, callback: cb, priorityLevel: priority, startTime, expirationTime, sortIndex: 0 }

  if (delay > 0) {
    task.sortIndex = startTime
    push(timerQueue, task)                 // 先放“定时堆”
    requestHostTimeout(handleTimeout, delay) // 到点后把它搬到 taskQueue
  } else {
    task.sortIndex = expirationTime
    push(taskQueue, task)                  // 立即可执行
    requestHostCallback(flushWork)         // 用 MessageChannel 触发工作循环
  }
  return task
}

// 2) 到点搬运：把 timerQueue 里“已到开始时间”的任务转移到 taskQueue
function advanceTimers(now: number) {
  let timer = peek(timerQueue) //最小堆，最顶上的任务需要等待的事件最少
  while (timer) {
    if (timer.callback === null) { pop(timerQueue) }          // 已取消
    else if (timer.startTime <= now) {                        // 到点了
      pop(timerQueue)
      timer.sortIndex = timer.expirationTime
      push(taskQueue, timer)
    } else { break }
    timer = peek(timerQueue)
  }
}

// 3) 工作循环：按过期时间从 taskQueue 取任务执行；每个任务后检查是否“超预算”
function flushWork(hasTimeRemaining: boolean, initialTime: number) {
  let currentTime = initialTime
  advanceTimers(currentTime)
  let task = peek(taskQueue)
  while (task) {
    if (
      task.expirationTime > currentTime &&      // 未到过期
      (!hasTimeRemaining || shouldYield())       // 没时间或该让出
    ) {
      break
    }
    const cb = task.callback
    if (cb !== null) {
      task.callback = null
      const didTimeout = task.expirationTime <= currentTime
      const continuation = cb(didTimeout)        // 回调可返回“续作”函数，表示还有未完成工作
      currentTime = getCurrentTime()
      if (typeof continuation === 'function') {
        task.callback = continuation             // 复用同一个任务对象，下一轮继续
      } else {
        pop(taskQueue)                           // 完成，弹出
      }
      advanceTimers(currentTime)
    } else {
      pop(taskQueue)                             // 已被取消
    }
    task = peek(taskQueue)
  }
  if (task) { requestHostCallback(flushWork) }   // 还有任务，安排下一轮
}
```

时间预算与让出：
- `shouldYield()` 基于一帧的“截止时间”（MessageChannel 驱动）与 `navigator.scheduling.isInputPending`（可用时）判断是否需要让出主线程。
- 这使调度层能把长任务切成片段运行，从而“可中断、可恢复”。

与 React 的关系（把 lanes 映射为调度优先级）：

```ts
// React 内部：为某个根安排渲染
function ensureRootIsScheduled(root) {
  const nextLanes = getNextLanes(root)                  // 取该根最高优先级 lane 集合
  const priority = lanesToSchedulerPriority(nextLanes)  // lanes → SchedulerPriority（Immediate/UserBlocking/...）
  scheduleCallback(priority, () => performConcurrentWorkOnRoot(root))
}
```

二者的分工与区别：
- lanes：发生在 Fiber/渲染层的“位集优先级”与合并策略（决定哪棵子树、哪些更新应先做，可做剪枝）。
- taskQueue/timerQueue：发生在调度层的“回调执行顺序”与“时间切片”，决定何时把某个回调跑起来、何时让出。
- React 会把“处理某根、某优先级集合的工作”打包成一个回调交给 scheduler；真正进入回调后，再由 lanes 决定渲染循环里干哪条 lane 的活。

常见细节：
- 取消：`unstable_cancelCallback(task)` 仅把 `task.callback = null`，实际弹出发生在下一次 `flushWork/advanceTimers`。
- 延迟：带 `delay` 的任务先进入 `timerQueue`，到点后转入 `taskQueue`。
- 优先级映射的典型超时时间（源码常量）：Immediate:-1、UserBlocking:250ms、Normal:5000ms、Low:10000ms、Idle:极大值。

一句话：taskQueue/timerQueue 保障“先到期、再按优先级”的可中断执行；lanes 决定“渲染里做谁的活”。二者配合，形成 React 18 的并发与时间分片能力。


## 渲染阶段如何 diff 并标记需要修改的虚拟 DOM

渲染（render）阶段的目标是“基于旧树 current 生产一棵新的 workInProgress 树”，在此过程中完成“diff + 标记（flags）”。主干调用链：

```
renderRoot → workLoop → performUnitOfWork → beginWork → reconcileChildren → … → completeWork
```

核心职责切分：
- beginWork：决定树形结构如何变化（创建/复用/重连 child/sibling），把“是否可能需要更新”信息传递下去；
- reconcileChildren：按 key + type O(n) 规则对比新旧孩子，产出“复用/插入/移动/删除”的结论；
- completeWork：为宿主节点（HostComponent/HostText）计算具体更新 payload，并把 `flags/subtreeFlags` 汇总到当前 fiber。

子节点 diff 规则（高频摘要）：
- 单节点：
  - key 与 type 同时相同 → 复用旧 fiber（保留 DOM 实体），可能打 `Update`；
  - 否则 → 删除旧（打 `ChildDeletion`）并新建（新 fiber 打 `Placement`）。
- 多节点（数组）：
  - 第一轮线性对齐：从头按顺序比对，直到遇到第一个不匹配（key 或 type 变了）；
  - 第二轮用 Map 命中：把剩余旧孩子做成 `key → oldFiber` 的 Map，再用新孩子去命中；命中则复用并判定是否需要移动；未命中则新建（`Placement`）。
  - 移动判定：`lastPlacedIndex` 算法。若“新孩子对应的旧 fiber 的 oldIndex < lastPlacedIndex”，说明需要向后移动，打 `Placement`；否则更新 `lastPlacedIndex`。
- 删除：所有未被命中的旧孩子统一打 `ChildDeletion`，提交阶段做深度卸载（解绑 ref、清理 effects）。

标记（flags）即“需要修改的虚拟 DOM”的结果：
- 常见标记：`Placement`（插入/移动）、`Update`（属性/文本变更）、`ChildDeletion`、`Ref`、`Visibility`、`Passive` 等；
- React 18 起不再单独维护“effect list 单链表”，而以 `flags/subtreeFlags` 引导提交阶段的树式遍历；
- 渲染结束时，整棵 WIP 树上挂满了这些 flags，提交阶段据此最小化地操作真实 DOM。

提交阶段（极简）：
1) before-mutation：收集快照（类组件/布局前读写）；
2) mutation：深度优先遍历，遇到 `Placement` → 找宿主父与参照兄弟执行 `insertBefore/appendChild`；遇到 `Update` → 按 payload 设置属性/样式/文本；遇到 `ChildDeletion` → 深度卸载并 `removeChild`；
3) layout：更新 ref，执行布局副作用，然后调度被动副作用（`useEffect`）。

### 一次完整更新：从源 fiber 到真实 DOM

```
setState/useState → scheduleUpdateOnFiber
  ↳ 向上爬 return 链合并 lanes → 找到 HostRoot/FiberRoot → 根入调度
render（可中断）
  ↳ beginWork/reconcileChildren（key+type O(n) diff，产出复用/插入/移动/删除）
  ↳ completeWork（计算宿主更新 payload，汇总 flags）
commit（同步）
  ↳ 遍历 flags/subtreeFlags：DOM 插入/更新/删除 + ref/effect 布置
  ↳ 交换 current 与 workInProgress 指针
```

实战建议（与 diff 强相关）：
- key 必须稳定且同层唯一，表达“身份”，避免列表变更导致的状态错位与无谓重建；
- 尽量让重排可被 `lastPlacedIndex` 感知为“少量移动”，不要让 key 抖动；
- 避免在 render 中生成不稳定的元素类型（type 变化会强制卸载/重建）。