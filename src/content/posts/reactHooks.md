---
title: ReactHooks的设计思想与工作模式
published: 2025-10-13
description: 对react底层hooks的深入了解
category: Notes
tags: [frondend, typescript, react]
draft: false
---

## 0. hooks使用注意事项
1. 只在react中使用
2. 不能在循环，嵌套，子函数中使用(注意：*setState*不算reactHooks，而是其返回的值，所以可以在循环、嵌套、子函数中使用)

**这样是为了确保每次渲染时都执行相同都顺序**

此处涉及到底层部分，下面会有讲解


## 1. 设计初衷与理念

Hooks 的目标：在函数组件中，以“协议化的方式”获得状态、上下文、生命周期与性能能力，替代类组件中分散在生命周期的逻辑堆叠，促进逻辑按“功能维度”切片与复用。

- 函数式与可组合：用多个小 Hook 组合一块特性（如表单、订阅、异步数据），自定义 Hook 将“状态 + 行为 + 副作用”封装为一个可重用单元。
- 渲染纯函数化：组件函数应是“输入 → 输出”的纯计算；副作用统一延后到提交阶段（commit）执行，保证 Fiber 并发/中断安全。
- 与 Fiber/并发调度契合：render 阶段可中断/回放，Hooks 的数据结构挂载到 Fiber 上，React 能在打断后恢复继续，副作用只在被提交的那一版运行。

与类组件对比：类将逻辑按生命周期切片，多个需求横跨多个生命周期；Hooks 则按特性聚合（一个 Hook 内自洽），更利于拆分与复用。

## 2. 底层工作模型（renderWithHooks）

函数组件渲染时，React 会进入“带 Hooks 的渲染路径”（renderWithHooks）：

- 当前 Fiber 保存一条“hooks 单链表”（memoizedState 指向首节点）。
- 按调用顺序依次“消费” Hook 节点：mount 时创建节点并链接；update 时按相同顺序取用已有节点。
- 每个 Hook 节点结构近似：`{ memoizedState, baseState/queue, deps, next }`。
- 通过当前的 dispatcher（mount vs update）分发到不同实现，保证首次渲染与更新渲染行为分别处理。

关键伪代码（抽象化）：

```ts
let currentlyRenderingFiber: Fiber | null = null
let workInProgressHook: Hook | null = null
let currentHook: Hook | null = null

function renderWithHooks(fiber, Component, props) {
  currentlyRenderingFiber = fiber
  workInProgressHook = null
  currentHook = fiber.alternate ? fiber.alternate.memoizedState : null
  ReactCurrentDispatcher.current = fiber.alternate ? UpdateDispatcher : MountDispatcher
  const children = Component(props)
  // 渲染结束，将本轮挂好的 hooks 链接到 fiber.memoizedState
  fiber.memoizedState = workInProgressHookHead
  return children
}

function mountWorkInProgressHook(): Hook {
  const hook: Hook = { memoizedState: null, baseState: null, queue: null, deps: null, next: null }
  if (workInProgressHook === null) { workInProgressHookHead = hook } else { workInProgressHook.next = hook }
  workInProgressHook = hook
  return hook
}

function updateWorkInProgressHook(): Hook {
  // 复用 currentHook，对应位置取出，推进游标
  const hook = currentHook!
  currentHook = currentHook!.next
  const cloned: Hook = { ...hook, next: null } // 克隆到 wip
  if (workInProgressHook === null) { workInProgressHookHead = cloned } else { workInProgressHook.next = cloned }
  workInProgressHook = cloned
  return cloned
}
```

### 术语澄清：memoizedState / workInProgressHookHead / Hook 的关系与执行过程

`fiber.memoizedState` 可以被 `workInProgressHookHead` 赋值，而 `hook` 又可以赋值给 `workInProgressHookHead`，会不会类型错乱？”

结论：不会。因为这三者在“函数组件语境”下都指向 Hook 链表结构的一部分，类型是一致的（Hook 或 Hook | null）。React 源码用的是宽松类型（Flow/any），实际语义依赖于 `fiber.tag`（函数组件/类组件等）。

- `Hook`：单个钩子节点（`{ memoizedState, queue, deps, next }`）。
- `workInProgressHookHead`：本轮渲染“当前函数组件的 Hook 链表头指针”（局部变量）。第一次挂载的第一个 `Hook` 会把它指向自己；后续通过 `next` 串联。
- `fiber.memoizedState`：对于函数组件，这里保存“该组件的 Hook 链表头”（即 `workInProgressHookHead`）；对于类组件则保存类的 state（多态字段）。

执行过程（精简）：
1) mount：每次 `mountWorkInProgressHook()` 都会创建一个 `Hook`，若是第一个则令 `workInProgressHookHead = hook`，最后在 `renderWithHooks` 末尾把 `fiber.memoizedState = workInProgressHookHead`。
2) update：`currentHook = fiber.alternate.memoizedState` 作为旧链头；`updateWorkInProgressHook()` 克隆旧节点为新 `Hook`，按顺序构建新链，同样在末尾 `fiber.memoizedState = workInProgressHookHead`。

命名容易混淆点：`workInProgress` 在源码既用于“整棵 WIP Fiber 树”的节点，也用于“本组件本轮渲染的 Hook 节点”。作用域不同，别把 Hook 层面的 head 误解为 Fiber 树的根。

