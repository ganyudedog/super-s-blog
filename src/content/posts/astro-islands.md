---
title: 把交互留在恰当的位置
published: 2026-07-18
description: 在 Astro Islands 中拆分静态内容、动画状态和需要持续运行的图形场景。
category: Frontend
tags: [Astro, Islands, Architecture]
draft: false
---

博客的大部分内容天然适合在构建时生成。只有真正依赖浏览器状态的部分，才需要进入客户端运行。

## 边界比框架更重要

本站让 Astro 负责页面、路由和文章内容，React 岛只承载 Three.js 场景。导航与文章列表保持为静态 HTML，开屏时间线则由一个很小的脚本统一协调。

这种拆分降低了常驻脚本的体积，也让后续文章页面不必继承首页动画的复杂度。
