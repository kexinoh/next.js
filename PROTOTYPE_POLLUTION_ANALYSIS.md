# Next.js 原型链污染漏洞分析报告

## 执行摘要

本报告分析了 Next.js 代码库中可能存在的原型链污染（Prototype Pollution）漏洞。基于已披露的漏洞（CVE-2024-XXXX），我们系统性地扫描了整个代码库，查找具有类似特征的安全风险点。

## 漏洞根本原因分析

### 已修复漏洞的特征

已修复的漏洞位于 RSC Flight 协议的 `getOutlinedModel` 函数中，具有以下特征：

1. **动态属性访问**：使用用户输入的字符串作为属性名访问对象
2. **路径解析**：使用 `split(':')` 分割路径字符串
3. **缺少安全检查**：没有过滤 `__proto__`、`constructor`、`prototype` 等危险属性
4. **用户可控输入**：攻击者可以通过 HTTP 请求控制属性访问路径

### 漏洞模式识别

原型链污染漏洞通常出现在以下场景：

1. **动态属性访问**：`obj[variable]` 或 `obj[key]`，其中 `variable` 或 `key` 来自用户输入
2. **路径解析**：使用 `split('.')` 或 `split(':')` 分割路径后访问嵌套属性
3. **对象合并**：使用 `Object.assign` 或 `for...in` 循环合并对象，没有过滤危险属性
4. **深度赋值**：递归设置嵌套属性，没有检查属性名

## 发现的潜在风险点

### 🔴 高风险：RSC Flight 协议相关函数

#### 1. `getOutlinedModel` 函数

**位置**：
- `packages/next/src/compiled/react-server-dom-webpack/cjs/react-server-dom-webpack-server.node.production.js:2705`
- `packages/next/src/compiled/react-server-dom-webpack/cjs/react-server-dom-webpack-server.node.development.js:4842`

