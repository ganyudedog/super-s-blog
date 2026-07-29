---
title: Redux 设计思想与工作原理
published: 2025-10-25
description: 对redux设计理念以及如何开发其拓展的学习
category: Notes
tags: [frondend, typescript, react]
draft: false
---

> 以经典 `redux` 包实现为基础（4.x/5.x），从 MVC 缺陷 → Flux 思想 → Redux 的极简实现，来理解它为什么这么设计、底层是怎么跑起来的。

## 1. 背景：MVC 在前端大型应用中的问题

传统 MVC（甚至 MVVM）在前端中常见几个痛点：

- **状态分散**：
	- 组件内部 `setState`、各种 store、全局变量、URL、localStorage……到处都是“真相来源”。
	- 很难回答：当前这个 bug 是因为谁改了 state？

- **数据流向复杂（双向绑定 / 事件网）**：
	- View 改 Model，Model 改 View，多个 View 之间互相监听，形成“事件网”；
	- 当应用变大时，经常出现：改了一个地方，另一个不相关的地方也变了，很难定位。

- **副作用杂糅在各层中**：
	- Controller / View / Model 内部到处发 AJAX、改缓存、操作 DOM；
	- 测试困难、复用困难、回放困难。

简单说：**状态没有统一源头、变更路径不透明、数据流不够可预测**，对调试/重构/时间旅行都不友好。

## 2. Flux 架构：单向数据流的过渡方案

Flux 是 Facebook 提出的一种架构思想，不是具体的库，其核心是：

- **单向数据流**：
	1. View 触发 Action（用户操作 → `dispatch(action)`）。
	2. Dispatcher 把 Action 广播给所有 Store。
	3. Store 根据 Action 更新内部状态并触发变更事件。
	4. View 监听 Store 变化，重新渲染。

- **每个 Store 管理一类数据**：
	- 比如 `UserStore`、`TodoStore` 等。

优势：

- 拆掉了双向绑定，数据“只往一个方向流动”；
- 状态集中在若干 Store中，可观察性比 MVC 更好。

问题：

- Dispatcher 和多个 Store 的关系仍然较复杂；
- Store 内部可以随意修改状态、副作用依然杂糅；
- 没有一个**统一的、可序列化的全局 state**，不利于 time-travel 和 DevTools；

> Redux 可以被看作 Flux 的一种“极度简化版 + 函数式化”实现：去掉 Dispatcher、多 Store 概念，只有一个 Store + 纯函数 Reducer + 可组合的中间件。

## 3. Redux 的三大设计原则

Redux 官方的三大原则本质上是对 MVC/Flux 问题的回应：

1. **单一数据源（Single Source of Truth）**
	- 整个应用的 state 被存储在一棵对象树中，并且这棵树只存在于一个单一的 store 里。
	- 方便：
		- 调试：随时打印一份 state；
		- 持久化：整棵树序列化；
		- time-travel：记录 state 序列或 action 序列。

2. **state 是只读的（State is read-only）**
	- 唯一改变 state 的方式是**发起一个 action**，它是一个描述发生了什么的普通对象（`type + payload`）。
	- 任何 UI / 网络请求 / 其他逻辑，都不能直接改 state，只能 dispatch。
	- 好处：
		- 所有变更都有“名字”和“时间点”，可记录、可回放；
		- 可以集中在一条管道上做日志、权限检查、节流等（中间件）。

3. **使用纯函数来执行修改（Changes are made with pure functions）**
	- 使用 reducer 将旧 state 和 action 映射到新 state：`(state, action) => newState`。
	- reducer 必须是纯函数：
		- 不修改传入的 state（不可变）；
		- 不产生副作用（不发请求、不改 DOM、不用随机数/时间）；
		- 同样输入 → 同样输出。
	- 好处：
		- 易测试：给定输入 state + action，看输出；
		- 易回放：DevTools 可以重放 action 序列得到每一帧 state；
		- 易优化：依赖 `===` 来做浅比较，配合 React 进行性能优化。