要点：
- “顺序即身份”：React 依赖调用顺序定位 Hook 节点，所以必须“只在顶层调用 Hook，不能在条件/循环里改变顺序”。
- Hook 节点链挂在 Fiber 上，使得未提交版本的渲染可被打断并重做，而不会污染 current。

### 具体执行逻辑

- Mount（首次）：dispatcher=Mount；按调用顺序创建 Hook 节点并用 next 串联，初始化 memoizedState/queue/deps；渲染末尾把链头挂到 fiber.memoizedState；effect 仅打标，执行在 commit。
- Render（通用）：渲染阶段只构建/克隆 Hook 链与打标，不做副作用/DOM；必须保持 Hook 调用顺序恒定（顺序即身份）；并发下未提交版本可丢弃，其 effect 不会运行。
- Update（后续）：dispatcher=Update；从 currentHook=fiber.alternate.memoizedState 依次克隆对应旧节点构建新链；useState/useReducer 依队列+优先级还原新 state；effect 依 deps 浅比较决定是否标记；渲染末尾更新 fiber.memoizedState；current↔WIP 的交换发生在 commitRoot（非 render）。

**总结：hooks链表的长度在mount时就固定了，无法修改**

### 术语补充：dispatcher 是什么？

dispatcher 可以理解为“当前渲染上下文下的 Hooks 调用实现表”。React 通过一个全局的 `ReactCurrentDispatcher.current` 指针，指向一组针对当下渲染场景的 Hook 实现集合：

- MountDispatcher：首轮挂载时的实现（创建 Hook 节点、初始化状态/队列/依赖）。
- UpdateDispatcher：更新渲染时的实现（复用对应位置的 Hook 节点、处理更新队列、比较依赖）。
- RerenderDispatcher：在同一渲染周期内因某些原因触发“再渲染”的变体，处理队列合并等细节。
- Server/Client 变体：SSR/Flight 等环境下有对应的受限实现（如禁用某些只能在客户端使用的 Hook）。

设置与使用时机（高度抽象）：

```ts
function renderWithHooks(fiber, Component, props) {
  ReactCurrentDispatcher.current = fiber.alternate
    ? UpdateDispatcher
    : MountDispatcher
  // 之后在 Component(props) 执行过程中，诸如 useState/useEffect
  // 实际调用的是 current 指向的实现。
  const children = Component(props)
  ReactCurrentDispatcher.current = null // 清理
  return children
}
```

要点澄清：
- 它不是 Redux 的 dispatch。Redux 的 `dispatch(action)` 是事件派发；这里的 dispatcher 是“Hook API 的具体实现路由表”。
- 切换 dispatcher 的目的，是让同一套 Hook API（useState/useEffect/…）在“挂载 vs 更新 vs 服务端”等不同阶段/环境下表现正确。
- 在开发环境，React 还有一个带校验/警告的 dev 变体 dispatcher，用于发现“条件调用 Hook”“非法调用时机”等问题。

## 3. useState/useReducer：更新队列与调度

useState 基于“更新队列（环形链表）”与“reducer = basicStateReducer”：

```ts
// mount
MountDispatcher.useState = (initial) => {
  const hook = mountWorkInProgressHook()
  const initialState = typeof initial === 'function' ? initial() : initial
  hook.memoizedState = initialState
  hook.baseState = initialState
  hook.queue = { pending: null, lane: NoLane, dispatch: null }
  const dispatch = (action) => dispatchSetState(currentlyRenderingFiber!, hook.queue, action)
  hook.queue.dispatch = dispatch
  return [hook.memoizedState, dispatch]
}

// update
UpdateDispatcher.useState = (initial) => {
  const hook = updateWorkInProgressHook()
  const queue = hook.queue
  // 将 queue.pending 上的 update 环取下，按优先级/时间顺序还原
  const newState = processQueue(hook.baseState, queue.pending)
  hook.memoizedState = newState.baseState
  hook.baseState = newState.baseState
  return [hook.memoizedState, queue.dispatch]
}
```

dispatchSetState 会：
- 生成 update 节点（action / eager 计算结果 / lane 优先级等），挂到 queue.pending（环）；
- 标记 Fiber 及根的 lanes，交给调度器根据优先级安排一次新的渲染；
- 在并发模式下可被批处理与合并，多次 setState 仅触发一次提交。

函数式更新 `setState(prev => next)` 在底层作为 reducer 调用，避免闭包陈旧依赖旧值。

### setState工作流

> 要点速记：入队是环（O(1) 追加）→ lanes 决定“何时渲染、能否打断” → 渲染时按优先级折叠队列 → 提交阶段一次性落地副作用；触发时若能 eager 计算且“值未变”，可短路跳过调度。

#### 全流程概览（类/函数组件通用思路）
- 1) 产生更新：调用 setState(value) 或 setState(updater) 生成一个 Update（含 lane 优先级、payload、可选回调）。
- 2) 入队：
  - 类组件挂到 Fiber 的 updateQueue（链表）。
  - 函数组件挂到对应 Hook 的 queue（环形链表）。