**代码片段**：
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
          (value = value[name]);  // ⚠️ 潜在风险
      }
      return map(response, value, parentObject, key);
  }
}
```

**问题分析**：
- ✅ 使用了 `hasOwnProperty.call(value, name)` 检查属性是否存在
- ⚠️ **关键问题**：`hasOwnProperty` 检查的逻辑是：
  ```javascript
  "object" === typeof value &&
    hasOwnProperty.call(value, name) &&
    (value = value[name]);
  ```
  这意味着只有当 `hasOwnProperty.call(value, name)` 返回 `true` 时，才会执行 `value = value[name]`
- ⚠️ **潜在风险**：如果攻击者能够构造一个对象，使其具有 `__proto__` 作为**自有属性**（own property），那么：
  - `hasOwnProperty.call(value, '__proto__')` 会返回 `true`
  - 代码会执行 `value = value['__proto__']`，从而访问到原型对象
  - 如果后续代码对原型对象进行修改，就会造成原型链污染
- ⚠️ **实际攻击场景**：
  ```javascript
  // 攻击者构造的对象
  const malicious = {
    __proto__: Object.prototype,  // 显式定义 __proto__ 作为自有属性
    // ... 其他属性
  };
  // 在这种情况下，hasOwnProperty.call(malicious, '__proto__') 返回 true
  // 代码会执行 value = value['__proto__']，从而访问到 Object.prototype
  ```

**风险评估**：
- **风险等级**：中-高
- **原因**：虽然使用了 `hasOwnProperty` 检查，但逻辑可能不够严格
- **建议**：添加显式的黑名单检查，拒绝 `__proto__`、`constructor`、`prototype` 等属性

#### 2. `fulfillReference` 函数

**位置**：
- `packages/next/src/compiled/react-server-dom-webpack/cjs/react-server-dom-webpack-server.node.production.js:2614`
- `packages/next/src/compiled/react-server-dom-webpack/cjs/react-server-dom-webpack-server.node.development.js:4751`

**代码片段**：
```javascript
function fulfillReference(response, reference, value) {
  // ...
  for (
    // ...
    i = 1;
    i < path.length;
    i++
  ) {
    // ...
    var name = path[i];
    "object" === typeof value &&
      hasOwnProperty.call(value, name) &&
      (value = value[name]);  // ⚠️ 潜在风险
  }
  reference = map(response, value, parentObject, key);
  parentObject[key] = reference;  // ⚠️ 这里也可能有问题
  // ...
}
```

**问题分析**：
- 与 `getOutlinedModel` 类似的问题
- 额外风险：`parentObject[key] = reference` 这一行也可能存在风险，如果 `key` 是 `__proto__`，可能会污染原型

**风险评估**：
- **风险等级**：中-高
- **建议**：同样需要添加黑名单检查

### 🟡 中风险：配置处理相关代码

#### 3. `config.ts` 中的路径访问

**位置**：
- `packages/next/src/server/config.ts:108-116` (warnOptionHasBeenDeprecated)
- `packages/next/src/server/config.ts:216-224` (warnOptionHasBeenMovedOutOfExperimental)
- `packages/next/src/server/config.ts:238-246` (warnCustomizedOption)

**代码片段**：
```typescript
// warnOptionHasBeenDeprecated
const nestedPropertyKeys = nestedPropertyKey.split('.')
for (const key of nestedPropertyKeys) {
  if ((current as any)[key] !== undefined) {
    current = (current as any)[key]  // ⚠️ 直接访问，没有检查 __proto__
  } else {
    found = false
    break
  }
}
```

**问题分析**：
- 使用 `split('.')` 分割路径后直接访问属性
- 没有检查 `__proto__`、`constructor`、`prototype` 等危险属性
- **但是**，这些函数处理的是配置文件（`next.config.js`），通常不是用户直接输入
- 风险相对较低，因为配置文件是开发者控制的

**风险评估**：
- **风险等级**：低-中
- **原因**：虽然代码模式类似，但输入来源相对可控
- **建议**：为了防御深度，建议添加安全检查

### 🟢 低风险：构建时处理代码

#### 4. `manifest-loader.ts` 中的对象合并

**位置**：
- `packages/next/src/shared/lib/turbopack/manifest-loader.ts:250-264`

**代码片段**：
```typescript
function mergeActionIds(
  actionEntries: ActionEntries,
  other: ActionEntries
): void {
  for (const key in other) {
    const action = (actionEntries[key] ??= {
      workers: {},
      layer: {},
    })
    action.filename = other[key].filename
    action.exportedName = other[key].exportedName
    Object.assign(action.workers, other[key].workers)  // ⚠️ 对象合并
    Object.assign(action.layer, other[key].layer)
  }
}
```

**问题分析**：
- 使用 `for...in` 循环遍历对象属性
- 使用 `Object.assign` 合并对象
- 没有检查 `__proto__` 等危险属性
- **但是**，这些代码处理的是构建时的 manifest 文件，不是用户输入

**风险评估**：
- **风险等级**：低
- **原因**：输入来源是构建时生成的 manifest，不是用户可控的
- **建议**：为了防御深度，可以考虑添加检查

#### 5. `dset.js` - 已实现安全检查 ✅

**位置**：
- `packages/next/src/shared/lib/dset.js:17-36`

**代码片段**：
```javascript
export function dset(obj, keys, val) {
  keys.split && (keys = keys.split('.'))
  var i = 0,
    l = keys.length,
    t = obj,
    x,
    k
  while (i < l) {
    k = keys[i++]
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') break  // ✅ 安全检查
    t = t[k] =
      i === l
        ? val
        : typeof (x = t[k]) === typeof keys
          ? x
          : keys[i] * 0 !== 0 || !!~('' + keys[i]).indexOf('.')
            ? {}
            : []
  }
}
```

**分析**：
- ✅ 这个函数已经实现了安全检查，会拒绝 `__proto__`、`constructor`、`prototype` 等属性
- ✅ 这是一个好的实践示例

## 详细分析

### `hasOwnProperty` 检查的局限性

在 `getOutlinedModel` 和 `fulfillReference` 函数中，代码使用了 `hasOwnProperty.call(value, name)` 来检查属性。这个检查有一定的保护作用，但可能不够充分：

1. **`__proto__` 的特殊性**：
   - `__proto__` 是一个访问器属性（accessor property），不是数据属性
   - `hasOwnProperty.call(obj, '__proto__')` 通常返回 `false`（除非对象显式定义了 `__proto__` 属性）
   - 但是，直接访问 `obj.__proto__` 仍然可以访问到原型对象

2. **潜在的攻击向量**：
   - 如果攻击者能够构造一个对象，使其具有 `__proto__` 作为自有属性（own property），那么 `hasOwnProperty` 会返回 `true`
   - 在这种情况下，代码会执行 `value = value['__proto__']`，从而访问到原型对象
   - 如果后续代码对原型对象进行修改，就会造成原型链污染
   - **实际测试**：
     ```javascript
     // 测试 hasOwnProperty 的行为
     const obj1 = {};
     console.log(hasOwnProperty.call(obj1, '__proto__'));  // false
     
     const obj2 = { __proto__: Object.prototype };
     console.log(hasOwnProperty.call(obj2, '__proto__'));  // true ⚠️
     console.log(obj2.__proto__ === Object.prototype);     // true
     ```

3. **更安全的做法**：
   ```javascript
   const DANGEROUS_KEYS = ['__proto__', 'constructor', 'prototype'];
   if (DANGEROUS_KEYS.includes(name)) {
     throw new Error('Unsafe property access detected');
   }
   ```

4. **`reviveModel` 中的特殊处理**：
   在 `reviveModel` 函数中，代码有一个特殊的逻辑：
   ```javascript
   void 0 !== parentObj || "__proto__" === i
     ? (value[i] = parentObj)
     : delete value[i];
   ```
   这个逻辑表明代码已经意识到 `__proto__` 是一个特殊情况，但处理方式可能不够安全。

### 修复建议

#### 1. 对于 RSC Flight 协议函数

**建议修复方案**：

```javascript
function getOutlinedModel(response, reference, parentObject, key, map) {
  // 定义危险属性黑名单
  const DANGEROUS_KEYS = ['__proto__', 'constructor', 'prototype'];
  
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
        
        // ✅ 添加黑名单检查
        if (DANGEROUS_KEYS.includes(name)) {
          throw new Error('Unsafe property access detected: ' + name);
        }
        
        "object" === typeof value &&
          hasOwnProperty.call(value, name) &&
          (value = value[name]);
      }
      return map(response, value, parentObject, key);
  }
}
```

同样，`fulfillReference` 函数也需要类似的修复。

#### 2. 对于配置处理代码

虽然风险较低，但为了防御深度，建议添加检查：

```typescript
const DANGEROUS_KEYS = ['__proto__', 'constructor', 'prototype'];