## 4. 核心 API 与内部数据结构

Redux 核心其实就一个 `createStore`（加上 `combineReducers`、`applyMiddleware` 作为辅助），体积很小。

典型 store 结构（简化伪代码）：

```ts
type Listener = () => void
type Unsubscribe = () => void

function createStore(reducer, preloadedState?, enhancer?) {
	// 兼容两种签名：
	// 1) createStore(reducer, enhancer)
	// 2) createStore(reducer, preloadedState, enhancer)
	if (typeof preloadedState === 'function' && typeof enhancer === 'undefined') {
		enhancer = preloadedState
		preloadedState = undefined
	}
	if (typeof enhancer !== 'undefined') {
		if (typeof enhancer ！== 'function') {
			throw new Error('Expected the enhancer to be a function.')
		}
		return enhancer(createStore)(reducer, preloadedState)
	}

	let currentReducer = reducer
	let currentState = preloadedState
	let currentListeners: Listener[] = []
	let nextListeners = currentListeners
	let isDispatching = false

	function ensureCanMutateNextListeners() {
		// 避免在遍历 listeners 时原地修改数组，做一次复制
		if (nextListeners === currentListeners) {
			nextListeners = currentListeners.slice()
		}
	}

	function getState() {
		return currentState
	}

	function subscribe(listener: Listener): Unsubscribe {
		if (typeof listener !== 'function') {
			throw new Error('Expected listener to be a function.')
		}
		let isSubscribed = true
		ensureCanMutateNextListeners()
		nextListeners.push(listener)

		return function unsubscribe() {
			if (!isSubscribed) return
			isSubscribed = false
			// 避免在监听函数中修改 currentListeners，从而导致循环错误
			ensureCanMutateNextListeners()
			const index = nextListeners.indexOf(listener)
			nextListeners.splice(index, 1)
		}
	}

	function dispatch(action) {
		// 限制：必须是 plain object 且必须有 type
		if (!isPlainObject(action)) {
			throw new Error('Actions must be plain objects.')
		}
		if (typeof action.type === 'undefined') {
			throw new Error('Actions must have a type.')
		}
		// 防止 reducer 内部再次 dispatch，打破“单次更新”的假设
		if (isDispatching) {
			throw new Error('Reducers may not dispatch actions.')
		}

		try {
			isDispatching = true
			currentState = currentReducer(currentState, action)
		} finally {
			isDispatching = false
		}

		// 通知所有订阅者
		const listeners = (currentListeners = nextListeners)
		for (let i = 0; i < listeners.length; i++) {
			const listener = listeners[i]
			listener()
		}

		return action
	}

	// 初始化：触发一次特殊 action，拿到默认 state
	dispatch({ type: '@@redux/INIT' })

	return {
		getState,
		dispatch,
		subscribe,
		replaceReducer(nextReducer) {
			currentReducer = nextReducer
			// 触发一次重算
			dispatch({ type: '@@redux/REPLACE' })
		},
	}
}
```

从这段伪代码可以看出：

- store 的职责极其简单：
	- 存当前 `state` + 当前 `reducer`；
	- 管一组订阅者 `listeners`；
	- 提供 `getState/dispatch/subscribe/replaceReducer`。
- 所有“业务逻辑”和“状态如何变化”都不写在 store 里，而写在 reducer 里。

这与 MVC/Flux 的差异：**Store 不再是一个“带方法的对象模型”，而是一个“被纯函数描述的状态容器 + 通知器”。**

## 5. combineReducers：把多个领域 reducer 拼成一棵 state 树

`combineReducers` 做的事情是：

- 接收一个 `{ key: reducer }` 的对象；
- 返回一个新的 `rootReducer(state, action)`；
- 每次 dispatch 时，rootReducer 会：
	- 把 `state[key]` 交给对应的 `reducers[key]`；
	- 收集各个子 reducer 返回的新片段，合成新的整体 state。

核心实现（简化）：

