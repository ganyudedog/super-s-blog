---
title: 对于yjs的学习以及理解
published: 2026-03-16
description: yjs的学习
category: Notes
tags: [frontend,crdt,typescript,network]
draft: true
---

# Yjs 源码学习笔记

## 1. Y.Doc：每个客户端的一份本地副本

Yjs 的协作模型不是让多个客户端共享同一个内存中的 `Y.Doc`，而是让每个参与者维护自己的 `Y.Doc` 副本：

```text
Alice: Y.Doc A  <->  provider / network  <->  Bob: Y.Doc B
```

每个副本都维护文档的本地 CRDT 状态。客户端之间交换的是编码后的 update，而不是对方进程里的对象引用。接收到 update 后，本地解码出新的 `Item`，再把它接入本地的结构和共享类型。

CRDT 的合并规则是确定性的，因此 update 可以重复接收，也可以乱序到达。服务器（如果使用）通常负责转发、发现、持久化或补发 update，不负责裁决最终顺序；也可以使用 WebRTC 等方式进行点对点同步。

## 2. documentID 与副本关联

`documentID` 通常由同步 provider 使用，用来把加入同一个 room 的多个 `Y.Doc` 关联起来。它回答的是：

```text
哪些副本属于同一份协作文档？
```

它和 `clientID` 是不同概念：

```text
documentID / room：协作空间的标识
clientID：某个副本创建的 struct 属于哪个客户端
```

要修改其他人的文档，正常做法是创建并使用自己的 `Y.Doc`，连接同一个 room，等待 provider 将远端状态应用到本地，然后在自己的副本上修改。修改产生的 update 再由 provider 广播给其他副本。不应该直接使用其他客户端的 `Y.Doc` 内存对象。

## 3. clientID 与 clock

每个 `Y.Doc` 会生成自己的随机 `clientID`。同一个 `Y.Doc` 创建的结构使用同一个 clientID；不同的副本使用各自的 clientID。客户端不需要预先登记：收到 update 时，update 中携带的 clientID 会使接收端知道这个客户端的结构存在。

一个 Yjs 结构的 ID 是：

```text
(clientID, clock)
```

`clock` 是该 client 自己的单调递增逻辑序列号，不是现实时间，也不是全局版本号。例如 `(B, 10)` 表示 client B 的结构序列中从 clock 10 开始的位置。一个长度大于 1 的 `Item` 可以覆盖连续的多个 clock。

因此，`clock` 的作用有两个：

1. 唯一定位某个客户端创建的 struct。
2. 判断接收端是否已经连续拥有该客户端的前置结构。

如果本地对 client B 的 state 是 `11`，通常表示已经拥有 B 的 clock `0..10`，下一个连续位置是 `11`。依赖 clock `10` 已经存在；依赖 clock `13` 则说明本地缺少相关结构。这里不是判断数据“过期”，而是在判断因果前置是否已经到达。update 可能只是乱序到达，并不一定需要向服务器拉取“最新版本”。

## 4. update 到达后的 Item

远程 update 解码后，接收端会创建一个新的 `Item` 实例。这个实例就是 `Item.getMissing` 和 `Item.integrate` 中的 `this`：

```text
远程 update
    ↓ 解码
接收端的新 Item（尚未接入链表）
    ↓ getMissing
解析依赖并检查缺失
    ↓ integrate
接入本地文档
```

远端对象和本地对象的内存地址当然不同。它们通过稳定的逻辑 ID `(clientID, clock)` 相互定位。`getItem(store, id)` 会在本地 `StructStore` 中按 clientID 和 clock 找到对应的本地 struct。

## 5. getMissing：检查因果依赖并解析锚点

`getMissing` 的注释是“返回缺失操作的创建 clientID，或者定义缺失的 items 并返回 null”。它的返回值含义是：

```text
返回 clientID：当前 Item 依赖的结构还不存在，暂缓集成
返回 null：依赖已齐，可以继续调用 integrate
```

它先检查 `origin`、`rightOrigin` 和以 ID 表示的 `parent`。例如：

```js
this.origin.client !== this.id.client &&
this.origin.clock >= getState(store, this.origin.client)
```

这里的 `client !==` 不是检查“远端是否修改过”，而是因为当前 Item 自己所属 client 的前序 clock 已由外层的连续性检查处理；跨 client 的依赖则必须在这里确认。

确认依赖存在后，Yjs 才把编码态的 ID 解析成运行态引用：

```js
this.left = getItemCleanEnd(transaction, store, this.origin)
this.right = getItemCleanStart(transaction, this.rightOrigin)
```

`left/right` 可能是 `null`，因为 `origin = null` 表示原始位置在容器开头，`rightOrigin = null` 表示原始位置在容器末尾。它们只是原始插入意图的边界，不保证此刻仍然互相直接相邻。

如果锚点已经是 `GC`，说明历史位置只能保留为垃圾回收结构，无法恢复为正常的共享类型位置，`getMissing` 会将 `parent` 置为 `null`。后续 `integrate` 会把当前 Item 记录为 `GC`，而不是把它重新显示到文档中。

## 6. integrate：确定最终位置并接入链表

`integrate(transaction, offset)` 的职责不是把多个旧 Item 合并成一个大 Item，而是把当前这个尚未接入的 `this` 插入本地结构。

### offset

外层更新应用逻辑会计算：

```js
offset = localClock - stackHead.id.clock
```

如果一个 Item 覆盖多个连续 clock，而本地已经拥有它的前半段，`offset` 就表示需要跳过的前缀长度。`integrate` 会调整 `id.clock`、`content`、`length`，并把新的左锚点改为被跳过部分的最后一个 ID，避免重复集成。

### 并发插入定位

`getMissing` 解析出的 `left/right` 是原始锚点。若它们仍直接相邻，就可以直接接入；若中间已经有并发 Item，`integrate` 会从 `left.right`、容器 `_start` 或 Map key 的历史链开始扫描。

扫描变量 `o` 是当前链表中已经存在的候选 Item，`left` 是当前暂定的 `this` 最终左邻居。

```text
this.origin 与 o.origin 相同
    => 二者是同一插入锚点上的并发候选，按 clientID 确定先后

o.origin 指向已经扫描过的 Item
    => o 是该 Item 之后的因果后继，需要保持这条分支的顺序

两种关系都不满足
    => 已越过 this 的冲突范围，停止扫描
```

例如两个客户端都在 `A` 后插入：

```text
客户端 1：A <-> X <-> B
客户端 2：A <-> Y <-> B
```

`X` 和 `Y` 的 `origin` 都是 `A`。接收端无论先收到哪一个，都会按相同的 ID 排序规则决定最终是：

```text
A <-> X <-> Y <-> B
```

还是：

```text
A <-> Y <-> X <-> B
```

然后重新连接双向指针：

```js
this.left.right = this
this.right.left = this
```

并更新父类型的 `_start` 或 `_map`。

## 7. integrate 与 mergeWith 的区别

源码中还有另一种“合并”：事务结束时，Yjs 会尝试对相邻且兼容的 struct 调用 `mergeWith`，例如把连续内容压缩成更大的 `Item`。这和 `integrate` 完全不同：

```text
integrate：把一个新 Item 接入文档
mergeWith：事务收尾时压缩相邻 struct
```

理解这一区别后，`getMissing`、并发位置扫描和 `integrate` 就不应再被理解为“融合旧 Item”，而应理解为“补齐因果依赖，并将当前 Item 按确定性规则接入本地副本”。
