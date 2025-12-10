# 上游数据流追踪 - 原型链污染风险分析

## 数据流完整追踪

### 1. HTTP 请求入口

**文件**: `packages/next/src/server/app-render/action-handler.ts`

**函数**: `handleAction` (行497)

**请求类型**: **POST 请求**（Server Actions）

```typescript
export async function handleAction({
  req,  // BaseNextRequest - HTTP 请求对象
  res,
  // ...
}: {
  req: BaseNextRequest  // ← 外部 HTTP 请求
  // ...
})
```

### 2. 请求体读取

#### Edge Runtime (行684-794)
```typescript
if (process.env.NEXT_RUNTIME === 'edge' && isWebNextRequest(req)) {
  const formData = await req.request.formData()  // ← 从 HTTP 请求读取
  boundActionArguments = await decodeReply(
    formData,  // ← 外部数据
    serverModuleMap,
    { temporaryReferences }
  )
}
```

#### Node Runtime (行796-982)
```typescript
else if (process.env.NEXT_RUNTIME !== 'edge' && isNodeNextRequest(req)) {
  // 从 req.body 读取数据流
  const busboy = require('next/dist/compiled/busboy')({
    headers: req.headers,  // ← HTTP 请求头
    // ...
  })
  
  boundActionArguments = await decodeReplyFromBusboy(
    busboy,  // ← 解析 HTTP multipart/form-data
    serverModuleMap,
    { temporaryReferences }
  )
  
  // 或
  const actionData = Buffer.concat(chunks).toString('utf-8')  // ← 从 HTTP 请求体读取
  boundActionArguments = await decodeReply(
    actionData,  // ← 外部数据
    serverModuleMap,
    { temporaryReferences }
  )
}
```

### 3. decodeReply / decodeReplyFromBusboy

**文件**: `packages/next/src/compiled/react-server-dom-webpack/cjs/react-server-dom-webpack-server.node.production.js`

**函数**: `exports.decodeReply` (行3259) 或 `exports.decodeReplyFromBusboy` (行3306)

```javascript
exports.decodeReply = function (body, webpackMap, options) {
  // body 来自 HTTP 请求体（FormData 或字符串）
  if ("string" === typeof body) {
    var form = new FormData();
    form.append("0", body);  // ← 外部数据
    body = form;
  }
  // ...
}

exports.decodeReplyFromBusboy = function (busboyStream, webpackMap, options) {
  // busboyStream 解析 HTTP multipart/form-data
  busboyStream.on("field", function (name, value) {
    resolveField(response, name, value);  // ← 外部数据
  })
}
```

### 4. resolveField

**文件**: `packages/next/src/compiled/react-server-dom-webpack/cjs/react-server-dom-webpack-server.node.production.js`

**函数**: `resolveField` (行3138)

```javascript
function resolveField(response, key, value) {
  response._formData.append(key, value);  // key 和 value 来自 HTTP 请求
  var prefix = response._prefix;
  if (key.startsWith(prefix)) {
    var chunks = response._chunks;
    key = +key.slice(prefix.length);
    (chunks = chunks.get(key)) &&
      resolveModelChunk(response, chunks, value, key);  // ← value 来自 HTTP
  }
}
```

### 5. resolveModelChunk

**文件**: `packages/next/src/compiled/react-server-dom-webpack/cjs/react-server-dom-webpack-server.node.production.js`

**函数**: `resolveModelChunk` (行2376)

```javascript
function resolveModelChunk(response, chunk, value, id) {
  // value 来自 HTTP 请求字段值
  chunk.status = "resolved_model";
  chunk.value = value;  // ← 存储来自 HTTP 的数据
  // ...
}
```

### 6. getChunk

**文件**: `packages/next/src/compiled/react-server-dom-webpack/cjs/react-server-dom-webpack-server.node.production.js`

**函数**: `getChunk` (行2600)

```javascript
function getChunk(response, id) {
  var chunks = response._chunks,
    chunk = chunks.get(id);
  chunk ||
    ((chunk = response._formData.get(response._prefix + id)),  // ← 从 FormData 获取
    (chunk =
      "string" === typeof chunk
        ? createResolvedModelChunk(response, chunk, id)  // ← chunk 来自 HTTP
        : // ...
    ),
    chunks.set(id, chunk));
  return chunk;
}
```

### 7. initializeModelChunk

**文件**: `packages/next/src/compiled/react-server-dom-webpack/cjs/react-server-dom-webpack-server.node.production.js`

**函数**: `initializeModelChunk` (行2546)