- 3) 调度：scheduleUpdateOnFiber 标记根的 pendingLanes，交由调度器根据 lane 安排渲染时机（高优先级尽快，低优先级可打断/延后）。
- 4) 渲染阶段（render/reconcile）：
  - beginWork/completeWork 期间按队列顺序把 payload 应用到 baseState 得到新 state；同时对比新旧虚拟树生成 effect list。
- 5) 提交阶段（commit：beforeMutation → mutation → layout）：
  - 应用 DOM 变更、更新 fiber.memoizedState；
  - 触发生命周期/Effect：类组件的 getSnapshotBeforeUpdate → componentDidUpdate/第二参回调；函数组件的 layout effects 同步、passive effects 异步。
- 6) 收尾：清空已消费的 update，可能继续处理低优先级 lane，并在空闲时执行 passive effects。

#### setState 是同步还是异步？
- 本质是“排队的”（入队 → 渲染 → 提交），所以表象常“像异步”，读到新值取决于批处理与优先级。
- React 17 或 React 18 的 legacy root（ReactDOM.render）：默认批处理仅覆盖 React 管理的事件；setTimeout/Promise.then 等“React 之外”的回调通常不会被自动批处理，更新可能被“立即同步提交”。
- React 18 并发根（createRoot）：自动批处理扩展到 setTimeout/Promise/原生事件，大多数情况下会等回调结束后统一提交，此时同一回调里读取到的是旧值。
- 类 vs 函数组件读取差异：
  - 函数组件中的 state 变量是“本次渲染的快照”，同一回调内 setState 后继续读取，仍是旧值（除非 flushSync 强制提交或等下一次渲染）。
  - 类组件在“未批处理且同步提交”的场景（旧根 + setTimeout）里，this.setState 之后紧跟读取 this.state 可能就是新值。
- 可控开关：
  - flushSync(() => setState(...)) 强制同步提交（谨慎使用）。
  - startTransition 降低优先级，让非紧急 UI 更新更平滑。

#### 直接更新 vs 函数式更新
- 类组件：
  - 直接更新 this.setState({ a: 1 }) 为浅合并（shallow merge）。
  - 函数式更新 this.setState((prevState, props) => partialState) 适合依赖旧值，避免竞态/闭包陈旧。
- 函数组件：
  - 直接更新 setState(nextValue) 是“替换”（不会自动 merge 对象/数组）。
  - 函数式更新 setState(prev => next) 可确保多次累加基于最新 prev。
- 典型对比（函数组件）：
  - 错误（可能只加 1）：setCount(count + 1); setCount(count + 1)
  - 正确（一定 +2）：setCount(c => c + 1); setCount(c => c + 1)
- 更新对象（函数组件）：setUser(u => ({ ...u, name: 'Alice' }))，不要用 setUser({ name: 'Alice' }) 以免丢字段。

#### 为什么 setTimeout 里看起来“同步”？
- 旧根（legacy root）中，setTimeout 不在自动批处理中，调度器往往会立刻渲染+提交这次更新；因此在同一个 setTimeout 回调里，this.setState(...) 紧跟的 console.log(this.state) 可能已经是新值。
- 新根（createRoot）中，setTimeout 被自动批处理，提交延后到回调返回之后，回调内读取到的仍是旧值。

示例（类组件日志对比）：

```ts
reduce = () => {
  console.log('before:', this.state.count)
  setTimeout(() => {
    this.setState(
      ps => ({ count: ps.count - 1 }),
      () => console.log('after commit (callback):', this.state.count)
    )
    console.log('after immediately in timeout:', this.state.count)
  }, 0)
}
```

- 旧根：可能打印 before: 0 → after immediately in timeout: -1 → after commit: -1
- 新根：会打印 before: 0 → after immediately in timeout: 0 → after commit: -1

#### 实践建议
- 依赖旧值时一律用函数式更新（类/函数组件都适用）。
- 函数组件更新对象要自己合并：setObj(o => ({ ...o, k: v })).
- 不要指望 setState 后立刻读到新值；在提交后读：类组件用 setState 第二参/DidUpdate，函数组件用 useEffect。
- 仅在少数必须的场景使用 flushSync；非紧急计算用 startTransition 包裹。


#### 源码与关键函数链路（深入）

以下名称以 React 18 为主（略去内部构建差异），用于把心智模型对上源码：

1) 触发更新（类组件与 hooks）
- 类组件：
  - 调用 this.setState(partial, callback)
  - enqueueSetState → enqueueUpdate/createUpdate（tag=UpdateState, payload=partial, callback）
  - 将 update 追加到 fiber.updateQueue.shared.pending（环状/链表）
  - markUpdateLaneFromFiberToRoot 标记 lane 并向上冒泡到 root
  - scheduleUpdateOnFiber(root, fiber, lane)
- 函数组件（useState）：
  - dispatchSetState(queue, action)
  - 构造 hookUpdate（{ lane, action, eagerState? }），拼到 queue.pending（环）
  - 如果可以做 eager 计算（lastRenderedReducer/State 可用）且 Object.is(eager, lastRenderedState) 为真，则可直接跳过调度；否则继续：markUpdateLaneFromFiberToRoot → scheduleUpdateOnFiber

