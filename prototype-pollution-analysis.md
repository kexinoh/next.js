# Next.js 原型链污染安全分析报告

## 执行摘要

本报告对 Next.js 项目仓库进行了原型链污染（Prototype Pollution）漏洞的安全分析。总体而言，Next.js 在大多数关键路径上都有适当的安全防护措施，但在某些开发工具相关的代码中存在潜在风险。

## 关键发现

### ✅ 已实施的安全措施

1. **dset 函数保护机制** (`packages/next/src/shared/lib/dset.js`)
   - 位置：第 26 行
   - 保护：检查 `__proto__`、`constructor`、`prototype` 键
   - 状态：✅ 已防护
   - 说明：当遇到这些危险键时会 break，阻止进一步处理
   - 使用场景：在 `config.ts` 中用于设置 `turbopack.root` 配置（硬编码路径，非用户输入）

```javascript
if (k === '__proto__' || k === 'constructor' || k === 'prototype') break
```

2. **webpack-build 中的 deepMerge** (`packages/next/src/build/webpack-build/index.ts`)
   - 位置：第 22-32 行
   - 保护：使用 `Object.keys()` 而非 `for...in`
   - 状态：✅ 安全
   - 说明：`Object.keys()` 只遍历对象的自有属性，不会遍历原型链

```javascript
for (const key of Object.keys(result)) {
  // 只遍历自有属性，安全
}
```

3. **isPlainObject 检查** (`packages/next/src/shared/lib/is-plain-object.ts`)
   - 状态：✅ 有适当的对象类型检查
   - 说明：用于验证对象是否为纯对象，有助于防止原型链污染

### ⚠️ 潜在风险点

1. **DevTools deepMerge 函数** (`packages/next/src/next-devtools/shared/deepmerge.ts`)
   - 位置：第 12 行
   - 风险等级：⚠️ 中等
   - 问题：使用 `for...in` 循环，会遍历原型链上的属性
   - 使用场景：
     - `packages/next/src/next-devtools/server/devtools-config-middleware.ts` (第 63 行)
     - `packages/next/src/next-devtools/dev-overlay/utils/save-devtools-config.ts` (第 40 行)
   - 缓解措施：
     - 有 Zod schema 验证 (`devToolsConfigSchema.safeParse`)
     - 仅用于开发工具配置，非生产环境核心功能
     - 输入经过验证后才调用 `deepMerge`
   - 建议：添加 `hasOwnProperty` 检查或使用 `Object.keys()`

```typescript
// 当前实现（存在风险）
for (const key in source) {
  // 会遍历原型链属性
}

// 建议修复
for (const key in source) {
  if (!Object.prototype.hasOwnProperty.call(source, key)) continue
  // 或使用 Object.keys(source)
}
```

2. **dset 函数的保护机制不够严格**
   - 位置：`packages/next/src/shared/lib/dset.js` 第 26 行
   - 风险等级：⚠️ 低
   - 问题：遇到危险键时只是 `break`，不抛出错误，可能导致静默失败
   - 说明：虽然阻止了污染，但可能掩盖配置错误
   - 建议：考虑抛出明确的错误或警告

## 详细分析

### 1. dset 函数分析

**文件**: `packages/next/src/shared/lib/dset.js`

**功能**: 深层设置对象属性（基于 lukeed/dset v3.1.3）

**安全措施**:
- ✅ 检查 `__proto__`
- ✅ 检查 `constructor`
- ✅ 检查 `prototype`

**使用位置**:
- `packages/next/src/server/config.ts:762` - 设置 `turbopack.root`（硬编码值，安全）

**评估**: 虽然有保护，但只 break 不报错，可能隐藏配置问题。

### 2. DevTools deepMerge 分析

**文件**: `packages/next/src/next-devtools/shared/deepmerge.ts`

**问题代码**:
```typescript
for (const key in source) {
  // 这会遍历原型链上的属性
  const sourceValue = source[key]
  // ...
}
```

**风险场景**:
如果攻击者能够控制传入 `deepMerge` 的 `source` 对象，并且该对象被污染了原型链，那么 `for...in` 会遍历到这些属性。

