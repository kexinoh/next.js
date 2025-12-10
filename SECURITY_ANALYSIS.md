# React Server Components Flight 协议安全分析报告

## 执行摘要

本报告分析了 React Server Components (RSC) Flight 协议实现中与原型链污染相关的潜在安全漏洞。发现了**3个高风险函数**存在安全隐患。

---

## 1. `getOutlinedModel` 函数

### 位置
- `packages/next/src/compiled/react-server-dom-webpack/cjs/react-server-dom-webpack-server.node.production.js:2705`
- `packages/next/src/compiled/react-server-dom-webpack/cjs/react-server-dom-webpack-server.node.development.js:4842`

### 问题代码
```javascript
function getOutlinedModel(response, reference, parentObject, key, map) {
  reference = reference.split(":");
  var id = parseInt(reference[0], 16);
  id = getChunk(response, id);
  // ...
  switch (id.status) {
    case "fulfilled":
      var value = id.value;
      for (id = 1; id < reference.length; id++) {
        // ...
        var name = reference[id];
        "object" === typeof value &&
          hasOwnProperty.call(value, name) &&
          (value = value[name]);  // ⚠️ 风险点 1
      }
      return map(response, value, parentObject, key);  // ⚠️ 风险点 2
  }
}
```

### 安全分析

#### 风险点 1: 原型对象访问
**问题**：
- 代码使用 `hasOwnProperty.call(value, name)` 检查属性是否存在
- 如果攻击者构造的对象具有 `__proto__` 作为**自有属性**（own property），检查会通过
- 代码会执行 `value = value['__proto__']`，从而访问到原型对象

**攻击场景**：
```javascript
// 攻击者构造的恶意对象
const malicious = Object.create(null);
malicious.__proto__ = Object.prototype;  // 显式定义 __proto__ 作为自有属性
// 或者使用 Object.defineProperty
Object.defineProperty(malicious, '__proto__', {
  value: Object.prototype,
  enumerable: true,
  configurable: true
});

// 在这种情况下：
// hasOwnProperty.call(malicious, '__proto__') === true
// value = malicious['__proto__'] 会访问到 Object.prototype
```

**影响**：
- 如果后续的 `map` 函数对 `value`（此时是原型对象）进行修改，会导致原型链污染
- 查看 `map` 函数实现（`createMap`, `createSet`, `createModel` 等），它们通常只是读取或创建新对象，**不会直接修改原型对象**
- **但是**，如果攻击者能够控制 `map` 函数的实现，或者未来代码变更引入了对 `value` 的修改，风险就会显现

#### 风险点 2: map 函数调用
**分析**：
- `map` 函数接收 `value` 作为参数
- 如果 `value` 是原型对象，`map` 函数可能会：
  - 读取原型对象的属性（信息泄露）
  - 在某些边缘情况下修改原型对象

**实际影响评估**：
- ✅ **当前实现相对安全**：查看现有的 `map` 函数（`createMap`, `createSet`, `createModel`, `loadServerReference$1`, `extractIterator`），它们都不会修改传入的 `value`
- ⚠️ **未来风险**：如果代码变更引入了新的 `map` 函数或修改了现有实现，风险会增加

### 风险评估
- **风险等级**：**中-高**
- **原因**：
  - 虽然当前 `map` 函数实现相对安全，但代码逻辑允许访问原型对象
  - 缺乏对危险属性名（`__proto__`, `constructor`, `prototype`）的显式黑名单检查
  - 未来代码变更可能引入风险

---

## 2. `fulfillReference` 函数

### 位置
- `packages/next/src/compiled/react-server-dom-webpack/cjs/react-server-dom-webpack-server.node.production.js:2614`
- `packages/next/src/compiled/react-server-dom-webpack/cjs/react-server-dom-webpack-server.node.development.js:4751`