2) 调度与任务入队
- scheduleUpdateOnFiber 会：
  - 标记 root.pendingLanes |= lane，并进行优先级整合（entangleTransitions 等）
  - ensureRootIsScheduled(root)：
    - 根据 root 的 nextLanes 选择调度优先级（SchedulerPriority）
    - 使用 Scheduler（unstable_scheduleCallback）安排一个 performConcurrentWorkOnRoot 或 performSyncWorkOnRoot 任务
  - 结论：每个 setState 都会被赋予一个 lane；调度按 lanes 进行选择与排序，高优先级可以打断低优先级。

3) 渲染阶段（可打断）
- 入口：performConcurrentWorkOnRoot / performSyncWorkOnRoot
- renderRootConcurrent / renderRootSync → workLoopConcurrent/Sync：
  - performUnitOfWork(fiber)：
    - beginWork(current, workInProgress, renderLanes)：
      - updateFunctionComponent / updateClassComponent / updateHostComponent ...
      - 类组件中会在 updateClassInstance → processUpdateQueue(baseState, queue, props, instance, renderLanes) 折叠更新得到 memoizedState
      - 函数组件中 useState/useReducer 的更新在 render 阶段通过 hook reducer 折叠 queue.baseQueue/queue.pending
    - completeWork：生成 effect 与 DOM 相关副作用（placement/update/deletion 标记）
- 渲染可能被更高优先级更新打断，未提交的结果不会影响真实 UI。

4) 提交阶段（不可打断）
- commitRoot(root)：
  - beforeMutation → mutation → layout 三子阶段：
    - 应用 DOM 变更（mutation）
    - 更新 fiber.memoizedState/fiber.flags 归零
    - 类组件：getSnapshotBeforeUpdate → componentDidUpdate；执行 setState 第二参 callback
    - 函数组件：运行 layout effects；passive effects 在后续宏/微任务由调度器异步执行
- 提交后清理已消费的 update；保留未命中的低优先级更新到下一次。

5) 队列结构（便于定位问题）
- 类组件的 updateQueue：
  - 结构：{ baseState, firstBaseUpdate, lastBaseUpdate, shared: { pending }, effects }
  - update：{ tag, lane, payload, callback, next }
  - processUpdateQueue 时会将 shared.pending 上的更新转移到 base 队列并按顺序执行；低优先级会暂存，保证不丢。
- hooks 的队列（useState/useReducer）：
  - hook：{ memoizedState, baseState, baseQueue, queue }
  - queue：{ pending, dispatch, lastRenderedReducer, lastRenderedState }
  - 每个 update：{ lane, action, eagerState?, hasEagerState? }
  - 通过环形队列在渲染时“展开”，折叠为新状态；同样保留低优先级未处理更新。

6) 关键优化与陷阱
- Eager state（hooks）：如果能在触发时基于 lastRenderedReducer 计算出新值且与 lastRenderedState 相同，直接跳过调度（避免无效渲染）。
- 等值短路：Object.is(prev, next) 相等通常会 bail out；类组件若提供了 callback 仍会安排一次 commit 以调用回调。
- 批处理：
  - 旧根下默认仅 React 事件回调批处理；setTimeout/Promise.then 需 unstable_batchedUpdates 手动包裹。
  - 新根（createRoot）启用自动批处理，覆盖 setTimeout/Promise/原生事件。
- 过渡优先级：startTransition 标记低优先级 lanes，交互更顺滑；render 可被打断，但提交保持原子性。

7) 读值时机建议（结合并发）
- 不依赖“调用后立刻能读到新 state”，把依赖放到：
  - 类组件：setState 第二参或 componentDidUpdate。
  - 函数组件：useEffect（layout 或 passive 视需求）。
- 依赖旧值的一律函数式更新，避免闭包与批处理导致的“读旧值”。

#### 更细：enqueueSetState 与队列数据结构（逻辑图解）

思路：setState 只是“往队列里塞一个更新”，真正的“计算新 state”发生在 render 阶段；队列既要“保序”又要“可跳过低优先级”。

1. 类组件的 updateQueue（简化）

数据结构：

```ts
type Update<T> = {
  lane: Lane
  tag: UpdateState | ReplaceState | ForceUpdate | CaptureUpdate
  payload: Partial<T> | ((prev: T, props: Props) => Partial<T>)
  callback?: () => void
  next: Update<T> | null
}

type UpdateQueue<T> = {
  baseState: T                      // 上一次提交后作为基准的状态
  firstBaseUpdate: Update<T> | null // 基准队列头（低优先级残留/未处理）
  lastBaseUpdate: Update<T> | null
  shared: { pending: Update<T> | null } // 新入队的“环形链表”头指针
  effects: Array<Update<T>> | null  // 携带回调的更新，commit 后执行
}
```

核心：shared.pending 是“环形单链表”。新 update 挂到这个环上，形如 a→b→c→a。

enqueueUpdate（逻辑伪码）：

```ts
function enqueueUpdate<T>(queue: UpdateQueue<T>, update: Update<T>) {
  const pending = queue.shared.pending
  if (pending === null) {
    // 首个入队，自己指向自己，形成单元素环
    update.next = update
  } else {
    // 插入到环的尾部：pending 是尾，pending.next 是头
    update.next = pending.next
    pending.next = update
  }
  // 令 pending 指向“最新的尾”，便于下次 O(1) 追加
  queue.shared.pending = update
}
```

