# 原型链污染执行分析

## 关键问题：污染后会被执行吗？

### 1. JavaScript 中 `__proto__` 赋值的行为

在 JavaScript 中，直接设置 `obj["__proto__"]` 的行为取决于对象类型：

#### 情况 A: 普通对象字面量 `{}`
```javascript
const obj = {};
obj["__proto__"] = { polluted: true };
// 在 ES6+ 中，这只是一个普通属性，不会修改原型链
console.log(Object.prototype.polluted); // undefined
```

#### 情况 B: 通过访问器设置
```javascript
const obj = {};
Object.setPrototypeOf(obj, { polluted: true });
// 或者
obj.__proto__ = { polluted: true }; // 在某些情况下可能修改原型
console.log(Object.prototype.polluted); // 仍然 undefined（因为只修改了 obj 的原型）
```

#### 情况 C: 直接污染 Object.prototype
```javascript
Object.prototype.polluted = true;
// 现在所有对象都有这个属性
const obj = {};
console.log(obj.polluted); // true
```

### 2. 代码中的实际情况

#### 在 `fulfillReference` 中：
```javascript
function fulfillReference(response, reference, value) {
  var parentObject = reference.parentObject;  // 来自 reviveModel 中的 value
  var key = reference.key;  // 可能是 "__proto__"
  
  parentObject[key] = reference;  // 如果 key === "__proto__"
}
```

#### `parentObject` 的来源：
```javascript
// 在 reviveModel 中
function reviveModel(response, parentObj, parentKey, value, reference) {
  // value 来自 JSON.parse(resolvedModel)
  if ("object" === typeof value && null !== value) {
    for (i in value) {
      // value 是从 JSON 解析出来的对象
      // 如果 value = { "__proto__": {...} }
      // 那么 parentObject 就是 value，即 { "__proto__": {...} }
    }
  }
}
```

### 3. 关键发现

#### 问题 1: `parentObject["__proto__"] = reference` 的实际效果

在代码中，`parentObject` 是从 JSON 解析出来的对象。如果执行：
```javascript
parentObject["__proto__"] = reference;
```

这**不会直接污染 `Object.prototype`**，因为：
- `parentObject` 是一个普通对象实例
- 设置 `parentObject["__proto__"]` 只是给这个对象添加了一个名为 `"__proto__"` 的属性
- 不会影响其他对象或 `Object.prototype`

#### 问题 2: 但是，如果攻击者发送的 JSON 是：
```json
{
  "__proto__": {
    "polluted": "value"
  }
}
```

经过 `JSON.parse` 后：
```javascript
const obj = JSON.parse('{"__proto__": {"polluted": "value"}}');
// obj = { __proto__: { polluted: "value" } }
// 注意：这只是对象的一个普通属性，不是原型链
```

#### 问题 3: 真正的风险在哪里？

真正的风险在于**后续代码可能会受到污染的影响**：

1. **`for...in` 循环会遍历到 `__proto__` 属性**
   ```javascript
   for (i in value) {
     // 如果 value 有 __proto__ 属性，会被遍历到
     // 虽然 hasOwnProperty 会检查，但如果后续代码不检查...
   }
   ```

2. **如果污染了 `Object.prototype`，所有新对象都会受影响**
   ```javascript
   // 如果攻击者能够污染 Object.prototype
   Object.prototype.polluted = "value";
   
   // 那么所有新创建的对象都会有这个属性
   const obj = {};
   console.log(obj.polluted); // "value"
   ```

3. **代码中使用了 `Object.prototype.hasOwnProperty`**
   ```javascript
   var hasOwnProperty = Object.prototype.hasOwnProperty;
   // 如果 Object.prototype 被污染，hasOwnProperty 可能被覆盖
   ```

### 4. 实际攻击场景分析

#### 场景 A: 直接设置 `parentObject["__proto__"]`
```javascript
// 如果 key === "__proto__"
parentObject["__proto__"] = reference;
```