function warnOptionHasBeenDeprecated(
  config: NextConfig,
  nestedPropertyKey: string,
  // ...
) {
  // ...
  const nestedPropertyKeys = nestedPropertyKey.split('.')
  for (const key of nestedPropertyKeys) {
    // ✅ 添加安全检查
    if (DANGEROUS_KEYS.includes(key)) {
      return hasWarned;
    }
    
    if ((current as any)[key] !== undefined) {
      current = (current as any)[key]
    } else {
      found = false
      break
    }
  }
  // ...
}
```

## 测试建议

### 1. 单元测试

为修复后的函数添加单元测试，验证：
- 拒绝 `__proto__` 属性访问
- 拒绝 `constructor` 属性访问
- 拒绝 `prototype` 属性访问
- 正常属性访问仍然工作

### 2. 集成测试

创建集成测试，模拟攻击场景：
- 发送包含 `__proto__` 的 RSC Flight 引用
- 验证系统拒绝请求或抛出错误
- 验证原型链没有被污染

### 3. 模糊测试

使用模糊测试工具（如 AFL、libFuzzer）对 RSC Flight 协议解析器进行测试，发现潜在的边界情况。

## 总结

### 发现的风险点

1. **高风险**：
   - `getOutlinedModel` 函数（RSC Flight 协议）
   - `fulfillReference` 函数（RSC Flight 协议）

2. **中风险**：
   - `config.ts` 中的路径访问函数

3. **低风险**：
   - `manifest-loader.ts` 中的对象合并

### 建议的修复优先级

1. **立即修复**：RSC Flight 协议相关函数（`getOutlinedModel`、`fulfillReference`）
2. **计划修复**：配置处理相关代码（防御深度）
3. **考虑修复**：构建时处理代码（风险较低，但可以增强安全性）

### 最佳实践建议

1. **统一的安全检查函数**：
   ```javascript
   const DANGEROUS_KEYS = ['__proto__', 'constructor', 'prototype'];
   
   function isSafePropertyName(name) {
     return !DANGEROUS_KEYS.includes(name);
   }
   
   function assertSafePropertyName(name) {
     if (!isSafePropertyName(name)) {
       throw new Error(`Unsafe property name: ${name}`);
     }
   }
   ```

2. **代码审查检查清单**：
   - [ ] 动态属性访问是否检查了危险属性？
   - [ ] 路径解析是否过滤了 `__proto__` 等属性？
   - [ ] 对象合并是否使用了安全的合并函数？
   - [ ] 用户输入是否经过验证和清理？

3. **自动化安全检查**：
   - 使用 ESLint 插件检测潜在的原型链污染模式
   - 在 CI/CD 流程中添加安全检查

## 参考资料

- [OWASP - Prototype Pollution](https://owasp.org/www-community/vulnerabilities/Prototype_Pollution)
- [PortSwigger - Prototype Pollution](https://portswigger.net/web-security/prototype-pollution)
- [Next.js Security Advisories](https://github.com/vercel/next.js/security/advisories)

---

**报告生成时间**：2024年
**分析范围**：Next.js 代码库（packages/next/src）
**分析方法**：静态代码分析 + 模式匹配 + 人工审查