processUpdateQueue（渲染时“展开环”+ 与 baseQueue 合并）：

```ts
function processUpdateQueue<T>(queue: UpdateQueue<T>, props: Props, renderLanes: Lanes) {
  // 1. 取出 shared.pending 环，断开成线性链表 [firstPending..lastPending]
  const pending = queue.shared.pending
  if (pending !== null) {
    queue.shared.pending = null
    const lastPending = pending
    const firstPending = lastPending.next!
    lastPending.next = null

    // 2. 与 base 队列（firstBaseUpdate..lastBaseUpdate）拼接，维持顺序
    if (queue.lastBaseUpdate === null) {
      queue.firstBaseUpdate = firstPending
    } else {
      queue.lastBaseUpdate.next = firstPending
    }
    queue.lastBaseUpdate = lastPending
  }

  // 3. 依次消费 base 队列，按优先级 lanes 选择
  let state = queue.baseState
  let newBaseFirst: Update<T> | null = null
  let newBaseLast: Update<T> | null = null
  let newBaseState: T = state // 若出现跳过，记录“下次的基准状态”

  for (let u = queue.firstBaseUpdate; u !== null; u = u.next) {
    if (!includesSomeLane(renderLanes, u.lane)) {
      // 本次渲染优先级不够：跳过，但要保留到下一次（构建新的 baseQueue）
      const clone = cloneUpdate(u)
      if (newBaseFirst === null) {
        newBaseFirst = clone
        newBaseState = state // 第一条被跳过的 update 之前的状态，留作下次 baseState
      } else {
        newBaseLast!.next = clone
      }
      newBaseLast = clone
      continue
    }
    // 命中优先级：计算新状态
    const payload = typeof u.payload === 'function' ? u.payload(state, props) : u.payload
    state = shallowMerge(state, payload)
    if (u.callback) (queue.effects ??= []).push(u)
  }

  // 4. 提交给 fiber：更新 baseState 与 baseQueue，为未来低优先级保留上下文
  queue.baseState = newBaseFirst === null ? state : newBaseState
  queue.firstBaseUpdate = newBaseFirst
  queue.lastBaseUpdate = newBaseLast
  return state
}
```

说明：
- newBaseState 代表“第一条被跳过的 update 之前的状态”，这是下一次渲染需要继续基于的基线；只有出现跳过时才会与 state 不同。

直觉图（类组件一次渲染前后）：

```
入队阶段：
  shared.pending:  a → b → c → a   （环）

渲染展开：
  head..tail:     a → b → c → null （断环）
  base 队列拼接： [firstBaseUpdate..lastBaseUpdate] + [a..c]

按 lanes 消费：
  命中优先级 → 计算并前进
  未命中 → clone 到新的 baseQueue，留待下次
```

2) hooks 的队列（useState/useReducer）

结构：每个 Hook 拥有 queue，queue.pending 同样是环；渲染时将 ring 展开并折叠为新值。与类队列不同的是，这里还维护 lastRenderedReducer/State 以支持 eager 计算和跳过调度。

dispatchSetState 关键路径（简化）：

```ts
function dispatchSetState(queue, action) {
  const lane = requestUpdateLane()
  const update = { lane, action, next: null }

  // 入环：与类组件相同的“尾插 + 自环”结构
  const pending = queue.pending
  if (pending === null) update.next = update
  else { update.next = pending.next; pending.next = update }
  queue.pending = update

  // eager：可基于 lastRenderedReducer 直接计算
  if (queue.lastRenderedReducer) {
    const eager = queue.lastRenderedReducer(queue.lastRenderedState, action)
    if (Object.is(eager, queue.lastRenderedState)) {
      // 值未变：可短路，避免 schedule（某些实现会直接返回）
    }
  }

  // 标记 lanes 并调度
  const root = markUpdateLaneFromFiberToRoot(fiber, lane)
  scheduleUpdateOnFiber(root, fiber, lane)
}
```

3) scheduleUpdateOnFiber 与 ensureRootIsScheduled（任务调度）

核心逻辑：

```ts
function scheduleUpdateOnFiber(root, fiber, lane) {
  markRootUpdated(root, lane)           // root.pendingLanes |= lane
  if (lane === SyncLane) {
    // 同步：尽快执行 performSyncWorkOnRoot
    ensureRootIsScheduled(root, ImmediateSchedulerPriority)
  } else {
    // 并发：根据 nextLanes 选择合适的 SchedulerPriority
    ensureRootIsScheduled(root)
  }
}

function ensureRootIsScheduled(root, maybePriority?) {
  const nextLanes = getNextLanes(root) // 结合挂起/过期/并发策略挑 lanes
  const priority = lanesToSchedulerPriority(nextLanes, maybePriority)
  // 用 Scheduler 注册回调：performConcurrentWorkOnRoot / performSyncWorkOnRoot
  scheduleCallback(priority, () => performWorkOnRoot(root, nextLanes))
}
```

理解要点：lanes 决定“何时渲染、能否打断”；环形 pending + baseQueue 决定“如何保序、如何跳过与保留未命中的更新”。