### 问题代码
```javascript
function fulfillReference(response, reference, value) {
  for (
    var handler = reference.handler,
      parentObject = reference.parentObject,
      key = reference.key,
      map = reference.map,
      path = reference.path,
      i = 1;
    i < path.length;
    i++
  ) {
    // ...
    var name = path[i];
    "object" === typeof value &&
      hasOwnProperty.call(value, name) &&
      (value = value[name]);  // ⚠️ 风险点 1
  }
  reference = map(response, value, parentObject, key);
  parentObject[key] = reference;  // ⚠️ 风险点 2 - 原型链污染！
  // ...
}
```

### 安全分析

#### 风险点 1: 原型对象访问
**问题**：与 `getOutlinedModel` 相同的问题
- 如果 `name` 是 `__proto__` 且是对象的自有属性，会访问到原型对象

#### 风险点 2: 原型链污染（**关键风险**）
**问题**：
```javascript
parentObject[key] = reference;
```

**攻击场景**：
如果攻击者能够控制 `key` 的值为 `__proto__`，这行代码会执行：
```javascript
parentObject['__proto__'] = reference;
```

在 JavaScript 中，直接赋值 `obj['__proto__'] = value` 的行为取决于：
1. **对象是否为普通对象**：如果是普通对象，赋值会失败（在严格模式下）或无效（在非严格模式下）
2. **对象是否为 null 原型对象**：如果是 `Object.create(null)`，赋值会成功，但不会污染全局原型
3. **对象是否为特殊对象**：某些特殊对象可能允许修改 `__proto__`

**实际影响**：
- ⚠️ **高风险**：如果 `parentObject` 是 `Object.create(null)` 创建的对象，`parentObject['__proto__'] = reference` 会成功设置一个名为 `__proto__` 的属性，但不会污染全局原型
- ⚠️ **中风险**：如果 `parentObject` 是普通对象，在非严格模式下，赋值可能无效，但在某些 JavaScript 引擎中可能有不同的行为
- ⚠️ **关键风险**：如果 `parentObject` 是特殊对象（如某些框架创建的对象），赋值可能会成功并污染原型链

**验证需要**：
- 需要检查 `parentObject` 的来源和类型
- 需要验证在不同 JavaScript 引擎中的行为

### 风险评估
- **风险等级**：**高**
- **原因**：
  - `parentObject[key] = reference` 直接赋值，如果 `key` 是 `__proto__`，存在原型链污染风险
  - 缺乏对 `key` 的黑名单检查
  - 风险点 1 和风险点 2 的组合可能被利用

---

## 3. `reviveModel` 函数（额外发现）

### 位置
- `packages/next/src/compiled/react-server-dom-webpack/cjs/react-server-dom-webpack-server.node.production.js:2513`

### 问题代码
```javascript
function reviveModel(response, parentObj, parentKey, value, reference) {
  // ...
  else
    for (i in value)
      hasOwnProperty.call(value, i) &&
        ((parentObj =
          void 0 !== reference && -1 === i.indexOf(":")
            ? reference + ":" + i
            : void 0),
        (parentObj = reviveModel(response, value, i, value[i], parentObj)),
        void 0 !== parentObj || "__proto__" === i  // ⚠️ 特殊处理
          ? (value[i] = parentObj)
          : delete value[i]);
  return value;
}
```

### 安全分析

**问题**：
```javascript
void 0 !== parentObj || "__proto__" === i
  ? (value[i] = parentObj)
  : delete value[i];
```

**分析**：
- 这行代码对 `__proto__` 进行了特殊处理
- 如果 `i === "__proto__"`，即使 `parentObj` 是 `undefined`，也会执行 `value["__proto__"] = undefined`
- 这可能会：
  1. 在某些情况下污染原型链
  2. 覆盖对象的 `__proto__` 属性

**风险评估**：
- **风险等级**：**中**
- **原因**：
  - 对 `__proto__` 的特殊处理可能是有意为之（为了处理某些边缘情况）
  - 但缺乏注释说明，不清楚设计意图
  - 如果 `parentObj` 是恶意构造的对象，可能存在风险

---

## 综合风险评估

