# Next.js 原型链污染漏洞安全审计报告

## 执行摘要

基于对 Next.js 代码库的深入分析，我们发现了**已修复漏洞的部分保护措施**以及**潜在的安全风险点**。本报告详细描述了发现的问题和修复建议。

---

## 1. 已修复漏洞的分析

### 1.1 服务端代码的保护措施

服务端代码（`react-server-dom-webpack-server.*.js`）中的 `getOutlinedModel` 函数已包含部分保护：

```javascript
// 文件: react-server-dom-webpack-server.node.production.js (第 2753-2756 行)
function getOutlinedModel(response, reference, parentObject, key, map) {
  // ... 
  for (id = 1; id < reference.length; id++) {
    // ...
    var name = reference[id];
    "object" === typeof value &&
      hasOwnProperty.call(value, name) &&  // ← 添加了 hasOwnProperty 检查
      (value = value[name]);
  }
  // ...
}
```

### 1.2 服务端的 Thenable 保护

服务端代码中的 `createModel` 函数包含对 `then` 属性的特殊处理：

```javascript
// 服务端代码
function createModel(response, model, parentObject, key) {
  return "then" === key && "function" === typeof model ? null : model;
}
```

---

## 2. 发现的潜在安全风险

### 2.1 [高危] 客户端代码缺少 hasOwnProperty 检查

**位置**: `react-server-dom-webpack-client.*.production.js`

**问题**: 客户端代码中的 `getOutlinedModel` 函数直接访问属性，没有 `hasOwnProperty` 检查：

```javascript
// react-server-dom-webpack-client.node.production.js (第 1275 行)
function getOutlinedModel(response, reference, parentObject, key, map) {
  reference = reference.split(":");
  // ...
  for (var i = 1; i < reference.length; i++) {
    // ...
    id = id[reference[i]];  // ← 缺少 hasOwnProperty 检查！
  }
  // ...
}
```

**影响范围**:
- `react-server-dom-webpack-client.node.production.js` (第 1275 行)
- `react-server-dom-webpack-client.browser.production.js` (第 1099 行)
- `react-server-dom-webpack-client.edge.production.js` (第 1274 行)
- 及其对应的 turbopack 和 experimental 版本

### 2.2 [高危] 客户端代码缺少 Thenable 保护

**位置**: 所有客户端代码文件

**问题**: 客户端的 `createModel` 函数没有对 `then` 属性的保护：

```javascript
// 客户端代码 (第 1353 行左右)
function createModel(response, model) {
  return model;  // ← 直接返回，没有检查 "then" 属性！
}

// 对比服务端代码
function createModel(response, model, parentObject, key) {
  return "then" === key && "function" === typeof model ? null : model;
}
```

### 2.3 [中危] fulfillReference 函数中的属性访问

**位置**: `react-server-dom-webpack-client.*.production.js`

**问题**: `fulfillReference` 函数同样直接使用路径访问属性：

```javascript
// react-server-dom-webpack-client.node.production.js (第 1016 行)
function fulfillReference(response, reference, value) {
  // ...
  for (i = 1; i < path.length; i++) {
    // ...
    value = value[path[i]];  // ← 缺少保护
  }
  // ...
}
```

### 2.4 [中危] hasOwnProperty 检查的局限性

**问题**: 即使服务端代码使用了 `hasOwnProperty.call(value, name)` 检查，但这并不能完全防止原型链污染：

```javascript
// 攻击者可以通过 JSON 注入 __proto__ 作为实际属性
const malicious = JSON.parse('{"__proto__": {"polluted": true}}');
// hasOwnProperty.call(malicious, "__proto__") → true
```

当 JSON 被解析时，`__proto__` 可以作为对象的实际属性存在，而不仅仅是访问原型链。

---

## 3. reviveModel 中的 `__proto__` 处理

**位置**: 服务端代码第 2539 行

```javascript
function reviveModel(response, parentObj, parentKey, value, reference) {
  // ...
  for (i in value)
    hasOwnProperty.call(value, i) &&
      ((parentObj = reviveModel(/* ... */)),
      void 0 !== parentObj || "__proto__" === i  // ← 特殊处理 __proto__
        ? (value[i] = parentObj)
        : delete value[i]);
  return value;
}
```

