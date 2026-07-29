---
title: React Router 的路由机制与通用前端路由方案
published: 2025-10-15
description: 对前端路由的探讨以及对react router的学习
category: Notes
tags: [frondend, typescript, react]
draft: false
---

> 本文先描述 React Router 提供的前端路由解决机制，再在此基础上抽象出“通用的前端路由方案”，便于迁移到任意框架或自研路由器时使用。

## 为什么需要前端路由？
使浏览器 URL 状态（`location`）与视图状态（`state`）分离，便于复用、分享、记录历史，因为若没有路由，一旦刷新，服务器并不知道进行到了哪一步，所以需要重复之前的操作才能进入刷新前的页面，有了路由，就很方便记录用户到底访问了哪个页面。

## 一、React Router 提供的前端路由机制

React Router（以 v6.4+ 为例）围绕“URL → 视图”的单向映射，提供了两大类能力：导航与匹配（UI 路由）以及与数据耦合的“数据路由”。

1) 路由载体（History 实现）
- `BrowserRouter`：使用 HTML5 History API（`pushState/replaceState` + `popstate`）。URL 无 `#`，需服务器做“兜底回退到 index.html”。
- `HashRouter`：使用 URL 片段（`#`）作为路径段（`location.hash`）。适合静态托管/老环境，无需服务端改写。
- `MemoryRouter`：内存中的路由栈，不读写真实 URL。适用于单测、React Native、Electron 子窗口等。

2) 路由描述与匹配
- JSX/声明式：`<Routes><Route path="/" element={<Home/>} /><Route path=":id" element={<Detail/>}/></Routes>`；嵌套路由 + `<Outlet />` 复用布局。
- 配置式 & 数据路由：`createBrowserRouter([{ path: '/', element: <Root />, children: [...] }])`；支持 loader/action、errorElement、lazy 等。
- 匹配规则：基于层级的“最佳匹配”，支持动态段（`:id`）、通配（`*`）、可选段（通过两个分支显式声明）。

3) 导航与链接
- 组件：`<Link to="/users/1" />`、`<NavLink>`（激活态高亮）。
- Hook：`useNavigate()`（`navigate('/x', { replace, state })`）、`useLocation()`、`useParams()`、`useSearchParams()`。
- 滚动与状态：可通过 `replace` 控制历史、通过 `state` 传递非 URL 状态，配合自定义滚动还原（或 v6 提供的 `<ScrollRestoration/>` in data routers）。

4) 数据路由（v6.4+ 的核心增量）
- `loader`：在导航前/并发渲染中获取数据，可与路由取消（abortion）对齐；产物通过 `useLoaderData()` 消费。
- `action`：处理表单提交/命令式提交（`fetcher`），与资源变更绑定，返回重定向/错误。
- 错误边界：每条路由可声明 `errorElement`，在 loader/action 抛错时就地兜底。
- 延迟与并发：`defer()` 进行“部分就绪”渲染，优先首屏可见，尾部异步占位。

5) 性能与工程配套
- 懒加载：`lazy(() => import('./Page'))` 或数据路由的 `lazy` 字段分片加载。
- 代码拆分：按路由切片，结合 bundler 动态导入；避免把全站逻辑一次性加载。
- 路由级布局：父 `<Route element={<Layout/>}>` + 子 `<Outlet/>`，实现布局复用与按路由切换内容。

6) 典型最小示例
```tsx
// BrowserRouter + 嵌套路由
import { BrowserRouter, Routes, Route, Outlet, Link } from 'react-router-dom'

function Layout() {
	return (
		<div>
			<nav>
				<Link to="/">Home</Link> | <Link to="/users/42">User</Link>
			</nav>
			<Outlet />
		</div>
	)
}

function App() {
	return (
		<BrowserRouter>
			<Routes>
				<Route element={<Layout />}> 
					<Route index element={<div>Home</div>} />
					<Route path="users/:id" element={<div>User</div>} />
					<Route path="*" element={<div>Not Found</div>} />
				</Route>
			</Routes>
		</BrowserRouter>
	)
}
```