```ts
function combineReducers(reducers) {
	const reducerKeys = Object.keys(reducers)

	return function combination(state = {}, action) {
		let hasChanged = false
		const nextState: Record<string, any> = {}

		for (const key of reducerKeys) {
			const reducerForKey = reducers[key]
			const previousStateForKey = state[key]
			const nextStateForKey = reducerForKey(previousStateForKey, action)
			nextState[key] = nextStateForKey
			if (nextStateForKey !== previousStateForKey) {
				hasChanged = true
			}
		}

		return hasChanged ? nextState : state
	}
}
```

设计要点：

- 每个 reducer 只关心自己那块 state，遵守“纯函数 + 不可变”的规则；
- `combineReducers` 用浅比较判断是否有任何 slice 改变，从而决定是否返回同一个 state 引用；
- 为上层（React）提供一个天然的 `===` 检测点，方便 `useSelector` / `connect` 做性能优化。

## 6. 工作流：一次 dispatch 的完整生命周期

以一个简单例子说明：

```ts
const rootReducer = combineReducers({
	counter: counterReducer,
	todos: todosReducer,
})

const store = createStore(rootReducer)

store.subscribe(() => {
	console.log('state changed:', store.getState())
})

store.dispatch({ type: 'counter/increment', payload: 1 })
```

**阶段 1：初始化**

- `createStore(rootReducer)` 内部执行：
	- `currentReducer = rootReducer`；
	- `currentState = undefined`；
	- 调用 `dispatch({ type: '@@redux/INIT' })`；
	- `rootReducer(undefined, INIT)` 会：
		- 依次调用各子 reducer：`counterReducer(undefined, INIT)` / `todosReducer(undefined, INIT)`；
		- 每个 reducer 返回自己的默认初始 state；
		- 合成一棵完整的 state 树。

**阶段 2：订阅**

- `store.subscribe(listener)`：
	- 把 listener 加入 `listeners` 数组；
	- 返回一个 `unsubscribe` 函数。

React 生态里，`react-redux` 做的事情本质就是在内部订阅 store，然后在 listener 中触发组件更新。

**阶段 3：dispatch(action)**

当调用 `store.dispatch({ type: 'counter/increment', payload: 1 })` 时：

1. `dispatch` 校验 action 形状：必须是 plain object 且有 `type`。
2. 设置 `isDispatching = true`，防止 reducer 内部再次 dispatch。
3. 调用 `currentReducer(currentState, action)`：
	- 即 `rootReducer(state, action)`；
	- rootReducer 内部用 `combineReducers` 的逻辑：
		- `next.counter = counterReducer(state.counter, action)`；
		- `next.todos = todosReducer(state.todos, action)`；
		- 收集成 `nextState`。
4. 把 `currentState` 更新为 `nextState`。
5. 重置 `isDispatching = false`。
6. 遍历 `listeners`，依次调用 listener()。


如果配合 React：

- 监听函数里会执行类似 `forceUpdate` 或 `setState`，组件重新 render，读到的新 state，完成一次 UI 更新。

**这条链路背后的思想**：

- 所有状态变更都穿过 `dispatch` → reducer → state；
- 没有“偷偷改变 state 的捷径”；
- 同一个 action 对所有 reducer 广播，类似 Flux 的 Dispatcher，但实现极其简单（根 reducer 即 Dispatcher）。

## 7. 中间件：在不修改内核的前提下扩展 dispatch(面向切面编程AOP)

由于redux中只有同步操作，无法进行异步操作，如果需要进行异步操作，就可以使用中间件

Redux 为了把日志、异步、路由等能力抽出去，设计了 `applyMiddleware`：

### 7.1 middleware 的签名

```ts
const middleware = storeAPI => next => action => {
	// 前置逻辑
	const result = next(action)
	// 后置逻辑
	return result
}
```

三层柯里化：

1. 第一层拿到 `storeAPI`（`{ getState, dispatch }`）用于读 state 或发新 action；
2. 第二层拿到“下一个 dispatch”`next`；
3. 第三层处理每一个 action，可以选择：
	- 直接丢给 `next(action)`；
	- 拦截/修改 action；
	- 决定不往下传（中断）；
	- 在前后做日志、埋点、权限检查等。

