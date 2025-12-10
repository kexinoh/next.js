# 推荐的安全修复方案

## 问题1: 客户端 `getOutlinedModel` 缺少 hasOwnProperty 检查

### 当前代码 (client.*.production.js)

```javascript
function getOutlinedModel(response, reference, parentObject, key, map) {
  reference = reference.split(":");
  var id = parseInt(reference[0], 16);
  id = getChunk(response, id);
  // ...
  switch (id.status) {
    case "fulfilled":
      id = id.value;
      for (var i = 1; i < reference.length; i++) {
        // ...
        id = id[reference[i]];  // 🔴 不安全的属性访问
      }
      // ...
  }
}
```

### 推荐修复

```javascript
var DANGEROUS_PROPS = {
  '__proto__': true,
  'constructor': true,
  'prototype': true,
  '__defineGetter__': true,
  '__defineSetter__': true,
  '__lookupGetter__': true,
  '__lookupSetter__': true
};

function isSafeProperty(name) {
  return !DANGEROUS_PROPS[name];
}

function getOutlinedModel(response, reference, parentObject, key, map) {
  reference = reference.split(":");
  var id = parseInt(reference[0], 16);
  id = getChunk(response, id);
  // ...
  switch (id.status) {
    case "fulfilled":
      id = id.value;
      for (var i = 1; i < reference.length; i++) {
        var propName = reference[i];
        // 🟢 添加危险属性检查
        if (!isSafeProperty(propName)) {
          throw new Error("Unsafe property access: " + propName);
        }
        // 🟢 添加 hasOwnProperty 检查
        if ("object" === typeof id && null !== id && hasOwnProperty.call(id, propName)) {
          id = id[propName];
        }
      }
      // ...
  }
}
```

---

## 问题2: 客户端 `createModel` 缺少 `then` 属性保护

### 当前代码 (client.*.production.js)

```javascript
function createModel(response, model) {
  return model;  // 🔴 直接返回，没有检查
}
```

### 推荐修复

```javascript
function createModel(response, model, parentObject, key) {
  // 🟢 与服务端保持一致的保护
  return "then" === key && "function" === typeof model ? null : model;
}
```

---

## 问题3: `fulfillReference` 中的属性访问

### 当前代码

```javascript
function fulfillReference(response, reference, value) {
  for (i = 1; i < path.length; i++) {
    // ...
    value = value[path[i]];  // 🔴 不安全
  }
}
```

### 推荐修复

```javascript
function fulfillReference(response, reference, value) {
  for (i = 1; i < path.length; i++) {
    var propName = path[i];
    // 🟢 添加安全检查
    if (!isSafeProperty(propName)) {
      throw new Error("Unsafe property access in reference: " + propName);
    }
    if ("object" === typeof value && null !== value && hasOwnProperty.call(value, propName)) {
      value = value[propName];
    }
  }
}
```

---

## 问题4: 增强服务端的 hasOwnProperty 检查

### 当前代码 (server.*.production.js)

```javascript
"object" === typeof value &&
  hasOwnProperty.call(value, name) &&
  (value = value[name]);
```

### 推荐修复

```javascript
// 🟢 在 hasOwnProperty 检查之前添加危险属性检查
if (!isSafeProperty(name)) {
  throw new Error("Unsafe property access: " + name);
}
"object" === typeof value &&
  hasOwnProperty.call(value, name) &&
  (value = value[name]);
```

---

## 问题5: `reviveModel` 中的 `__proto__` 处理

### 当前代码

```javascript
for (i in value)
  hasOwnProperty.call(value, i) &&
    ((parentObj = reviveModel(/* ... */)),
    void 0 !== parentObj || "__proto__" === i
      ? (value[i] = parentObj)
      : delete value[i]);
```

### 推荐修复

```javascript
for (i in value) {
  // 🟢 跳过危险属性
  if (!isSafeProperty(i)) {
    delete value[i];
    continue;
  }
  if (hasOwnProperty.call(value, i)) {
    parentObj = reviveModel(/* ... */);
    if (void 0 !== parentObj) {
      value[i] = parentObj;
    } else {
      delete value[i];
    }
  }
}
```

---

## 通用安全工具函数

建议在所有相关文件中添加以下通用安全函数：

```javascript
/**
 * 危险属性黑名单
 * 这些属性可能被用于原型链污染攻击
 */
var DANGEROUS_PROPS = Object.create(null);
DANGEROUS_PROPS['__proto__'] = true;
DANGEROUS_PROPS['constructor'] = true;
DANGEROUS_PROPS['prototype'] = true;
DANGEROUS_PROPS['__defineGetter__'] = true;
DANGEROUS_PROPS['__defineSetter__'] = true;
DANGEROUS_PROPS['__lookupGetter__'] = true;
DANGEROUS_PROPS['__lookupSetter__'] = true;

/**
 * 检查属性名是否安全
 * @param {string} name - 属性名
 * @returns {boolean} - 如果安全返回 true
 */
function isSafeProperty(name) {
  return typeof name === 'string' && !DANGEROUS_PROPS[name];
}

/**
 * 安全地访问对象属性
 * @param {object} obj - 目标对象
 * @param {string} prop - 属性名
 * @returns {*} - 属性值或 undefined
 */
function safePropertyAccess(obj, prop) {
  if (!isSafeProperty(prop)) {
    return undefined;
  }
  if (obj === null || typeof obj !== 'object') {
    return undefined;
  }
  if (!Object.prototype.hasOwnProperty.call(obj, prop)) {
    return undefined;
  }
  return obj[prop];
}
```

---

## 测试用例建议

```javascript
// 单元测试示例
describe('Prototype Pollution Protection', () => {
  it('should reject __proto__ in reference paths', () => {
    expect(() => {
      getOutlinedModel(response, "1:__proto__:then", {}, "key", createModel);
    }).toThrow("Unsafe property access");
  });
  
  it('should reject constructor in reference paths', () => {
    expect(() => {
      getOutlinedModel(response, "1:constructor:prototype", {}, "key", createModel);
    }).toThrow("Unsafe property access");
  });
  
  it('should filter then properties with function values', () => {
    const result = createModel(response, function() {}, {}, "then");
    expect(result).toBeNull();
  });
  
  it('should allow safe property access', () => {
    const obj = { safe: "value" };
    expect(safePropertyAccess(obj, "safe")).toBe("value");
  });
});
```

---

## 部署建议

1. **紧急修复**: 首先修复客户端代码中缺失的保护措施
2. **全面审计**: 审计所有使用动态属性访问的代码
3. **添加测试**: 为所有修复添加安全测试用例
4. **监控**: 添加日志记录可疑的属性访问尝试
5. **升级**: 确保用户升级到包含修复的版本

## 参考资料

- [OWASP Prototype Pollution](https://owasp.org/www-community/vulnerabilities/Prototype_Pollution)
- [Node.js Security Best Practices](https://nodejs.org/en/docs/guides/security/)
- [React RSC Documentation](https://react.dev/reference/rsc/server-components)
