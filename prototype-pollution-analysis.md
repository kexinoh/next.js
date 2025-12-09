# Next.js 原型链污染安全分析报告

## 概述

本报告分析了 Next.js 项目中可能存在的原型链污染（Prototype Pollution）漏洞，重点关注用户输入的 URL 被解析时未经认证直接赋值的情况。

## 漏洞原理

原型链污染是一种安全漏洞，当攻击者能够控制对象的属性名时，可以通过设置特殊属性（如 `__proto__`、`constructor.prototype`）来污染对象的原型链，从而影响应用程序的行为。

## 发现的漏洞点

### 1. `packages/next/src/lib/url.ts` - `parseReqUrl` 函数

**位置**: 第 29 行

**代码**:
```typescript
for (const key of parsedUrl.searchParams.keys()) {
  const values = parsedUrl.searchParams.getAll(key)
  query[key] = values.length > 1 ? values : values[0]
}
```

**问题**: 直接将 URL 查询参数的 key 作为对象属性赋值，没有检查 key 是否是 `__proto__`、`constructor`、`prototype` 等特殊属性。

**影响**: 攻击者可以通过构造恶意 URL 查询参数（如 `?__proto__[polluted]=value`）来污染 query 对象的原型链。

**修复建议**: 
- 使用 `Object.create(null)` 创建无原型对象
- 或检查 key 是否为特殊属性并拒绝

---

### 2. `packages/next/src/shared/lib/router/utils/querystring.ts` - `searchParamsToUrlQuery` 函数

**位置**: 第 10 行和第 14 行

**代码**:
```typescript
for (const [key, value] of searchParams.entries()) {
  const existing = query[key]
  if (typeof existing === 'undefined') {
    query[key] = value  // 第 10 行
  } else if (Array.isArray(existing)) {
    existing.push(value)
  } else {
    query[key] = [existing, value]  // 第 14 行
  }
}
```

**问题**: 直接将 URLSearchParams 的 key 作为对象属性赋值，没有验证 key 是否为特殊属性。

**影响**: 攻击者可以通过构造恶意查询参数来污染 query 对象的原型链。

**修复建议**: 
- 使用 `Object.create(null)` 创建 query 对象
- 或添加 key 验证逻辑

---

### 3. `packages/next/src/shared/lib/router/utils/route-matcher.ts` - `getRouteMatcher` 函数

**位置**: 第 38 行和第 40 行

**代码**:
```typescript
const params: Params = {}
for (const [key, group] of Object.entries(groups)) {
  const match = routeMatch[group.pos]
  if (match !== undefined) {
    if (group.repeat) {
      params[key] = match.split('/').map((entry) => decode(entry))  // 第 38 行
    } else {
      params[key] = decode(match)  // 第 40 行
    }
  }
}
```

**问题**: 虽然 key 来自 `groups`（路由定义），但如果路由定义本身被污染，或者用户能够控制路由定义，这里仍然存在风险。

**影响**: 如果攻击者能够控制路由定义或动态路由参数名，可以污染 params 对象。

**修复建议**: 
- 验证 key 是否为有效的路由参数名
- 使用 `Object.create(null)` 创建 params 对象

---

### 4. `packages/next/src/shared/lib/router/utils/prepare-destination.ts` - 多个位置

#### 4.1 `matchHas` 函数 - 第 105 行

**代码**:
```typescript
if (matches.groups) {
  Object.keys(matches.groups).forEach((groupKey) => {
    params[groupKey] = matches.groups![groupKey]  // 第 105 行
  })
}
```

**问题**: 直接将正则匹配组的 key 作为对象属性，没有验证。

**影响**: 如果正则表达式包含命名捕获组，且组名是特殊属性，可以污染 params 对象。

#### 4.2 `prepareDestination` 函数 - 第 295 行

**代码**:
```typescript
for (const key of paramKeys) {
  if (!(key in destQuery)) {
    destQuery[key] = args.params[key]  // 第 295 行
  }
}
```

**问题**: 直接将 paramKeys 中的 key 作为对象属性，没有验证。

**影响**: 如果 paramKeys 包含特殊属性名，可以污染 destQuery 对象。

#### 4.3 `prepareDestination` 函数 - 第 311-314 行

**代码**:
```typescript
if (marker === '(..)(..)') {
  args.params['0'] = '(..)'  // 第 311 行
  args.params['1'] = '(..)'  // 第 312 行
} else {
  args.params['0'] = marker  // 第 314 行
}
```

**问题**: 直接使用固定字符串 '0' 和 '1' 作为属性名，风险较低，但仍需注意。

---

### 5. `packages/next/src/server/route-modules/app-route/helpers/parsed-url-query-to-params.ts` - `parsedUrlQueryToParams` 函数

**位置**: 第 16 行

**代码**:
```typescript
for (const [key, value] of Object.entries(query)) {
  if (typeof value === 'undefined') continue
  params[key] = value  // 第 16 行
}
```

