/**
 * 原型链污染漏洞测试脚本
 * 
 * 此脚本用于测试 Next.js 中可能存在的原型链污染漏洞
 * 注意：这仅用于安全研究目的
 */

// 测试 1: 模拟 parseReqUrl 函数的行为
function testParseReqUrl() {
  console.log('=== 测试 1: parseReqUrl 函数 ===');
  
  // 模拟 URLSearchParams
  const searchParams = new URLSearchParams('__proto__[polluted]=test&normal=value');
  
  const query = {};
  
  // 模拟 parseReqUrl 中的代码
  for (const key of searchParams.keys()) {
    const values = searchParams.getAll(key);
    query[key] = values.length > 1 ? values : values[0];
  }
  
  console.log('query 对象:', query);
  console.log('query.__proto__.polluted:', query.__proto__.polluted);
  console.log('Object.prototype.polluted:', Object.prototype.polluted);
  console.log('污染是否成功:', Object.prototype.hasOwnProperty('polluted'));
  console.log('');
}

// 测试 2: 模拟 searchParamsToUrlQuery 函数的行为
function testSearchParamsToUrlQuery() {
  console.log('=== 测试 2: searchParamsToUrlQuery 函数 ===');
  
  const searchParams = new URLSearchParams('__proto__[constructor][prototype][polluted]=test');
  
  const query = {};
  
  // 模拟 searchParamsToUrlQuery 中的代码
  for (const [key, value] of searchParams.entries()) {
    const existing = query[key];
    if (typeof existing === 'undefined') {
      query[key] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      query[key] = [existing, value];
    }
  }
  
  console.log('query 对象:', query);
  console.log('Object.prototype.polluted:', Object.prototype.polluted);
  console.log('污染是否成功:', Object.prototype.hasOwnProperty('polluted'));
  console.log('');
}

// 测试 3: 使用 Object.create(null) 的防护效果
function testProtectionWithObjectCreateNull() {
  console.log('=== 测试 3: 使用 Object.create(null) 防护 ===');
  
  const searchParams = new URLSearchParams('__proto__[polluted]=test');
  
  // 使用 Object.create(null) 创建无原型对象
  const query = Object.create(null);
  
  for (const key of searchParams.keys()) {
    const values = searchParams.getAll(key);
    query[key] = values.length > 1 ? values : values[0];
  }
  
  console.log('query 对象:', query);
  console.log('query.__proto__:', query.__proto__);
  console.log('Object.prototype.polluted:', Object.prototype.polluted);
  console.log('污染是否成功:', Object.prototype.hasOwnProperty('polluted'));
  console.log('使用 Object.create(null) 可以有效防止原型链污染');
  console.log('');
}

// 测试 4: 验证属性名检查的防护效果
function testProtectionWithKeyValidation() {
  console.log('=== 测试 4: 使用属性名验证防护 ===');
  
  function isSafeKey(key) {
    return key !== '__proto__' && 
           key !== 'constructor' && 
           key !== 'prototype';
  }
  
  const searchParams = new URLSearchParams('__proto__[polluted]=test&normal=value');
  
  const query = {};
  
  for (const key of searchParams.keys()) {
    if (isSafeKey(key)) {
      const values = searchParams.getAll(key);
      query[key] = values.length > 1 ? values : values[0];
    } else {
      console.log(`拒绝不安全的 key: ${key}`);
    }
  }
  
  console.log('query 对象:', query);
  console.log('Object.prototype.polluted:', Object.prototype.polluted);
  console.log('污染是否成功:', Object.prototype.hasOwnProperty('polluted'));
  console.log('使用属性名验证可以有效防止原型链污染');
  console.log('');
}

// 运行所有测试
console.log('开始原型链污染漏洞测试...\n');

testParseReqUrl();
testSearchParamsToUrlQuery();
testProtectionWithObjectCreateNull();
testProtectionWithKeyValidation();

console.log('测试完成！');
console.log('\n建议：');
console.log('1. 使用 Object.create(null) 创建对象');
console.log('2. 添加属性名验证');
console.log('3. 使用 Object.hasOwnProperty 检查属性');