**分析**: 这段代码的特殊处理是为了保持 `__proto__` 属性不被删除，但这可能导致 `__proto__` 属性被保留在结果对象中。

---

## 4. 修复建议

### 4.1 添加危险属性黑名单

建议在所有属性访问的地方添加危险属性检查：

```javascript
const DANGEROUS_PROPS = new Set([
  '__proto__',
  'constructor',
  'prototype',
  '__defineGetter__',
  '__defineSetter__',
  '__lookupGetter__',
  '__lookupSetter__'
]);

function isSafePropertyAccess(name) {
  return !DANGEROUS_PROPS.has(name);
}

// 在 getOutlinedModel 中
for (id = 1; id < reference.length; id++) {
  var name = reference[id];
  if (!isSafePropertyAccess(name)) {
    throw new Error("Unsafe property access detected: " + name);
  }
  // ... 继续正常处理
}
```

### 4.2 统一客户端和服务端的保护

确保客户端代码具有与服务端相同的保护措施：

1. 在客户端 `getOutlinedModel` 中添加 `hasOwnProperty` 检查
2. 在客户端 `createModel` 中添加 `then` 属性检查
3. 在 `fulfillReference` 中添加相同的保护

### 4.3 使用 Object.create(null) 或 Map

对于存储用户数据的地方，考虑使用没有原型的对象或 Map：

```javascript
// 使用 Object.create(null) 创建无原型对象
const safeObj = Object.create(null);

// 或使用 Map
const safeMap = new Map();
```

### 4.4 输入验证

在 `reference.split(":")` 之后，验证路径组件：

```javascript
reference = reference.split(":");
for (let i = 1; i < reference.length; i++) {
  if (!isSafePropertyAccess(reference[i])) {
    throw new Error("Invalid reference path component");
  }
}
```

---

## 5. 受影响文件列表

### 服务端文件 (已有部分保护):
- `packages/next/src/compiled/react-server-dom-webpack/cjs/react-server-dom-webpack-server.node.production.js`
- `packages/next/src/compiled/react-server-dom-webpack/cjs/react-server-dom-webpack-server.browser.production.js`
- `packages/next/src/compiled/react-server-dom-webpack/cjs/react-server-dom-webpack-server.edge.production.js`
- 及其 development 版本和 turbopack/experimental 变体

### 客户端文件 (缺少保护):
- `packages/next/src/compiled/react-server-dom-webpack/cjs/react-server-dom-webpack-client.node.production.js`
- `packages/next/src/compiled/react-server-dom-webpack/cjs/react-server-dom-webpack-client.browser.production.js`
- `packages/next/src/compiled/react-server-dom-webpack/cjs/react-server-dom-webpack-client.edge.production.js`
- 及其 development 版本和 turbopack/experimental 变体

---

## 6. 攻击面分析

### 6.1 服务端攻击场景
- **入口点**: Server Actions (multipart/form-data POST 请求)
- **攻击向量**: 通过 Flight 协议的引用路径 (如 `$1:__proto__:then`)
- **当前状态**: 部分缓解 (hasOwnProperty 检查 + then 属性过滤)

### 6.2 客户端攻击场景
- **入口点**: RSC 响应解析
- **攻击向量**: 恶意服务器响应或 MITM 攻击
- **当前状态**: 缺少保护措施

---

## 7. 总结

| 风险级别 | 问题 | 位置 | 状态 |
|---------|------|------|------|
| 高 | 客户端缺少 hasOwnProperty 检查 | client.*.js | 未修复 |
| 高 | 客户端缺少 then 属性保护 | client.*.js createModel | 未修复 |
| 中 | fulfillReference 属性访问 | client.*.js | 未修复 |
| 低 | hasOwnProperty 检查局限性 | server.*.js | 需要增强 |

**建议优先级**:
1. 立即修复客户端代码中缺失的保护措施
2. 添加全局危险属性黑名单
3. 考虑使用更安全的数据结构 (Map 或 Object.create(null))

---

*本报告基于 Next.js 代码库的静态分析生成，建议进行动态测试验证发现的问题。*