**问题**: 直接将 query 对象的 key 复制到 params 对象，没有验证 key 是否为特殊属性。

**影响**: 如果 query 对象已被污染，污染会传播到 params 对象。

**修复建议**: 
- 使用 `Object.create(null)` 创建 params 对象
- 或过滤掉特殊属性

---

### 6. `packages/next/src/server/server-utils.ts` - 多个位置

#### 6.1 `normalizeDynamicRouteParams` 函数 - 第 178 行

**代码**:
```typescript
if (value) {
  params[key] = value  // 第 178 行
}
```

**问题**: 直接将 key 作为对象属性，key 来自 `defaultRouteRegex.groups`，但如果路由定义被污染，存在风险。

#### 6.2 `handleRewrites` 函数 - 第 315 行

**代码**:
```typescript
Object.entries(rewrittenParsedUrl.query).forEach(([key, value]) => {
  if (value && typeof value === 'string' && value.startsWith(':')) {
    const paramName = value.slice(1)
    const actualValue = rewriteParams[paramName]
    if (actualValue) {
      rewrittenParsedUrl.query[key] = actualValue  // 第 315 行
    }
  }
})
```

**问题**: 直接将 key 作为对象属性赋值，没有验证。

**影响**: 如果 query 中的 key 是特殊属性，可以污染 rewrittenParsedUrl.query 对象。

---

## 风险评估

### 严重程度: 中等

**原因**:
1. 多个位置存在原型链污染风险
2. 用户输入（URL 查询参数、路由参数）直接用于对象属性赋值
3. 没有统一的防护机制
4. 虽然 URLSearchParams 会将 `__proto__[polluted]` 作为字符串键处理，但在某些场景下仍存在风险

### 攻击场景

1. **通过 URL 查询参数污染**:
   - 直接使用 `__proto__` 作为键名（虽然 URLSearchParams 会将其作为字符串处理，但某些解析逻辑可能不同）
   - 如果代码中有对象展开或 Object.assign 操作，可能传播已存在的污染

2. **通过路由参数污染**:
   - 如果路由定义允许，攻击者可能通过动态路由参数名进行污染
   - 正则表达式的命名捕获组如果包含特殊属性名，可能造成污染

3. **污染传播**:
   - 一旦 query 或 params 对象被污染，通过 `Object.assign`、对象展开等操作，污染可能传播到其他对象
   - 例如在 `resolve-rewrites.ts` 第 72 行和第 92 行使用了 `Object.assign`，可能传播污染

4. **嵌套属性解析**:
   - 如果代码中有解析嵌套属性路径的逻辑（如 `a.b.c`），攻击者可能通过构造特殊路径进行污染

---

## 修复建议

### 1. 使用无原型对象

在创建 query 和 params 对象时，使用 `Object.create(null)` 而不是 `{}`:

```typescript
const query: Record<string, string | string[]> = Object.create(null)
```

### 2. 添加属性名验证

在赋值前检查 key 是否为特殊属性:

```typescript
function isSafeKey(key: string): boolean {
  return key !== '__proto__' && 
         key !== 'constructor' && 
         key !== 'prototype'
}

if (isSafeKey(key)) {
  query[key] = value
}
```

### 3. 使用 Object.hasOwnProperty 检查

在访问对象属性时，使用 `Object.hasOwnProperty` 或 `Object.prototype.hasOwnProperty.call()` 来避免原型链污染的影响。

### 4. 统一防护机制

创建一个统一的工具函数来处理查询参数和路由参数的解析，确保所有地方都使用相同的安全机制。

---

## 测试建议

1. **构造测试用例**:
   - `?__proto__[polluted]=value` - 测试直接使用特殊属性名
   - `?constructor[prototype][polluted]=value` - 测试嵌套属性路径
   - 检查这些参数是否会影响对象的原型链
   - 测试对象展开和 Object.assign 操作是否会传播污染

2. **验证修复**:
   - 确保使用 `Object.create(null)` 后，原型链污染不再生效
   - 确保添加验证后，特殊属性被正确拒绝
   - 测试 Object.assign 和对象展开操作的安全性

3. **实际测试**:
   ```javascript
   // 测试 parseReqUrl
   const url = 'http://example.com/page?__proto__[polluted]=test';
   const parsed = parseReqUrl(url);
   // 检查 Object.prototype.polluted 是否被设置
   
   // 测试对象传播
   const obj1 = {};
   obj1.__proto__.polluted = 'test';
   const obj2 = {};
   Object.assign(obj2, obj1);
   // 检查 obj2 是否被污染
   ```

---

## 结论

Next.js 项目在多个位置存在原型链污染风险，主要集中在 URL 解析和查询参数处理的地方。建议尽快实施修复措施，特别是使用 `Object.create(null)` 创建对象，这是最有效的防护方法。