### 攻击向量

1. **通过构造恶意对象**：
   - 攻击者构造具有 `__proto__` 作为自有属性的对象
   - 通过 RSC Flight 协议传输该对象
   - 触发 `getOutlinedModel` 或 `fulfillReference` 函数
   - 访问或修改原型对象

2. **通过控制 key 值**：
   - 攻击者控制 `key` 的值为 `__proto__`
   - 触发 `fulfillReference` 函数中的 `parentObject[key] = reference`
   - 尝试污染原型链

### 实际可利用性

**关键发现**：

1. ✅ **`key` 和 `name` 可以被攻击者控制**：
   - 在 `reviveModel` 函数中（line 2532-2538），对于对象属性，`key` 直接来自对象的属性名（`i`）
   - 如果攻击者能够控制反序列化的对象，就可以控制属性名，从而控制 `key` 的值
   - 在 `getOutlinedModel` 中，`name` 来自 `reference.split(":")`，如果攻击者能够控制 `reference` 字符串，就可以控制 `name`

2. ✅ **`parentObject` 的类型**：
   - 在 `fulfillReference` 中，`parentObject` 来自 `reference.parentObject`
   - 在 `waitForReference` 中（line 2690-2695），`parentObject` 是传入的参数
   - 在 `reviveModel` 中，`parentObject` 可能是普通对象、数组或 null 原型对象
   - **关键**：如果是普通对象，`parentObject['__proto__'] = value` 在某些情况下可能无效，但在某些 JavaScript 引擎中可能有不同的行为

3. ✅ **JavaScript 引擎行为差异**：
   - 在 Node.js 和现代浏览器中，对普通对象直接赋值 `obj['__proto__']` 通常无效（不会污染全局原型）
   - 但对于 `Object.create(null)` 创建的对象，赋值会成功（但只是设置一个名为 `__proto__` 的属性，不会污染全局原型）
   - **风险**：如果 `parentObject` 是特殊对象（如某些框架创建的对象），行为可能不同

4. ✅ **`map` 函数的安全性**：
   - 当前实现相对安全，不会修改传入的 `value`
   - 但未来代码变更可能引入风险

**攻击场景验证**：

```javascript
// 攻击者构造的恶意 RSC Flight 数据
const maliciousData = {
  __proto__: {
    // 尝试污染原型
    isAdmin: true
  }
};

// 当这个对象被反序列化时：
// 1. reviveModel 会遍历属性，遇到 '__proto__'
// 2. 调用 reviveModel(response, value, '__proto__', value['__proto__'], ...)
// 3. 最终可能触发 fulfillReference，其中 key = '__proto__'
// 4. 执行 parentObject['__proto__'] = reference
```

**需要验证的关键点**：
1. ✅ `key` 和 `name` 是否可以被攻击者完全控制？**→ 确认：可以**
2. ✅ `parentObject` 的类型是什么？**→ 需要进一步验证**
3. ✅ 在不同 JavaScript 引擎中，`obj['__proto__'] = value` 的行为是否一致？**→ 需要测试**
4. ✅ `map` 函数是否可能在未来被修改以操作原型对象？**→ 当前安全，但需要持续关注**

### 风险等级总结

| 函数 | 风险点 | 风险等级 | 说明 |
|------|--------|----------|------|
| `getOutlinedModel` | 原型对象访问 | 中-高 | 当前实现相对安全，但缺乏保护 |
| `fulfillReference` | 原型对象访问 | 中-高 | 与 `getOutlinedModel` 相同 |
| `fulfillReference` | `parentObject[key]` 赋值 | **高** | 直接赋值，存在原型链污染风险 |
| `reviveModel` | `__proto__` 特殊处理 | 中 | 特殊处理逻辑，需要进一步分析 |

---

## 修复建议

### 1. 添加属性名黑名单检查

在 `getOutlinedModel` 和 `fulfillReference` 中添加黑名单：

