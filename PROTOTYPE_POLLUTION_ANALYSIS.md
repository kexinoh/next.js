# Next.js 原型链污染安全分析报告

## 分析范围
本次分析重点检查 Next.js 在处理 `multipart/form-data` 解析时是否存在原型链污染（Prototype Pollution）的安全漏洞。

## 分析结果

### 1. multipart/form-data 解析流程

Next.js 使用以下方式处理 multipart/form-data：

#### 1.1 Server Actions (Node.js 运行时)
- **位置**: `packages/next/src/server/app-render/action-handler.ts`
- **解析库**: `busboy` (通过 `next/dist/compiled/busboy`)
- **处理函数**: `decodeReplyFromBusboy` (来自 `react-server-dom-webpack/server.node`)

**代码流程**:
```typescript
// Line 870-891 in action-handler.ts
const busboy = require('next/dist/compiled/busboy')({
  defParamCharset: 'utf8',
  headers: req.headers,
  limits: { fieldSize: bodySizeLimitBytes },
})

boundActionArguments = await decodeReplyFromBusboy(
  busboy,
  serverModuleMap,
  { temporaryReferences }
)
```

#### 1.2 Server Actions (Edge 运行时)
- **位置**: `packages/next/src/server/app-render/action-handler.ts`
- **处理方式**: 使用 Web API `req.request.formData()`
- **代码**: Line 713 `const formData = await req.request.formData()`

#### 1.3 API Routes
- **位置**: `packages/next/src/server/api-utils/node/parse-body.ts`
- **注意**: API Routes **不支持** multipart/form-data 解析
- **支持的类型**: `application/json` 和 `application/x-www-form-urlencoded`

### 2. 字段名处理分析

#### 2.1 busboy 字段名处理
在 `decodeReplyFromBusboy` 实现中（`react-server-dom-webpack`）:

```javascript
busboyStream.on("field", function (name, value) {
  resolveField(response, name, value);
});

function resolveField(response, key, value) {
  response._formData.append(key, value);  // 直接使用字段名
  // ... 其他处理逻辑
}
```

**关键发现**:
- 字段名 `name` 直接传递给 `FormData.append()`
- `FormData` 使用 Map 结构存储数据，**不会**将字段名作为对象属性使用
- 因此，即使字段名包含 `__proto__`、`constructor` 或 `prototype`，也不会导致原型链污染

#### 2.2 FormData 安全性
- `FormData.append(key, value)` 使用 Map 结构，键名不会影响对象原型
- 字段名仅作为 Map 的键使用，不会进行对象属性赋值操作

### 3. 其他相关代码检查

#### 3.1 dset.js 保护机制
**位置**: `packages/next/src/shared/lib/dset.js`

```javascript
export function dset(obj, keys, val) {
  // ...
  while (i < l) {
    k = keys[i++]
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') break
    // ...
  }
}
```

**评估**: ✅ 有保护机制，会阻止 `__proto__`、`constructor` 和 `prototype` 作为键

#### 3.2 querystring.decode() 使用
**位置**: `packages/next/src/server/api-utils/node/parse-body.ts` (Line 62)

```typescript
const qs = require('querystring') as typeof import('querystring')
return qs.decode(body)
```

**评估**: 
- `querystring.decode()` 返回一个普通对象
- 如果字段名包含 `__proto__` 等，会作为对象的属性
- **潜在风险**: 如果后续代码使用 `Object.assign()` 或展开运算符合并这些对象，可能存在风险
- **实际情况**: 在 Next.js 中，`req.body` 直接返回给用户代码，用户代码需要自行处理

### 4. 潜在风险点

#### 4.1 API Routes 中的 querystring.decode()
**风险等级**: ⚠️ 低风险

- `querystring.decode()` 可能返回包含 `__proto__` 属性的对象
- 如果用户代码使用不安全的对象合并操作，可能存在风险
- **建议**: 用户代码应该使用安全的对象合并方式

#### 4.2 用户代码中的对象处理
**风险等级**: ⚠️ 低风险

