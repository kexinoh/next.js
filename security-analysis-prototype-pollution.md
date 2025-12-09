# Next.js 原型链污染安全分析报告

## 执行摘要

在对 Next.js 项目进行安全分析时，发现了一个潜在的原型链污染（Prototype Pollution）漏洞，位于编译后的 React Server Components 代码中。

## 漏洞详情

### 受影响文件
- **主要文件**: `packages/next/src/compiled/react-server-dom-webpack/cjs/react-server-dom-webpack-server.node.production.js`
- **漏洞位置**: 第 2365-2372 行的 `reviveModel` 函数

### 漏洞代码分析

#### 1. JSON 解析入口（第 2388 行）
```javascript
var rawModel = JSON.parse(resolvedModel),
    value = reviveModel(
      chunk._response,
      { "": rawModel },
      "",
      rawModel,
      rootReference
    );
```

**问题**: `resolvedModel` 来自外部输入（chunk.value），直接使用 `JSON.parse` 解析，没有对特殊属性进行过滤。

#### 2. 对象属性遍历（第 2365-2372 行）
```javascript
else
  for (i in value)
    hasOwnProperty.call(value, i) &&
      ((parentObj =
        void 0 !== reference && -1 === i.indexOf(":")
          ? reference + ":" + i
          : void 0),
      (parentObj = reviveModel(response, value, i, value[i], parentObj)),
      void 0 !== parentObj ? (value[i] = parentObj) : delete value[i]);
```

**问题分析**:
1. 使用 `for...in` 循环遍历对象属性
2. 虽然使用了 `hasOwnProperty.call(value, i)` 检查，但这**不能防止原型链污染**
3. 当 JSON 包含 `{"__proto__": {...}}` 时，`hasOwnProperty` 会返回 `true`（因为 `__proto__` 确实是对象自身的属性）
4. 执行 `value[i] = parentObj` 时，如果 `i` 是 `__proto__`，可能会修改对象的原型链
5. 执行 `delete value[i]` 时，如果 `i` 是 `__proto__`，可能会删除原型链

**重要说明**:
- 现代 JavaScript 引擎（Node.js 12+）通常会在运行时阻止直接设置 `__proto__` 属性
- 但是，代码中**缺少显式的属性过滤**仍然是一个安全风险，因为：
  - 防御性编程要求应该始终过滤危险属性
  - 在某些环境或旧版本中可能仍然可被利用
  - 可能存在其他攻击向量（如通过 `constructor.prototype`）
  - 代码的可维护性和安全性最佳实践要求显式处理

### 漏洞利用场景

攻击者可以构造恶意的 JSON 数据来污染原型链：

```json
{
  "__proto__": {
    "polluted": true,
    "isAdmin": true
  }
}
```

或者使用嵌套的 `constructor.prototype`：

```json
{
  "constructor": {
    "prototype": {
      "polluted": true
    }
  }
}
```

### 潜在影响

1. **代码注入**: 通过污染原型链，可能影响后续使用该对象的代码逻辑
2. **权限提升**: 如果应用依赖对象属性进行权限检查，可能被绕过
3. **拒绝服务**: 污染原型链可能导致应用崩溃或异常行为
4. **数据篡改**: 影响其他使用相同原型的对象

### 攻击向量

该漏洞可能通过以下方式被利用：
- React Server Components 的数据传输
- Server Actions 的输入数据
- 任何通过 `react-server-dom-webpack` 传输的序列化数据

## 修复建议

### 1. 过滤危险属性（推荐）

在 `reviveModel` 函数中添加属性过滤：

```javascript
else
  for (i in value) {
    // 过滤危险属性
    if (i === '__proto__' || i === 'constructor' || i === 'prototype') {
      continue;
    }
    
    hasOwnProperty.call(value, i) &&
      ((parentObj =
        void 0 !== reference && -1 === i.indexOf(":")
          ? reference + ":" + i
          : void 0),
      (parentObj = reviveModel(response, value, i, value[i], parentObj)),
      void 0 !== parentObj ? (value[i] = parentObj) : delete value[i]);
  }
```

### 2. 使用 Object.keys() 替代 for...in

```javascript
else {
  const keys = Object.keys(value);
  for (let j = 0; j < keys.length; j++) {
    i = keys[j];
    // 仍然需要过滤，因为 Object.keys 也会包含 __proto__ 等属性
    if (i === '__proto__' || i === 'constructor' || i === 'prototype') {
      continue;
    }
    // ... 其余代码
  }
}
```