**实际影响**:
- 受限于 DevTools 配置的 schema 验证
- 仅影响开发环境
- 需要能够修改 DevTools 配置的权限

**建议修复**:
```typescript
export function deepMerge(target: any, source: any): any {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    return source
  }

  if (!target || typeof target !== 'object' || Array.isArray(target)) {
    return source
  }

  const result = { ...target }

  // 修复：使用 Object.keys() 或添加 hasOwnProperty 检查
  for (const key of Object.keys(source)) {
    const sourceValue = source[key]
    const targetValue = target[key]

    if (sourceValue !== undefined) {
      if (
        sourceValue &&
        typeof sourceValue === 'object' &&
        !Array.isArray(sourceValue) &&
        targetValue &&
        typeof targetValue === 'object' &&
        !Array.isArray(targetValue)
      ) {
        result[key] = deepMerge(targetValue, sourceValue)
      } else {
        result[key] = sourceValue
      }
    }
  }

  return result
}
```

### 3. JSON.parse 使用分析

**发现**: 项目中大量使用 `JSON.parse`，但现代 JavaScript 引擎（V8、SpiderMonkey 等）已经默认忽略 JSON 中的 `__proto__` 属性，因此相对安全。

**验证**: 检查了主要使用位置，未发现直接使用 `JSON.parse` 结果进行不安全的对象合并操作。

### 4. 其他对象操作

**Object.assign 和展开运算符**:
- 使用 `Object.assign()` 和 `...` 展开运算符通常是安全的
- 这些操作只复制自有属性，不会复制原型链属性

**Object.keys() 使用**:
- 项目中多处使用 `Object.keys()`，这是安全的做法
- 只遍历自有属性，不会遍历原型链

## 测试建议

建议进行以下安全测试：

1. **测试 dset 函数**:
```javascript
const obj = {}
dset(obj, '__proto__.polluted', 'yes')
// 应该被阻止，但不会抛出错误
```

2. **测试 deepMerge**:
```javascript
const malicious = JSON.parse('{"__proto__":{"polluted":"yes"}}')
const target = {}
deepMerge(target, malicious)
// 应该检查是否污染了 Object.prototype
```

3. **测试 DevTools 配置端点**:
- 尝试向 `/__nextjs_devtools_config` 发送包含 `__proto__` 的配置
- 验证 schema 验证是否阻止

## 结论

### 总体评估: ✅ 相对安全

Next.js 在核心功能路径上实施了适当的安全措施：

1. ✅ **核心配置处理**：`dset` 函数有保护机制
2. ✅ **构建系统**：使用安全的 `Object.keys()` 进行对象遍历
3. ✅ **类型检查**：有 `isPlainObject` 等验证函数
4. ⚠️ **开发工具**：`deepMerge` 使用 `for...in`，但有 schema 验证作为缓解措施

### 建议的改进

1. **高优先级**（低风险，但建议修复）:
   - 修复 `packages/next/src/next-devtools/shared/deepmerge.ts` 中的 `for...in` 循环
   - 使用 `Object.keys()` 或添加 `hasOwnProperty` 检查

2. **中优先级**:
   - 改进 `dset` 函数的错误处理，遇到危险键时抛出明确的错误

3. **低优先级**:
   - 添加安全测试用例
   - 考虑在 CI/CD 中添加原型链污染检测

### 风险评估

- **生产环境风险**: 🟢 低 - 核心功能有适当保护
- **开发环境风险**: 🟡 中等 - DevTools 配置合并存在潜在风险，但受限于 schema 验证
- **实际利用难度**: 🟢 高 - 需要特定权限和条件

## 参考资源

- [OWASP - Prototype Pollution](https://owasp.org/www-community/vulnerabilities/Prototype_Pollution)
- [CVE-2019-10744](https://cve.mitre.org/cgi-bin/cvename.cgi?name=CVE-2019-10744) - Lodash prototype pollution
- [GitHub Security Advisory](https://github.com/advisories?query=prototype+pollution)

---

**分析日期**: 2024
**分析范围**: Next.js 项目仓库
**分析方法**: 静态代码分析 + 模式匹配