**影响**：
- 只影响 `parentObject` 这个特定对象
- 不会污染 `Object.prototype`
- 但 `parentObject` 现在有一个 `__proto__` 属性，值为 `reference`

#### 场景 B: 通过 `for...in` 遍历
```javascript
// 在 reviveModel 中
for (i in value) {
  // 如果 value = { "__proto__": {...} }
  // i 可能是 "__proto__"
  value[i] = parentObj;  // 设置 value["__proto__"] = parentObj
}
```

**影响**：
- `value` 对象现在有 `__proto__` 属性
- 后续代码访问 `value.__proto__` 会得到被设置的值
- 但这不会影响其他对象

#### 场景 C: 真正的原型链污染（如果可能）

如果攻击者能够：
1. 污染 `Object.prototype`
2. 覆盖关键方法如 `hasOwnProperty`、`toString` 等
3. 影响所有后续创建的对象

**潜在影响**：
```javascript
// 如果 Object.prototype.hasOwnProperty 被覆盖
Object.prototype.hasOwnProperty = function() { 
  // 恶意代码
  return true; 
};

// 那么所有对象的 hasOwnProperty 检查都会失效
const obj = {};
obj.hasOwnProperty("anyKey"); // 总是返回 true
```

### 5. 代码中的风险点

#### 风险点 1: `for...in` 循环
```javascript
for (i in value) {
  hasOwnProperty.call(value, i) &&  // 如果 hasOwnProperty 被污染...
    (i !== "__proto__" && i !== "constructor" && i !== "prototype") &&
    // ...
}
```

如果 `Object.prototype.hasOwnProperty` 被污染，检查可能失效。

#### 风险点 2: 对象属性访问
```javascript
value = value[name];  // 如果 name 来自被污染的原型链...
```

如果 `Object.prototype` 被污染，访问不存在的属性可能返回污染的值。

#### 风险点 3: JSON 序列化
```javascript
var stringify = JSON.stringify;
// 如果 Object.prototype 被污染，序列化可能包含污染的数据
```

### 6. 实际执行路径

假设攻击者成功污染了原型链：

1. **立即影响**：
   - `parentObject["__proto__"] = reference` 执行
   - `parentObject` 对象有 `__proto__` 属性

2. **后续影响**：
   - 如果 `Object.prototype` 被污染，所有新对象都会受影响
   - `for...in` 循环可能遍历到污染的属性
   - 属性访问可能返回污染的值

3. **潜在代码执行**：
   - 如果污染了 `Object.prototype.toString`、`valueOf` 等方法
   - 当这些方法被调用时，可能执行恶意代码
   - 例如：`String(obj)` 会调用 `obj.toString()`

### 7. 结论

#### 直接设置 `parentObject["__proto__"]` 的影响：
- ✅ **不会直接污染 `Object.prototype`**
- ⚠️ **但会影响 `parentObject` 对象本身**
- ⚠️ **如果后续代码依赖对象结构，可能出问题**

#### 真正的风险：
- 🔴 **如果攻击者能够污染 `Object.prototype`**（通过其他方式）
- 🔴 **所有使用 `for...in`、属性访问、方法调用的地方都可能受影响**
- 🔴 **可能导致代码执行、数据泄露、拒绝服务等**

#### 我们的修复是否足够：
- ✅ **第一层防护**（`reviveModel`）：阻止 `__proto__` 键进入处理流程
- ✅ **第二层防护**（`fulfillReference`）：即使通过第一层，也会被阻止
- ✅ **双重保障**：确保 `__proto__` 键无法被处理

### 8. 建议

虽然直接设置 `parentObject["__proto__"]` 不会立即污染 `Object.prototype`，但：
1. **防御性编程**：应该阻止所有可能的攻击向量
2. **深度防御**：多层防护确保安全
3. **最佳实践**：永远不要信任外部输入，始终验证和清理

我们的修复是正确的，因为它：
- 阻止了潜在的攻击向量
- 防止了对象结构被破坏
- 遵循了安全最佳实践