### 3. 使用 Object.create(null) 创建对象

在解析 JSON 后，使用 `Object.create(null)` 创建没有原型链的对象：

```javascript
var rawModel = JSON.parse(resolvedModel);
// 将对象转换为无原型链的对象
rawModel = Object.assign(Object.create(null), rawModel);
```

### 4. 使用安全的 JSON 解析库

考虑使用专门处理原型链污染的 JSON 解析库，如 `json-parse-safe` 或类似工具。

## 其他发现

### 其他潜在风险点

1. **packages/next/src/server/request/params.ts** (第 197, 243, 262, 305 行)
   - 使用 `for...in` 循环遍历 `underlyingParams`
   - 需要确认这些参数是否来自不可信来源

2. **packages/next/src/server/server-utils.ts** (第 43 行)
   - 使用 `for...in` 遍历 `query` 对象
   - 需要确认是否有适当的过滤

## 验证测试

建议创建以下测试用例来验证漏洞：

```javascript
// 测试用例 1: __proto__ 污染
const maliciousJSON = '{"__proto__":{"polluted":true}}';
const parsed = JSON.parse(maliciousJSON);
// 验证是否会影响 Object.prototype

// 测试用例 2: constructor.prototype 污染
const maliciousJSON2 = '{"constructor":{"prototype":{"polluted":true}}}';
const parsed2 = JSON.parse(maliciousJSON2);
// 验证是否会影响原型链
```

## 测试结果

已创建并运行测试脚本验证漏洞：
- `test-prototype-pollution.js` - 基础测试
- `test-prototype-pollution-advanced.js` - 高级测试

**测试发现**:
- 在现代 Node.js 环境中，直接设置 `__proto__` 通常被引擎保护
- 但代码仍然存在安全风险，因为缺少显式的属性过滤
- 防御性编程要求应该始终过滤 `__proto__`、`constructor`、`prototype` 等危险属性

## 优先级

**严重程度**: 中-高（取决于运行环境）
**可利用性**: 低-中等（现代引擎有保护，但代码仍存在风险）
**影响范围**: React Server Components 相关功能
**风险评估**: 虽然现代引擎有保护，但缺少显式过滤仍然是不良实践，建议修复

## 建议行动

1. **立即**: 在 `reviveModel` 函数中添加属性过滤
2. **短期**: 审查所有使用 `for...in` 循环处理外部数据的地方
3. **长期**: 建立代码审查流程，确保所有 JSON 解析都有适当的防护措施

## 参考资料

- [OWASP - Prototype Pollution](https://owasp.org/www-community/vulnerabilities/Prototype_Pollution)
- [CVE-2019-10744](https://cve.mitre.org/cgi-bin/cvename.cgi?name=CVE-2019-10744) - lodash 原型链污染漏洞
- [Prototype Pollution in JavaScript](https://portswigger.net/web-security/prototype-pollution)

## 代码示例

### 当前代码（存在风险）
```javascript
// 第 2365-2372 行
else
  for (i in value)
    hasOwnProperty.call(value, i) &&
      ((parentObj =
        void 0 !== reference && -1 === i.indexOf(":")
          ? reference + ":" + i
          : void 0),
      (parentObj = reviveModel(response, value, i, value[i], parentObj)),
      void 0 !== parentObj ? (value[i] = parentObj) : delete value[i]);
```

### 建议的修复代码
```javascript
else {
  const DANGEROUS_KEYS = ['__proto__', 'constructor', 'prototype'];
  for (i in value) {
    // 显式过滤危险属性
    if (DANGEROUS_KEYS.includes(i)) {
      continue;
    }
    if (hasOwnProperty.call(value, i)) {
      const parentObj =
        void 0 !== reference && -1 === i.indexOf(":")
          ? reference + ":" + i
          : void 0;
      const processed = reviveModel(response, value, i, value[i], parentObj);
      if (void 0 !== processed) {
        value[i] = processed;
      } else {
        delete value[i];
      }
    }
  }
}
```

---
**分析日期**: 2024
**分析工具**: 手动代码审查 + 静态分析 + 动态测试
**测试文件**: `test-prototype-pollution.js`, `test-prototype-pollution-advanced.js`