```javascript
function initializeModelChunk(chunk) {
  var resolvedModel = chunk.value;  // ← 来自 HTTP 请求的数据
  // ...
  try {
    var rawModel = JSON.parse(resolvedModel),  // ← JSON.parse 解析外部数据！
      value = reviveModel(
        response,
        { "": rawModel },
        "",
        rawModel,  // ← 外部 JSON 对象
        _chunk$reason
      ),
      // ...
  }
}
```

### 8. reviveModel

**文件**: `packages/next/src/compiled/react-server-dom-webpack/cjs/react-server-dom-webpack-server.node.production.js`

**函数**: `reviveModel` (行2513)

```javascript
function reviveModel(response, parentObj, parentKey, value, reference) {
  // value 来自 JSON.parse(resolvedModel)，即外部 HTTP 请求
  if ("object" === typeof value && null !== value) {
    for (i in value)  // ← 遍历外部 JSON 对象的属性
      hasOwnProperty.call(value, i) &&
        (parentObj = reviveModel(response, value, i, value[i], parentObj))
        // i 是属性名，来自外部 JSON，可被攻击者控制！
  }
}
```

### 9. parseModelString → getOutlinedModel → waitForReference

**文件**: `packages/next/src/compiled/react-server-dom-webpack/cjs/react-server-dom-webpack-server.node.production.js`

```javascript
function parseModelString(response, obj, key, value, reference) {
  // key 来自外部 JSON 对象的属性名
  return getOutlinedModel(response, value, obj, key, loadServerReference$1)
}

function waitForReference(referencedChunk, parentObject, key, response, map, path) {
  // key 来自外部 JSON 对象的属性名
  parentObject = {
    handler: response,
    parentObject: parentObject,
    key: key,  // ← 可被攻击者控制
    map: map,
    path: path
  };
}
```

### 10. fulfillReference（风险点）

**文件**: `packages/next/src/compiled/react-server-dom-webpack/cjs/react-server-dom-webpack-server.node.production.js`

**函数**: `fulfillReference` (行2614)

```javascript
function fulfillReference(response, reference, value) {
  var key = reference.key;  // ← 来自外部 JSON 对象的属性名
  // ...
  parentObject[key] = reference;  // ← 如果 key === "__proto__"，会污染原型链！
}
```

## 完整数据流图

```
外部 HTTP POST 请求
    ↓
handleAction (action-handler.ts:497)
    ↓
req.body / req.request.formData()  ← 外部数据
    ↓
decodeReply / decodeReplyFromBusboy
    ↓
resolveField (key, value)  ← key 和 value 来自 HTTP
    ↓
resolveModelChunk (chunk, value)  ← value 来自 HTTP
    ↓
getChunk → createResolvedModelChunk
    ↓
initializeModelChunk
    ↓
JSON.parse(resolvedModel)  ← 解析外部 JSON 字符串
    ↓
reviveModel (遍历 JSON 对象的属性)
    ↓
parseModelString (key 来自 JSON 属性名)
    ↓
getOutlinedModel → waitForReference
    ↓
fulfillReference
    ↓
parentObject[key] = reference  ← 如果 key === "__proto__"，污染原型链！
```

## 安全结论

### ✅ 确认：数据来自外部 HTTP 请求

1. **入口点**: `handleAction` 函数接收 `BaseNextRequest`（HTTP 请求对象）
2. **数据来源**: 
   - POST 请求体（`req.body`）
   - FormData（`req.request.formData()`）
   - multipart/form-data（通过 busboy 解析）
3. **攻击向量**: 攻击者可以发送包含 `{"__proto__": {...}}` 的 JSON 数据
4. **风险等级**: **高** - 数据完全来自外部，可被攻击者控制

### 攻击场景

攻击者可以发送以下 HTTP POST 请求：

```http
POST /_next/action HTTP/1.1
Content-Type: application/x-www-form-urlencoded

0={"__proto__":{"polluted":"value"}}
```

或者：

```http
POST /_next/action HTTP/1.1
Content-Type: multipart/form-data; boundary=----WebKitFormBoundary

------WebKitFormBoundary
Content-Disposition: form-data; name="0"

{"__proto__":{"polluted":"value"}}
------WebKitFormBoundary--
```

这些数据会：
1. 被 `decodeReply` 解析
2. 通过 `resolveField` 进入系统
3. 被 `JSON.parse` 解析
4. 在 `reviveModel` 中遍历属性
5. 如果属性名是 `__proto__`，最终在 `fulfillReference` 中污染原型链

## 修复验证

我们已经在以下位置添加了防护：

1. **第一层防护** (`reviveModel`): 过滤危险键，防止进入后续流程
2. **第二层防护** (`fulfillReference`): 即使危险键通过第一层，也会被阻止

这确保了即使攻击者发送包含 `__proto__` 的 JSON，也会被阻止，无法污染原型链。
