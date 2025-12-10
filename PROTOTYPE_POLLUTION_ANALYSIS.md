# 原型链污染风险分析报告

## 问题位置
- **文件**: `packages/next/src/compiled/react-server-dom-webpack/cjs/react-server-dom-webpack-server.node.production.js`
- **函数**: `fulfillReference`
- **行号**: 2655
- **代码**: `parentObject[key] = reference;`

## 风险分析

### 1. 数据流追踪

#### 输入来源
1. **JSON 解析** (`initializeModelChunk`, 行2557):
   ```javascript
   var rawModel = JSON.parse(resolvedModel)
   ```
   - `resolvedModel` 来自网络输入（FormData）
   - 攻击者可以控制 JSON 内容

2. **对象属性遍历** (`reviveModel`, 行2532-2541):
   ```javascript
   for (i in value)
     hasOwnProperty.call(value, i) &&
       (parentObj = reviveModel(response, value, i, value[i], parentObj),
        void 0 !== parentObj || "__proto__" === i
          ? (value[i] = parentObj)
          : delete value[i]);
   ```
   - 遍历 JSON 对象的每个属性
   - 属性名 `i` 直接来自 JSON，可被攻击者控制
   - **注意**: 代码中有特殊处理 `"__proto__" === i`，但这可能不足以防止污染

3. **Reference 对象创建** (`waitForReference`, 行2690-2696):
   ```javascript
   parentObject = {
     handler: response,
     parentObject: parentObject,  // 这里的 parentObject 是传入的对象
     key: key,                     // key 来自属性名
     map: map,
     path: path
   };
   ```

4. **最终赋值** (`fulfillReference`, 行2655):
   ```javascript
   parentObject[key] = reference;
   ```
   - `key` 来自 `reference.key`，即 JSON 对象的属性名
   - `parentObject` 是普通对象（不是 `Object.create(null)` 创建的）

### 2. 攻击场景

如果攻击者发送以下 JSON：
```json
{
  "__proto__": {
    "$F...": "malicious_reference_string"
  }
}
```

或者：
```json
{
  "__proto__": "$F..."
}
```

流程：
1. `JSON.parse` 解析 JSON
2. `reviveModel` 遍历属性，发现 `"__proto__"` 键
3. 调用 `parseModelString(response, obj, "__proto__", "$F...", reference)`
4. `parseModelString` 调用 `getOutlinedModel(response, value, obj, "__proto__", map)`
5. `getOutlinedModel` 可能调用 `waitForReference`，创建 reference 对象，`key = "__proto__"`
6. 最终 `fulfillReference` 执行 `parentObject["__proto__"] = reference`
7. 如果 `parentObject` 是普通对象，这会污染 `Object.prototype`

### 3. 现有防护措施

1. **`hasOwnProperty` 检查** (行2533):
   - 使用 `hasOwnProperty.call(value, i)` 检查属性
   - 但这只检查属性是否存在，不防止 `__proto__` 赋值

2. **`__proto__` 特殊处理** (行2539):
   ```javascript
   void 0 !== parentObj || "__proto__" === i
     ? (value[i] = parentObj)
     : delete value[i];
   ```
   - 即使 `parentObj` 是 `undefined`，如果 `i === "__proto__"` 也会赋值
   - 这个逻辑可能是为了保留 `__proto__` 属性，但可能引入风险

3. **`then` 键检查** (`loadServerReference$1`, 行2458, `createModel`, 行2789):
   ```javascript
   if ("string" !== typeof id || "then" === key) return null;
   return "then" === key && "function" === typeof model ? null : model;
   ```
   - 有对 `"then"` 键的特殊处理，但没有对 `"__proto__"` 的类似处理

### 4. 风险评估

**风险等级**: **高**

**原因**:
1. ✅ 输入来源可被攻击者控制（JSON 来自网络）
2. ✅ `key` 值直接来自 JSON 属性名，无验证
3. ✅ `parentObject` 是普通对象，有原型链
4. ✅ 直接赋值 `parentObject[key] = reference` 无防护
5. ⚠️ 虽然有 `__proto__` 的特殊处理，但可能不足以防止所有攻击场景

**潜在影响**:
- 污染 `Object.prototype`，影响所有对象
- 可能导致拒绝服务（DoS）
- 可能被用于代码执行（如果后续代码依赖原型链）

## 修复建议

### 方案 1: 在 `fulfillReference` 中添加键名验证（推荐）

在 `fulfillReference` 函数中，在执行 `parentObject[key] = reference` 之前，检查 `key` 是否为危险键：

```javascript
function fulfillReference(response, reference, value) {
  // ... 现有代码 ...
  
  // 添加防护
  if (key === "__proto__" || key === "constructor" || key === "prototype") {
    // 记录警告或抛出错误
    console.warn("Blocked potentially dangerous key:", key);
    return; // 或抛出错误
  }
  
  reference = map(response, value, parentObject, key);
  parentObject[key] = reference;
  // ... 其余代码 ...
}
```

### 方案 2: 在 `waitForReference` 中验证

在创建 reference 对象时验证：

```javascript
function waitForReference(referencedChunk, parentObject, key, response, map, path) {
  // 添加防护
  if (key === "__proto__" || key === "constructor" || key === "prototype") {
    throw new Error("Dangerous key detected: " + key);
  }
  
  // ... 现有代码 ...
}
```

### 方案 3: 在 `reviveModel` 中过滤

在遍历对象属性时过滤危险键：

```javascript
for (i in value)
  hasOwnProperty.call(value, i) &&
    (i !== "__proto__" && i !== "constructor" && i !== "prototype") &&
    // ... 其余代码 ...
```

### 方案 4: 使用 `Object.create(null)` 创建对象

修改 `initializeModelChunk` 中的对象创建：

```javascript
value = reviveModel(
  response,
  Object.create(null), // 使用无原型对象
  "",
  rawModel,
  _chunk$reason
);
```

但需要注意，这可能影响其他代码的兼容性。

## 建议

**推荐使用方案 1 + 方案 3 的组合**:
1. 在 `reviveModel` 中过滤危险键（第一道防线）
2. 在 `fulfillReference` 中添加验证（第二道防线）

这样可以提供多层防护，即使一层被绕过，另一层也能阻止攻击。