```ts
// 数据路由 + loader/action
import { createBrowserRouter, RouterProvider } from 'react-router-dom'

const router = createBrowserRouter([
	{
		path: '/',
		element: <Root/>,
		errorElement: <ErrorBoundary/>,
		children: [
			{
				index: true,
				loader: async () => fetch('/api/home').then(r => r.json()),
				element: <Home/>,
			},
			{
				path: 'users/:id',
				loader: async ({ params }) => fetch(`/api/users/${params.id}`).then(r => r.json()),
				action: async ({ request }) => fetch('/api/users', { method: 'POST', body: await request.formData() }),
				element: <User/>,
			},
		],
	},
])

export default function App() { return <RouterProvider router={router}/> }
```

小结：React Router 用 “History + 匹配 + 导航 +（可选）数据耦合 + 懒加载/边界” 组成完整前端路由栈，覆盖大多数 SPA 需求。

## 二、基于此提炼的通用前端路由方案

无论是否使用 React Router，一个健壮的前端路由都应包含以下“通用构件”和“工程策略”。

1) 核心构件（必须）
- URL 作为真相来源：路径段、查询串、hash 三部分映射到“页面/视图状态”。
- History 抽象：提供 `push(url, state?)`、`replace(url, state?)`、`listen(fn)`、`back/forward`，并处理 `popstate/hashchange`。
- 路由匹配器：支持静态、动态段（`:id`）、通配符（`*`）、优先级/最长匹配与嵌套合并；输出 `params`、`matched route tree`。
- 视图渲染器：根据匹配结果渲染对应组件（或模板），支持嵌套布局占位（等价于 `<Outlet/>`）。
- 导航 API：声明式链接 + 命令式跳转（push/replace）；支持携带 `state`、控制滚动还原。

2) 数据协作（强烈建议）
- 路由感知的数据获取：在导航决策点触发数据请求（路由进入前/并发阶段），支持取消与错误边界。
- 提交/变更：将表单提交与路由 action 解耦 UI，返回重定向/错误并统一处理。
- 渐进加载：允许部分就绪（skeleton/placeholder），提高首屏与过渡体验。

3) 可用性与可靠性
- 404/错误边界：未匹配或数据错误时就地兜底。
- 权限与守卫：在进入前（canActivate）/离开前（canDeactivate）拦截，统一跳转登录/无权页。
- 滚动与焦点管理：按页面/锚点恢复滚动；导航后将焦点置于主区域以提升可访问性（a11y）。

4) 工程与性能
- 代码分割：按路由切片，懒加载页面与数据模块；避免巨包。
- 预取策略：对可预测的下一跳进行 `prefetch`（脚本/数据），结合 `IntersectionObserver` 实现“所见即预取”。
- 基础设施：静态托管需配置回退到入口（Browser 路由）；老环境/纯静态可使用 Hash 路由。

5) 通用最小实现（伪码，基于 History API）
```ts
type Route = { path: string; component: (params) => void }
const routes: Route[] = [...]

function match(pathname: string) {
	// 返回 { route, params }，支持 :id 与 * 的简单匹配
}

function render() {
	const { pathname } = window.location
	const m = match(pathname)
	if (!m) return document.body.textContent = 'Not Found'
	m.route.component(m.params)
}

export function navigate(to: string, { replace = false, state }: { replace?: boolean; state?: any } = {}) {
	replace ? history.replaceState(state, '', to) : history.pushState(state, '', to)
	render()
}

window.addEventListener('popstate', render)
render()
```

6) 选型建议
- 有服务端改写能力：优先 History（无 hash，美观，可共享完整 URL）。
- 纯静态/老 CDN：使用 HashRouter，规避 404 与改写需求。
- 需要“路由即数据层”的：采用 React Router 数据路由或 Next.js/Remix 等带服务端整合的框架。

7) 实践清单（Checklist）
- 路由表结构：是否支持嵌套与布局复用？
- 导航与还原：push/replace/回退、滚动与焦点策略齐全吗？
- 错误与边界：404、加载错误、提交错误各自的兜底？
- 权限体系：进入/离开守卫、白名单与重定向策略？
- 性能：路由切片、懒加载、预取、骨架屏是否就位？
- 部署：Browser 模式是否配置了回退规则？Hash 模式是否满足 SEO 诉求？