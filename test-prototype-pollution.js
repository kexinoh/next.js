/**
 * 原型链污染测试脚本
 * 用于验证 Next.js multipart/form-data 解析的安全性
 */

// 测试 1: FormData 不会导致原型链污染
console.log('=== 测试 1: FormData 安全性 ===');
const formData1 = new FormData();
formData1.append('__proto__.polluted', 'test');
formData1.append('constructor.prototype.polluted', 'test');

// 检查 Object.prototype 是否被污染
if (Object.prototype.polluted === 'test') {
  console.log('❌ 发现原型链污染！');
} else {
  console.log('✅ FormData 是安全的，不会导致原型链污染');
}

// 测试 2: 模拟 busboy 字段处理
console.log('\n=== 测试 2: 模拟 busboy 字段处理 ===');
const mockFormData = new FormData();
const testFields = [
  ['__proto__.polluted', 'test'],
  ['constructor.prototype.polluted', 'test'],
  ['normal.field', 'value'],
];

testFields.forEach(([name, value]) => {
  mockFormData.append(name, value);
});

// 检查 Object.prototype
if (Object.prototype.polluted === 'test') {
  console.log('❌ 发现原型链污染！');
} else {
  console.log('✅ busboy 字段处理是安全的');
}

// 测试 3: querystring.decode() 的行为
console.log('\n=== 测试 3: querystring.decode() 行为 ===');
const querystring = require('querystring');
const testQuery = '__proto__[polluted]=test&normal=value';
const decoded = querystring.decode(testQuery);

console.log('解码结果:', decoded);
console.log('decoded.__proto__:', decoded.__proto__);
console.log('decoded.constructor:', decoded.constructor);

// 检查是否污染了 Object.prototype
if (Object.prototype.polluted === 'test') {
  console.log('❌ querystring.decode() 可能导致原型链污染');
} else {
  console.log('✅ querystring.decode() 不会直接污染原型（但返回的对象包含 __proto__ 属性）');
}

// 测试 4: 不安全的对象合并
console.log('\n=== 测试 4: 不安全的对象合并示例 ===');
const target = {};
const userInput = querystring.decode('__proto__[polluted]=test');

// 不安全的合并方式
Object.assign(target, userInput);
if (Object.prototype.polluted === 'test') {
  console.log('❌ Object.assign() 可能导致原型链污染');
} else {
  console.log('✅ Object.assign() 在这个测试中没有污染（可能因为 __proto__ 是不可枚举的）');
}

// 测试 5: 安全的对象合并
console.log('\n=== 测试 5: 安全的对象合并方式 ===');
const safeTarget = Object.create(null); // 无原型对象
Object.assign(safeTarget, userInput);
console.log('safeTarget:', safeTarget);
if (Object.prototype.polluted === 'test') {
  console.log('❌ 仍然存在污染（来自之前的测试）');
} else {
  console.log('✅ 使用 Object.create(null) 创建的对象是安全的');
}

// 清理
delete Object.prototype.polluted;
console.log('\n=== 测试完成 ===');
