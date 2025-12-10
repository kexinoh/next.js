# React Server Components 安全漏洞分析报告

## 概述

本报告分析了两个潜在的安全风险：
1. 客户端代码缺少 `hasOwnProperty` 检查
2. 客户端代码缺少 Thenable 保护

## 1. 问题 1: 缺少 hasOwnProperty 检查

### 1.1 问题描述

**位置**: `react-server-dom-webpack-client.*.production.js` 中的 `getOutlinedModel` 函数

**服务端代码** (有保护):
```javascript
// react-server-dom-webpack-server.node.production.js (第 2753-2756 行)
var name = reference[id];
"object" === typeof value &&
  hasOwnProperty.call(value, name) &&
  (value = value[name]);
```

**客户端代码** (缺少保护):
```javascript
// react-server-dom-webpack-client.node.production.js (第 1275 行)
id = id[reference[i]];  // ← 直接访问，没有 hasOwnProperty 检查
```

### 1.2 数据流分析

1. **数据来源**: `reference` 参数是一个字符串，格式为 `"id:prop1:prop2"`，其中：
   - `id` 是十六进制的 chunk ID
   - `prop1:prop2` 是属性路径，由服务器端在序列化嵌套对象时生成

2. **生成过程**:
   - 服务器端通过 `renderModelDestructive` 函数序列化对象
   - 当遇到嵌套对象时，服务器端生成 reference 字符串
   - 服务器端在生成路径时，属性名来自对象的实际属性名

3. **客户端处理**:
   - 客户端接收服务器端生成的 reference 字符串
   - `getOutlinedModel` 解析字符串，沿着路径访问对象属性
   - 客户端直接使用 `id[reference[i]]` 访问属性

### 1.3 潜在攻击向量

**原型污染攻击**:
- 如果攻击者能够控制服务器端生成的对象属性名，可以注入 `__proto__`、`constructor`、`prototype` 等危险属性名
- 客户端缺少 `hasOwnProperty` 检查，可能访问到原型链上的属性
- 这可能导致原型污染，影响全局对象

**攻击场景**:
1. 攻击者控制服务器端代码，生成包含 `__proto__` 的 reference 字符串
2. 客户端解析时，`id[reference[i]]` 可能访问到 `Object.prototype` 上的属性
3. 如果后续代码使用这些值，可能导致安全问题

### 1.4 风险评估

**严重性**: **中等**

**原因**:
- ✅ 服务器端有严格的类型检查：只允许普通对象（plain objects），不允许类实例或 null 原型对象
- ✅ 服务器端在生成 reference 时，属性名来自对象的实际属性，理论上应该是安全的
- ⚠️ 但如果服务器端代码存在漏洞或被攻击，可能生成恶意的 reference
- ⚠️ 客户端缺少防御性编程，没有深度防御（defense in depth）

**结论**: 虽然服务器端有保护，但客户端应该添加 `hasOwnProperty` 检查作为深度防御措施。

## 2. 问题 2: 缺少 Thenable 保护

### 2.1 问题描述

**服务端代码** (有保护):
```javascript
// react-server-dom-webpack-server.node.production.js (第 2788-2789 行)
function createModel(response, model, parentObject, key) {
  return "then" === key && "function" === typeof model ? null : model;
}
```

**客户端代码** (缺少保护):
```javascript
// react-server-dom-webpack-client.node.production.js (第 1353-1355 行)
function createModel(response, model) {
  return model;  // ← 直接返回，没有检查 "then" 属性
}
```

### 2.2 问题分析

**Thenable 污染攻击**:
- JavaScript 的 Promise/A+ 规范中，任何具有 `then` 方法的对象都被视为 Thenable
- 如果对象有 `then` 属性且是函数，JavaScript 引擎会将其视为 Promise-like 对象
- 这可能导致意外的异步行为或 Promise 链污染