4. 逻辑思维总结（把源码映射成三句口诀）
- 入队是环：O(1) 追加、多生产者安全、易合并。
- 展环并合：渲染时把 pending 展开并与 baseQueue 合并，顺序无损。
- 选优先级：只处理命中的 lanes，跳过的克隆到 baseQueue，下一次继续，既响应又不丢更新。

## 4. useEffect/useLayoutEffect：被动 vs 布局副作用

effect Hook 记录在 Fiber 的 effect list 上，区分两类时机：

- useLayoutEffect：在 commit 的 layout 子阶段，同步执行 cleanup → create；会阻塞绘制，适合读写布局、同步 DOM。
- useEffect：在浏览器绘制后（宏/微任务后）异步调度执行 cleanup → create；不阻塞首帧，适合订阅、请求、日志。

依赖数组（deps）只是“跳变检测”：
- mount 时记录 deps；
- update 时浅比较旧 deps 与新 deps，决定是否打上 NeedToRun 的 flag；
- cleanup 在下一次该 effect 运行前或组件卸载时执行。

伪代码（高度抽象）：

```ts
MountDispatcher.useEffect = (create, deps) => {
  const hook = mountWorkInProgressHook()
  hook.memoizedState = { tag: Passive, create, destroy: undefined, deps }
  pushEffect(Passive | HasEffect, create, undefined, deps)
}

UpdateDispatcher.useEffect = (create, deps) => {
  const hook = updateWorkInProgressHook()
  const prev = hook.memoizedState
  const changed = depsChanged(prev.deps, deps)
  hook.memoizedState = { tag: Passive, create, destroy: prev.destroy, deps }
  pushEffect(Passive | (changed ? HasEffect : NoEffect), create, prev.destroy, deps)
}
```
### useEffect工作流

useEffect 属于“被动副作用（Passive Effect）”，在提交（commit）后、浏览器绘制之后异步执行。它的工作流可分为三段：渲染阶段记录 → 提交阶段打标与安排 → 异步冲洗（flush）执行 create/cleanup。

#### 1. 渲染阶段：记录 Hook 节点与 Effect

- 函数组件渲染走 renderWithHooks 路径，当前 Fiber 为函数组件时，维护一条 Hook 链（挂在 `fiber.memoizedState`）。
- useEffect 在挂载/更新时分别调用不同 dispatcher 实现：

```ts
// 挂载（精简抽象）
MountDispatcher.useEffect = (create, deps) => {
  const hook = mountWorkInProgressHook()
  // 在本函数组件上记录一个 effect 节点，并标记“需要运行”
  hook.memoizedState = pushEffect(Passive | HasEffect, create, undefined, deps)
}

// 更新（精简抽象）
UpdateDispatcher.useEffect = (create, deps) => {
  const hook = updateWorkInProgressHook()
  const prev = hook.memoizedState // 上次的 effect 记录
  const changed = depsChanged(prev.deps, deps) // 浅比较（同一引用或元素逐个 Object.is）
  // 更新记录；仅当依赖“变了”时，打上 HasEffect，表示需要在本次提交后运行
  hook.memoizedState = pushEffect(
    Passive | (changed ? HasEffect : NoEffect),
    create,
    prev.destroy,
    deps,
  )
}
```

要点：
- `pushEffect` 会把 effect 节点挂到“本函数组件的 effect 环形链表”上，并给 fiber 打上 `Passive` 标记（以及 `subtreeFlags` 聚合）。
- React 18 提交阶段以 `flags/subtreeFlags` 驱动遍历（不再维护整棵树的全局 effect 单链），但函数组件仍保有“本组件内的 effect 环”用于依次执行其 cleanup/create。

Effect 节点（抽象结构）：

```ts
type Effect = {
  tag: Passive | Layout | HasEffect | NoEffect
  create: () => void | (() => void)
  destroy: void | (() => void)
  deps: any[] | null
  next: Effect | null // 组件内的环形链
}
```

#### 2. 提交阶段：打标与安排被动 effect 刷新

渲染结束后，进入 `commitRoot`，按三子阶段执行：beforeMutation → mutation → layout。被动 effect 并不在这三步里同步执行，而是：

- 在 commit 末尾，如果根或某子树存在 `Passive` 标记，安排一次“被动 effect 冲洗任务”（通常通过 Scheduler 安排到绘制之后）。
- 在严格模式（开发）下，React 可能对 effect 做“额外的安装/卸载”以校验幂等性（双执行策略）。

抽象伪码：

```ts
function commitRoot(root) {
  // 1) beforeMutation hooks（类 getSnapshotBeforeUpdate 等）
  // 2) mutation：DOM 插入/更新/删除，ref 更新
  // 3) layout：useLayoutEffect cleanup→create，同步执行

  // 安排被动 effect 冲洗（异步）
  if (rootHasPassiveEffects) {
    scheduleCallback(NormalPriority, flushPassiveEffects)
  }
}
```

#### 3. 冲洗阶段：cleanup → create（异步执行）

被动 effect 的具体执行发生在 `flushPassiveEffects`：

```ts
function flushPassiveEffects() {
  // 对卸载/更新的 effect 先执行 destroy（如果上轮记录了）
  commitPassiveUnmountEffects(root)
  // 对“这次需要运行”的 effect（HasEffect），再执行 create，并把返回值记录为 destroy
  commitPassiveMountEffects(root)
}
```