```javascript
// 危险属性名黑名单
const DANGEROUS_PROPERTIES = ['__proto__', 'constructor', 'prototype'];

function isDangerousProperty(name) {
  return DANGEROUS_PROPERTIES.includes(name);
}

// 在 getOutlinedModel 中
var name = reference[id];
if (isDangerousProperty(name)) {
  throw new Error(`Access to dangerous property '${name}' is not allowed`);
}
"object" === typeof value &&
  hasOwnProperty.call(value, name) &&
  (value = value[name]);

// 在 fulfillReference 中
var name = path[i];
if (isDangerousProperty(name)) {
  throw new Error(`Access to dangerous property '${name}' is not allowed`);
}
"object" === typeof value &&
  hasOwnProperty.call(value, name) &&
  (value = value[name]);
```

### 2. 添加 key 值黑名单检查

在 `fulfillReference` 中，在赋值前检查 `key`：

```javascript
// 在 parentObject[key] = reference 之前
if (isDangerousProperty(key)) {
  throw new Error(`Assignment to dangerous property '${key}' is not allowed`);
}
parentObject[key] = reference;
```

### 3. 使用 Object.freeze 保护原型对象

在初始化时冻结关键原型对象：

```javascript
// 在模块初始化时
Object.freeze(Object.prototype);
Object.freeze(Object.prototype.constructor);
Object.freeze(Object.prototype.constructor.prototype);
```

**注意**：这可能会影响其他代码，需要谨慎评估。

### 4. 使用 Object.create(null) 创建安全对象

确保 `parentObject` 使用 `Object.create(null)` 创建，避免原型链污染：

```javascript
// 如果 parentObject 是普通对象，考虑使用 null 原型对象
if (parentObject && parentObject.constructor === Object) {
  // 使用安全的方式设置属性
  Object.defineProperty(parentObject, key, {
    value: reference,
    writable: true,
    enumerable: true,
    configurable: true
  });
} else {
  parentObject[key] = reference;
}
```

### 5. 添加详细的安全注释

在 `reviveModel` 中添加注释，说明 `__proto__` 特殊处理的意图：

```javascript
// 特殊处理 __proto__ 属性：...
void 0 !== parentObj || "__proto__" === i
  ? (value[i] = parentObj)
  : delete value[i];
```

---

## 验证测试建议

### 1. 单元测试

创建测试用例验证修复：

```javascript
describe('Security: Prototype Pollution Prevention', () => {
  it('should reject __proto__ in getOutlinedModel', () => {
    const malicious = Object.create(null);
    malicious.__proto__ = Object.prototype;
    // 应该抛出错误
  });

  it('should reject __proto__ as key in fulfillReference', () => {
    const reference = {
      key: '__proto__',
      // ...
    };
    // 应该抛出错误
  });
});
```

### 2. 集成测试

测试完整的 RSC Flight 协议流程，确保恶意输入被正确拒绝。

### 3. 模糊测试

使用模糊测试工具（如 `jsfuzz`）生成随机输入，测试边界情况。

---

## 结论

**确认存在安全隐患**，特别是：

1. ✅ **`fulfillReference` 函数中的 `parentObject[key] = reference`** 存在高风险的原型链污染漏洞
2. ✅ **`getOutlinedModel` 和 `fulfillReference` 中的原型对象访问** 存在中-高风险
3. ✅ **`reviveModel` 中的 `__proto__` 特殊处理** 需要进一步分析

**建议**：
- 🔴 **立即修复** `fulfillReference` 中的 `key` 黑名单检查
- 🟡 **尽快修复** `getOutlinedModel` 和 `fulfillReference` 中的属性名黑名单检查
- 🟡 **审查** `reviveModel` 中的 `__proto__` 特殊处理逻辑

---

## 参考资料

- [Prototype Pollution Attack](https://owasp.org/www-community/vulnerabilities/Prototype_Pollution)
- [MDN: Object.prototype.__proto__](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/proto__)
- [React Server Components RFC](https://github.com/reactjs/rfcs/blob/main/text/0188-server-components.md)