- 如果用户代码从 `req.body` 或 `formData` 中提取数据后，使用不安全的对象操作（如 `Object.assign(target, userInput)`），可能存在风险
- **建议**: 用户应该使用安全的对象合并方式，或使用 `Object.create(null)` 创建无原型对象

### 5. 安全评估结论

#### ✅ 安全的方面:
1. **multipart/form-data 解析**: 
   - 使用 `FormData` (Map 结构)，字段名不会影响对象原型
   - `busboy` 解析的字段名直接传递给 `FormData.append()`，不会进行对象属性赋值

2. **dset.js**: 
   - 有明确的保护机制，阻止 `__proto__`、`constructor` 和 `prototype` 作为键

#### ⚠️ 需要注意的方面:
1. **API Routes 中的 querystring.decode()**: 
   - 返回的对象可能包含 `__proto__` 等属性
   - 但这是 Node.js 标准库的行为，不是 Next.js 的漏洞
   - 用户代码需要正确处理

2. **用户代码安全实践**: 
   - 建议用户在使用 `req.body` 时，避免使用不安全的对象合并操作

### 6. 建议

1. **对 Next.js 框架**: 
   - ✅ 当前实现是安全的
   - multipart/form-data 解析使用 FormData，不会导致原型链污染

2. **对用户代码**: 
   - 使用 `Object.create(null)` 创建无原型对象来处理用户输入
   - 避免使用 `Object.assign(target, userInput)` 等不安全的合并操作
   - 使用安全的库（如 `lodash.merge` 的配置版本）进行对象合并

### 7. 测试建议

建议进行以下测试以验证安全性：

1. **测试 multipart/form-data 字段名包含 `__proto__`**:
   ```javascript
   const formData = new FormData();
   formData.append('__proto__.polluted', 'test');
   // 验证不会污染 Object.prototype
   ```

2. **测试 API Routes 中的 querystring.decode()**:
   ```javascript
   // 发送: __proto__[polluted]=test
   // 验证 req.body 不会污染全局对象
   ```

## 8. 测试验证结果

已执行测试脚本验证分析结果：

### 测试结果:
1. ✅ **FormData 安全性**: FormData 不会导致原型链污染
2. ✅ **busboy 字段处理**: 字段名直接传递给 FormData.append()，不会污染原型
3. ✅ **querystring.decode()**: 返回无原型对象 `[Object: null prototype]`，不会直接污染原型
4. ✅ **Object.assign()**: 在测试中未发现污染（因为 `__proto__` 属性名是字符串，不是实际的 `__proto__` 属性）

### 关键发现:
- `querystring.decode()` 返回的是 `[Object: null prototype]` 对象，这意味着它没有原型链，因此即使包含 `__proto__` 作为键名，也不会污染 `Object.prototype`
- 这是 Node.js 标准库的安全设计

## 总结

**结论**: Next.js 在处理 `multipart/form-data` 时**不存在原型链污染漏洞**。

### ✅ 安全确认:
1. **multipart/form-data 解析**: 
   - 使用 `FormData` (Map 结构)，字段名不会影响对象原型
   - `busboy` 解析的字段名直接传递给 `FormData.append()`，不会进行对象属性赋值
   - 测试验证：即使字段名包含 `__proto__` 或 `constructor.prototype`，也不会污染原型

2. **dset.js**: 
   - 有明确的保护机制，阻止 `__proto__`、`constructor` 和 `prototype` 作为键

3. **querystring.decode()**: 
   - 返回无原型对象 `[Object: null prototype]`，不会污染 `Object.prototype`
   - 这是 Node.js 标准库的安全设计

### 📋 建议:
虽然 Next.js 框架本身是安全的，但建议用户代码：
- 使用 `Object.create(null)` 创建无原型对象来处理用户输入
- 避免使用不安全的对象合并操作
- 使用安全的库进行对象合并

### 🔒 安全评级:
- **multipart/form-data 解析**: ✅ **安全** - 无原型链污染风险
- **API Routes body parser**: ✅ **安全** - querystring.decode() 返回无原型对象