### 7.2 applyMiddleware 的核心思路

简化伪代码：

```ts
function applyMiddleware(...middlewares) {
	return (createStore) => (reducer, preloadedState) => {
		const store = createStore(reducer, preloadedState)
		let dispatch = () => {
			throw new Error('Dispatching while constructing middleware is not allowed.')
		}

		const middlewareAPI = {
			getState: store.getState,
			dispatch: (action) => dispatch(action),
		}

		// 这里可以喂出一个缺少next参数的函数，等dispatch被调用并传入action时，就参数齐了
		const chain = middlewares.map((mw) => mw(middlewareAPI))

		// compose(f3, f2, f1)(store.dispatch) = f3(f2(f1(store.dispatch))) 解释下面，这里就可以截取dispatch处理action的逻辑
		dispatch = compose(...chain)(store.dispatch)

		return {
			...store,
			dispatch,
		}
	}
}
```

这实现了一个**洋葱模型**：

- 最内层是原始 `store.dispatch`；
- 每个 middleware 在外面包一层；
- 最外层的 dispatch 是你在业务中实际调用的；
- 这样可以在不修改 core 的情况下，实现：
	- 日志（`redux-logger`）
	- 异步（`redux-thunk` / `redux-saga` / `redux-observable`）
	- 权限、埋点、错误捕获等。

### 7.3 示例：redux-thunk 的核心

```ts
const thunk = ({ dispatch, getState }) => next => action => {
	if (typeof action === 'function') {
		// 把函数当作 thunk 处理
		return action(dispatch, getState)
	}
	// 否则正常丢给下一个中间件 / 原始 dispatch
	return next(action)
}
```

设计思想：

- 核心 `dispatch` 仍然只接受 plain object；
- 通过中间件扩展“上层 dispatch API”，支持 `dispatch(fn)` 这种语法；
- 异步、复杂副作用逻辑全部写在 thunk 函数里，store 本身完全无感知。

这比传统 MVC/Flux 里“Store 内部随便写副作用”清晰得多：

- 副作用集中在中间件/额外层；
- reducer 保持纯净；
- 整体数据流和副作用路径清晰、可测试。

## 8. 与 MVC / Flux 的对比总结

**对 MVC 的修正**：

- MVC：多个模型、控制器、视图之间存在复杂交互，状态分散，数据流可逆。
- Redux：
	- 所有状态集中在单一 store；
	- 更新只能通过 `dispatch(action)` → reducer；
	- View 只是订阅 state 的消费者，不能直接修改 state。

**对 Flux 的简化与函数式化**：

- Flux：Dispatcher + 多个 Store + Action。
- Redux：
	- 去掉 Dispatcher 概念，`rootReducer` + `dispatch` 本身就是一种“广播 + 聚合”；
	- 把 Store 简化成“state 容器 + 订阅机制”，不再在 Store 中写业务方法；
	- 引入纯函数 reducer + 不可变 state，使得 time-travel / DevTools / 测试变得简单。

**整体设计哲学**：

- 小核心，大生态：
	- 内核只做：保存 state、调用 reducer、通知订阅者；
	- 异步、副作用、日志、路由全部通过中间件和 enhancer 实现。

- 单向数据流 + 明确的变更入口：
	- 所有状态变更都可以追溯到某个 `action`；
	- 没有“偷偷修改”的地方，利于调试和团队协作。

- 强调可预测性与可观察性：
	- 纯函数 reducer 保证输入输出可预测；
	- 配合 DevTools 可以进行 time-travel、回滚、快照对比。

> 一句话记：Redux 就是“用纯函数和单向数据流重写了 Flux，把 Store 简化成一个可订阅的状态容器，并通过中间件机制把副作用、异步和日志等能力从核心剥离出去”，从而解决了 MVC 时代状态分散、数据流混乱、变更不可预测的问题。