执行顺序要点：
- 对同一组件/同一种 effect，始终是“先 cleanup 再 create”。
- 卸载组件时只会执行 cleanup，不会再调用 create。
- 由于 useEffect 安排在绘制之后运行，它不会阻塞首帧渲染，适合订阅、请求、日志等副作用。

#### 4. 与 useLayoutEffect 的对比

- useLayoutEffect 在 `commit` 的 layout 子阶段同步执行 cleanup→create，会阻塞绘制，适合依赖布局读写（测量、同步 DOM）的场景。
- useEffect 在绘制后异步执行，不适合做需要“先于用户可见”的 DOM 读写，否则可能出现闪烁。

#### 5. 依赖数组与变更判断

- `deps` 为 `[]`：仅在挂载时执行一次 create，卸载时执行一次 cleanup。
- `deps` 为 `null/undefined`：每次提交后都执行（因为视为“未知依赖”）。
- 一般更新：通过浅比较（依赖长度/元素逐个 `Object.is`）判断是否打 `HasEffect`。未变化则跳过 create/cleanup。

注意：依赖应“完整声明”，否则容易出现陈旧闭包。若确需稳定引用，可用 ref 持有最新值，或用 memo/callback 稳定化依赖。 

#### 6. 并发与可中断渲染的影响

- 渲染阶段可能被打断/回放，但只有“被提交的那一版”会进入 commit，并据此安排/执行 effect。未提交的中间版本 effect 不会运行。
- 被动 effect 的执行被统一调度到 commit 之后，因此不会与渲染阶段交错，避免出现“在未提交 UI 上运行副作用”的问题。

#### 7. 开发模式下的严格效果（StrictEffects）

- 在并发根 + StrictMode 下，React 可能对 effect 进行“额外一次的卸载→重建”，帮助发现不对称副作用与资源泄漏。生产环境不受此影响。

#### 8. 端到端流程（速记）

```
renderWithHooks（函数组件）
  ↳ useEffect：pushEffect(Passive[|HasEffect]) 记录 effect，fiber 打 Passive 标记
commitRoot
  ↳ layout：同步执行 useLayoutEffect cleanup→create
  ↳ 安排 flushPassiveEffects（绘制后）
flushPassiveEffects（异步）
  ↳ 先 unmount：对需要清理的 effect 执行 destroy
  ↳ 再 mount/update：对标记 HasEffect 的 effect 执行 create，并把返回函数记录为 destroy
```

#### 9. 实战建议

- DOM 测量/同步布局应使用 useLayoutEffect；订阅/请求/日志等用 useEffect。
- 依赖数组必须完整；需要稳定引用时用 ref/memo/callback 辅助。
- cleanup 要对称、可重入，严格模式下的“多次安装/卸载”不应破坏语义。
- 不要在 effect 里直接读写影响渲染的 state 而不加依赖；若依赖很多且稳定性差，考虑把“易变数据”镜像到 ref。

### React 18：用 flags/subtreeFlags + 阶段掩码 替代全局 effectList

React 17 以前提交阶段依赖“全局 effectList（firstEffect/lastEffect 单链）”串联整棵树的副作用；React 18 移除了这套列表，改为：

- 在渲染阶段（completeWork）把每个 fiber 的 `flags` 自底向上 OR 聚合到 `subtreeFlags`；
- 在提交阶段按阶段掩码（MutationMask、LayoutMask、PassiveMask）对整棵树做一次 DFS 遍历；
- 以节点的 `flags` 命中该阶段掩码决定是否在该阶段执行对应副作用；以 `subtreeFlags` 做剪枝，子树若无该阶段标记则整棵跳过。

这使得提交无需维护跨组件的“全局 effect 单链”，更适配并发、优先级 lanes、Suspense/Offscreen 与选择性水合。

#### 渲染阶段：聚合 subtreeFlags（概念伪码）

```ts
function completeWork(current: Fiber | null, wip: Fiber) {
  // ...计算自身的更新 payload/标记
  let subtree = NoFlags
  let child = wip.child
  while (child) {
    subtree |= child.subtreeFlags | child.flags
    child = child.sibling
  }
  wip.subtreeFlags = subtree
}
```

说明：`flags` 表示“本节点的副作用”，`subtreeFlags` 是“子树聚合副作用”，两者配合提交阶段的掩码遍历。

#### 提交阶段：按阶段掩码遍历（概念伪码）

常见标记与掩码：
- 变更类：`Placement`、`Update`、`ChildDeletion`、`Ref`、`Visibility` …
- 掩码：`MutationMask`（DOM 变更）、`LayoutMask`（布局副作用）、`PassiveMask`（被动副作用调度）。