**服务端的保护逻辑**:
- 服务端检查：如果属性名是 `"then"` 且值是函数，返回 `null` 而不是原始值
- 这防止了 Thenable 对象被意外传递到客户端

**客户端的风险**:
- 客户端直接返回 model，没有检查
- 如果服务器端没有正确过滤，Thenable 对象可能到达客户端
- 可能导致意外的 Promise 解析行为

### 2.3 数据流分析

1. **createModel 的调用场景**:
   - `createModel` 作为 `map` 参数传递给 `getOutlinedModel`
   - 在解析嵌套对象时，用于处理每个属性值
   - 服务端版本接收 `parentObject` 和 `key` 参数，可以检查属性名

2. **客户端限制**:
   - 客户端版本的 `createModel` 只接收 `response` 和 `model` 参数
   - 没有 `parentObject` 和 `key` 参数，无法知道属性名
   - 但可以检查 `model` 对象本身是否有 `then` 属性

### 2.4 风险评估

**严重性**: **低到中等**

**原因**:
- ✅ 服务器端已经有保护，会过滤掉 `then` 属性
- ✅ 服务器端只允许普通对象传递到客户端
- ⚠️ 客户端缺少防御性检查
- ⚠️ 如果服务器端保护失效，客户端没有备用保护

**结论**: 虽然服务器端有保护，但客户端应该添加检查作为深度防御。不过，客户端版本缺少 `key` 参数，无法完全复制服务端的逻辑。

## 3. 综合评估

### 3.1 是否是真实漏洞？

**问题 1 (hasOwnProperty)**: 
- **部分真实** - 虽然服务器端有保护，但客户端缺少深度防御
- 建议：添加 `hasOwnProperty` 检查

**问题 2 (Thenable)**:
- **部分真实** - 服务器端有保护，但客户端缺少检查
- 限制：客户端版本缺少 `key` 参数，无法完全复制服务端逻辑
- 建议：至少检查 `model` 对象本身是否有 `then` 属性

### 3.2 攻击可行性

**实际攻击难度**: **高**

**原因**:
1. 需要控制服务器端代码或数据
2. 服务器端有严格的类型检查和过滤
3. 即使攻击成功，影响范围可能有限

### 3.3 建议

1. **问题 1**: 在客户端 `getOutlinedModel` 中添加 `hasOwnProperty` 检查
2. **问题 2**: 在客户端 `createModel` 中添加 Thenable 检查（即使没有 `key` 参数）
3. **深度防御**: 即使服务器端有保护，客户端也应该添加防御性检查

## 4. 代码修复建议

### 4.1 修复问题 1

```javascript
// 客户端代码修复
function getOutlinedModel(response, reference, parentObject, key, map) {
  reference = reference.split(":");
  var id = parseInt(reference[0], 16);
  id = getChunk(response, id);
  // ... existing code ...
  switch (id.status) {
    case "fulfilled":
      id = id.value;
      for (var i = 1; i < reference.length; i++) {
        // ... existing lazy type handling ...
        // 添加 hasOwnProperty 检查
        var propName = reference[i];
        if ("object" === typeof id && 
            null !== id && 
            hasOwnProperty.call(id, propName)) {
          id = id[propName];
        } else {
          // 处理属性不存在的情况
          return undefined; // 或抛出错误
        }
      }
      // ... rest of code ...
  }
}
```

### 4.2 修复问题 2

```javascript
// 客户端代码修复
function createModel(response, model) {
  // 检查 model 是否是 Thenable（即使没有 key 参数）
  if ("object" === typeof model && 
      null !== model && 
      "function" === typeof model.then) {
    return null; // 或抛出错误
  }
  return model;
}
```

## 5. 结论

这两个问题都是**部分真实的安全风险**：
- 服务器端有保护措施，降低了实际攻击的可能性
- 但客户端缺少深度防御，存在潜在风险
- 建议添加防御性检查以提高安全性

**优先级**: 中等 - 建议修复，但不是紧急安全漏洞。
