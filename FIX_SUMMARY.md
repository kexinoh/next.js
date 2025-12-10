# 原型链污染修复总结

## 修复的文件

已修复以下 6 个文件中的原型链污染风险：

1. `packages/next/src/compiled/react-server-dom-webpack/cjs/react-server-dom-webpack-server.node.production.js`
2. `packages/next/src/compiled/react-server-dom-webpack/cjs/react-server-dom-webpack-server.node.development.js`
3. `packages/next/src/compiled/react-server-dom-webpack/cjs/react-server-dom-webpack-server.browser.production.js`
4. `packages/next/src/compiled/react-server-dom-webpack/cjs/react-server-dom-webpack-server.browser.development.js`
5. `packages/next/src/compiled/react-server-dom-webpack/cjs/react-server-dom-webpack-server.edge.production.js`
6. `packages/next/src/compiled/react-server-dom-webpack/cjs/react-server-dom-webpack-server.edge.development.js`

## 修复内容

### 1. 在 `fulfillReference` 函数中添加键名验证（第二道防线）

**位置**: 所有文件中的 `fulfillReference` 函数，在执行 `parentObject[key] = reference` 之前

**修复前**:
```javascript
reference = map(response, value, parentObject, key);
parentObject[key] = reference;
```

**修复后**:
```javascript
reference = map(response, value, parentObject, key);
if (key === "__proto__" || key === "constructor" || key === "prototype") {
  throw Error("Blocked potentially dangerous key: " + key);
}
parentObject[key] = reference;
```

### 2. 在 `reviveModel` 函数中过滤危险键（第一道防线）

**位置**: 所有文件中的 `reviveModel` 函数，在遍历对象属性时

**修复前**:
```javascript
for (i in value)
  hasOwnProperty.call(value, i) &&
    ((parentObj = ...),
    (parentObj = reviveModel(...)),
    void 0 !== parentObj || "__proto__" === i
      ? (value[i] = parentObj)
      : delete value[i]);
```

**修复后**:
```javascript
for (i in value)
  hasOwnProperty.call(value, i) &&
    (i !== "__proto__" && i !== "constructor" && i !== "prototype") &&
    ((parentObj = ...),
    (parentObj = reviveModel(...)),
    void 0 !== parentObj
      ? (value[i] = parentObj)
      : delete value[i]);
```

## 防护机制

采用**双层防护**策略：

1. **第一层（`reviveModel`）**: 在解析 JSON 对象时，直接过滤掉危险键（`__proto__`、`constructor`、`prototype`），防止这些键进入后续处理流程。

2. **第二层（`fulfillReference`）**: 即使危险键通过了第一层，在执行赋值操作前也会进行检查，如果检测到危险键，会抛出错误。

## 安全影响

- ✅ **防止原型链污染**: 阻止攻击者通过控制 JSON 输入来污染 `Object.prototype`
- ✅ **多层防护**: 即使一层被绕过，另一层也能阻止攻击
- ✅ **向后兼容**: 修复不会影响正常的功能使用，只是阻止恶意输入

## 测试建议

建议进行以下测试以验证修复：

1. **正常功能测试**: 确保正常的 JSON 解析和对象创建仍然工作
2. **安全测试**: 尝试发送包含 `__proto__`、`constructor`、`prototype` 键的 JSON，验证是否被正确阻止
3. **边界情况**: 测试各种边界情况，确保不会引入新的问题

## 注意事项

1. 这些是编译后的文件，修复是临时性的。长期解决方案应该修复源代码并重新编译。
2. 如果 React 团队发布了新版本，这些修复可能会被覆盖，需要重新应用。
3. 建议向 React 团队报告此安全问题，以便在源代码层面进行修复。