```ts
function commitMutationEffects(root: FiberRoot) {
  dfs(root.current.child, MutationMask, (fiber) => {
    if (fiber.flags & Placement) commitPlacement(fiber)
    if (fiber.flags & Update)    commitUpdate(fiber)
    if (fiber.flags & ChildDeletion) commitDeletion(fiber)
    if (fiber.flags & Ref)       commitAttachRef(fiber)
  })
}

function dfs(node: Fiber | null, mask: Flags, visitor: (f: Fiber) => void) {
  if (!node) return
  // 子树没有该阶段的任何标记，直接剪枝
  if ((node.subtreeFlags & mask) === NoFlags && (node.flags & mask) === NoFlags) return
  // 先深入子树（需要时）
  dfs(node.child, mask, visitor)
  // 处理自身
  if ((node.flags & mask) !== NoFlags) visitor(node)
  // 再处理兄弟
  dfs(node.sibling, mask, visitor)
}
```

布局阶段与被动阶段：
- `commitLayoutEffects(...)`：同步执行 `useLayoutEffect` 的 cleanup→create、类组件 DidMount/DidUpdate、ref 调整等。
- `PassiveMask` 命中表示需要安排被动副作用；在 `commitRoot` 末尾统一调度 `flushPassiveEffects`，在绘制之后异步执行。

#### 组件内的 effect 环如何配合

- 函数组件内仍维护“本组件的 effect 环（环形链表）”，由 `pushEffect` 在渲染阶段记录，存放于该组件的 Hook 链（`fiber.memoizedState`）中；
- 提交时：
  - `commitPassiveUnmountEffects` 先按环依次执行需要清理的 `destroy`；
  - `commitPassiveMountEffects` 再对打了 `HasEffect` 的 effect 依次执行 `create`，并记录其返回值为下一轮的 `destroy`；
- 这只是“组件内顺序”的保障结构，并非 React 17 时代的“全局 effectList”。

#### 为什么弃用全局 effectList（它如何妨碍运行）

- 合并成本高：completeWork 期间频繁拼接 first/lastEffect 指针，带来额外写屏障与缓存不友好；
- 与并发/可中断不相容：中断/回放导致列表需重建/合并，心智与实现复杂；
- 多优先级 lanes 复杂化：不同 lane 交错更新时的剪裁/合并容易出错；
- 与 Suspense/Offscreen/选择性水合耦合困难：跨边界维护全局单链易出 bug；
- Dev 严格效果（StrictEffects）下更脆弱：双安装/卸载放大了列表维护复杂度；
- 额外内存/字段：每个 fiber 的 first/lastEffect 字段在 18 中已移除。

#### 新方案优势

- O(1) 聚合 + O(n) 单次遍历，逻辑直接；
- 可剪枝，子树无标记直接跳过；
- 更适配并发/选择性水合/Offscreen，边界更清晰；
- 降低实现复杂度与 bug surface，性能更稳。

#### 源码锚点（按语义）
- 渲染：`completeWork` 聚合 `subtreeFlags`；
- 提交：`commitRoot` → `commitMutationEffects` / `commitLayoutEffects`；
- 被动：`flushPassiveEffects`、`commitPassiveUnmountEffects`、`commitPassiveMountEffects`；
- Hook：`renderWithHooks`、`pushEffect`、effect 环的记录与消费。

## 5. 规则与陷阱（与底层机制的对应）

- 只在顶层调用 Hook：顺序即身份，违反会导致“错位取钩子”。
- 依赖数组完整：effect 内引用外部变量时应声明依赖；不想重建监听可用 `ref` 镜像最新值（见“陈旧闭包”段）。
- 函数式更新优先：多次连续更新依赖“上一次状态”时，使用 `setX(prev => ...)`，避免闭包陈旧。
- StrictMode 双执行（开发）：被动 effect 会经历额外的 cleanup → create，帮助发现不对称副作用；生产不受影响。
- SSR 注意 useLayoutEffect 警告：在服务端无 DOM，需条件化为客户端再执行或使用适配的 `useIsomorphicLayoutEffect`。
- useRef 身份稳定但不会触发渲染：适合保存外部实例/最新值缓存；不要用作 UI 的长期来源。
- useMemo/useCallback：在依赖稳定时复用上一次 memoized 值/函数引用，底层只是记录 `memoizedState` 与 `deps` 并做浅比较，不是自动性能魔法（谨慎使用在真热路径）。

## 6. 与调度（lanes）和并发的协作

- setState 产生的更新带有优先级 lane；高优先级（如用户输入）可以打断低优先级渲染；
- `startTransition` 将其中的更新标记为“过渡”（低优先级），以优先保持交互流畅；
- `useDeferredValue` 延迟昂贵派生，使 UI 先用旧值保持响应，后续再用新值更新。

开发者实践：
- 大量/昂贵渲染 → 虚拟化、切片计算、memo 化；
- 输入联动 → 把非紧急计算包进 `startTransition`；
- 派生数据 → `useMemo` 只在成本高且依赖稳定时使用。

## 7. 一句话总览

Hooks = “Fiber 上的 Hook 节点链 + 按顺序消费的 dispatcher 策略 + 提交阶段的副作用执行”。
它让函数组件在保持“纯渲染”的同时获得状态与副作用能力，又与并发/优先级调度天然贴合；
遵守“顶层调用/依赖声明/函数式更新”的规则，就能在性能与可维护性之间取得良好平衡。

## Hooks是如何升级react的工作模式的？
1. 告别了难以理解的类式组件
2. 解决业务逻辑难以拆分的问题
3. 使得状态逻辑的复用变得简单可行
4. 函数组件更符合react的设计理念