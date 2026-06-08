# 在云同步中jwt身份验证模块的具体文档

## 1. 这篇文档讲什么

这篇文档专门解释当前项目在云同步场景下，JWT 身份验证模块是如何工作的。

重点不是泛泛介绍 JWT 概念，而是结合当前项目源码，讲清楚下面这条真实链路：

`登录/注册 -> 前端保存 access_token -> Axios 自动注入 Bearer -> 后端 JwtAuthGuard/JwtStrategy 校验 -> /sync/* 接口拿到 req.user -> SyncService 按 userId 处理数据`

也就是说，这篇文档关注的是“JWT 如何服务于云同步”，而不是单独讲认证模块。

---

## 2. 整体架构：云同步本身不处理 JWT，鉴权被下沉到了公共层

当前项目的设计不是让 `syncEngine` 自己拼 JWT，也不是让每个同步接口单独校验 token，而是把这部分能力拆到了两端的公共层：

- 前端公共层：[`useAuthStore.js`](../src/store/useAuthStore.js#L29-L119) 和 [`apiClient.js`](../src/services/apiClient.js#L70-L107)
- 后端公共层：[`auth.module.ts`](../mde-server/src/auth/auth.module.ts#L14-L32)、[`jwt.strategy.ts`](../mde-server/src/auth/strategies/jwt.strategy.ts#L12-L24)、[`jwt-auth.guard.ts`](../mde-server/src/auth/guards/jwt-auth.guard.ts#L4-L6)
- 同步模块只负责业务：[`sync.controller.ts`](../mde-server/src/sync/sync.controller.ts#L28-L67) 和 [`sync.service.ts`](../mde-server/src/sync/sync.service.ts)

所以真正理解这套实现的关键，不是盯着某一个同步接口看，而是理解下面两件事：

1. 前端怎么自动带 token
2. 后端怎么把 Bearer Token 转成 `req.user`

---

## 3. 前端登录后是怎么拿到 JWT 的

登录和注册成功后，前端都会把服务端返回的 `access_token` 写入 Zustand store 和 Tauri 本地存储。

代码位置：[useAuthStore.js:L54-L68](../src/store/useAuthStore.js#L54-L68)

```js
login: async (email, password) => {
  set({ loading: true });
  try {
    const { data } = await apiClient.post('/auth/login', { email, password });
    set({ user: data.user, token: data.access_token, isLoggedIn: true, loading: false });
    const store = await getTauriStore();
    await store.set('token', data.access_token);
    await store.set('user', data.user);
    await store.save();
    return data;
  } catch (err) {
    set({ loading: false });
    throw err;
  }
},
```

注册也是同样逻辑，代码位置：[useAuthStore.js:L73-L87](../src/store/useAuthStore.js#L73-L87)。

这说明前端的 JWT 会有两份状态：

- 内存态：`useAuthStore` 里的 `token`
- 持久化状态：Tauri Store 中的 `token`

这样应用重启后，仍然可以恢复登录态。

---

## 4. 应用启动后怎么恢复 JWT 会话

项目启动时，前端会尝试从本地持久化里恢复 token 和用户信息。

代码位置：[useAuthStore.js:L38-L49](../src/store/useAuthStore.js#L38-L49)

```js
loadToken: async () => {
  try {
    const store = await getTauriStore();
    const token = await store.get('token');
    const user = await store.get('user');
    if (token && user) {
      set({ token, user, isLoggedIn: true });
    }
  } catch {
    // 开发中的浏览器环境可能没有 Tauri store，这里静默降级。
  }
},
```

应用挂载时会调用这段逻辑，相关位置在 [App.jsx:L123-L139](../src/App.jsx#L123-L139)。

这一步做完之后，后面的同步请求就不需要重新登录才能带上 Bearer Token。

---

## 5. 前端是怎么把 JWT 自动带到云同步请求里的

真正给请求注入 `Authorization: Bearer <token>` 的地方不在 `syncEngine`，而在 Axios 实例的请求拦截器里。

代码位置：[apiClient.js:L70-L88](../src/services/apiClient.js#L70-L88)

```js
apiClient.interceptors.request.use((config) => {
  config.baseURL = getApiBaseUrl();
  const token = useAuthStore.getState().token;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  if (
    typeof config.url === 'string' &&
    config.url.startsWith('/sync/') &&
    String(config.method || 'get').toLowerCase() === 'get'
  ) {
    config.headers['Cache-Control'] = 'no-cache, no-store, max-age=0';
    config.headers.Pragma = 'no-cache';
    config.headers.Expires = '0';
  }
  return config;
});
```

这里有两个关键点：

- 只要 `useAuthStore` 里有 `token`，就会自动注入 Bearer Token
- 对 `/sync/*` 的 GET 请求还额外禁用了缓存，防止增量同步状态被中间层缓存污染

这意味着云同步模块本身根本不需要自己拼请求头，它只要调用 `apiClient` 即可。

---

## 6. `syncEngine` 为什么看起来没有写 JWT 代码

云同步总入口在 [syncEngine.js:L1153-L1189](../src/services/syncEngine.js#L1153-L1189)。

代码位置：[syncEngine.js:L1153-L1169](../src/services/syncEngine.js#L1153-L1169)

```js
async fullSync() {
  if (!useAuthStore.getState().isLoggedIn || !useConfigStore.getState().syncEnabled) {
    return;
  }
  if (this.syncing) return;
  this.syncing = true;
  this.setStatus('syncing');
  try {
    await this.ensureLocalReset();
    await this.ensureRemoteProtocol();
    await this.syncConfig();
    const queueOk = await this.processQueue();
    if (queueOk) {
      await this.pullRemoteChanges();
      await this.syncConfig();
    }
```

这里能看到 `syncEngine` 只检查：

- `isLoggedIn`
- `syncEnabled`

但它没有自己处理 JWT 头。原因就是上一节说的：JWT 注入已经被下沉到 `apiClient` 拦截器里了。

这是一种比较干净的分层：

- `syncEngine` 负责同步时序
- `apiClient` 负责认证头和网络协议

---

## 7. 后端 JWT 是在哪里配置和签发的

后端 JWT 的配置入口在 [`auth.module.ts`](../mde-server/src/auth/auth.module.ts#L14-L32)。

代码位置：[auth.module.ts:L14-L25](../mde-server/src/auth/auth.module.ts#L14-L25)

```ts
@Module({
  imports: [
    UsersModule,
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET', 'mde-dev-secret'),
        signOptions: { expiresIn: config.get<string>('JWT_EXPIRES_IN', '7d') },
      }),
    }),
  ],
```

这说明：

- JWT 签名密钥来自环境变量 `JWT_SECRET`
- 过期时间来自环境变量 `JWT_EXPIRES_IN`
- 默认过期时间是 `7d`

真正签发 token 的地方在 [`auth.service.ts`](../mde-server/src/auth/auth.service.ts#L18-L68)。

代码位置：[auth.service.ts:L56-L67](../mde-server/src/auth/auth.service.ts#L56-L67)

```ts
private buildTokenResponse(user: any) {
  const payload = { sub: user._id.toString(), email: user.email };
  return {
    access_token: this.jwtService.sign(payload),
    user: {
      id: user._id.toString(),
      email: user.email,
      username: user.username,
      avatar: user.avatar,
    },
  };
}
```

这里可以看出当前 JWT payload 里至少包含两项：

- `sub`：用户 ID
- `email`：用户邮箱

---

## 8. 登录、注册、刷新接口是怎么工作的

后端认证控制器在 [`auth.controller.ts`](../mde-server/src/auth/auth.controller.ts#L15-L39)。

代码位置：[auth.controller.ts:L15-L39](../mde-server/src/auth/auth.controller.ts#L15-L39)

```ts
/** 注册新用户并返回初始访问令牌。 */
@Post('register')
async register(@Body() dto: RegisterDto) {
  return this.authService.register(dto);
}

/** 使用邮箱和密码登录。 */
@Post('login')
async login(@Body() dto: LoginDto) {
  return this.authService.login(dto.email, dto.password);
}

/** 基于当前已认证用户重新签发访问令牌。 */
@UseGuards(JwtAuthGuard)
@Post('refresh')
async refresh(@Request() req) {
  return this.authService.refreshToken(req.user.userId);
}
```

从这里能看出 3 件事：

- `register` 不只是创建用户，还会直接返回登录态
- `login` 使用邮箱密码换取 JWT
- `refresh` 受 `JwtAuthGuard` 保护，说明它不是“匿名拿 refresh token 换 access token”的典型双令牌模式

这点很重要，因为它影响你对整个系统的判断：这套实现更接近“仍然有效的 access_token 续签”，而不是真正的 access/refresh 双令牌机制。

---

## 9. JWT Bearer Token 在后端是怎么验证的

JWT 校验逻辑在 [`jwt.strategy.ts`](../mde-server/src/auth/strategies/jwt.strategy.ts#L12-L24)。

代码位置：[jwt.strategy.ts:L12-L23](../mde-server/src/auth/strategies/jwt.strategy.ts#L12-L23)

```ts
constructor(config: ConfigService) {
  super({
    jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
    ignoreExpiration: false,
    secretOrKey: config.get<string>('JWT_SECRET', 'mde-dev-secret'),
  });
}

/** 将 JWT 载荷转换成挂载到 `req.user` 上的认证上下文。 */
async validate(payload: { sub: string; email: string }) {
  return { userId: payload.sub, email: payload.email };
}
```

这段代码说明了整个后端鉴权的核心规则：

- token 只从 `Authorization: Bearer ...` 中提取
- `ignoreExpiration: false`，说明过期 token 不会被接受
- 验签成功后，`payload.sub` 会被转换成 `req.user.userId`

也就是说，后面的业务控制器并不会直接处理 JWT，而是统一使用 `req.user.userId`。

---

## 10. `JwtAuthGuard` 是怎么保护云同步接口的

守卫本身非常薄，只是复用了 Passport 的 JWT 策略。

代码位置：[jwt-auth.guard.ts:L4-L6](../mde-server/src/auth/guards/jwt-auth.guard.ts#L4-L6)

然后在同步控制器上统一挂载：

代码位置：[sync.controller.ts:L28-L29](../mde-server/src/sync/sync.controller.ts#L28-L29)

```ts
@UseGuards(JwtAuthGuard)
@Controller('sync')
export class SyncController {
```

这意味着 `/sync/*` 下所有接口都默认要求已经通过 JWT 验证。

后面每个同步接口都直接使用 `req.user.userId`：

代码位置：[sync.controller.ts:L33-L67](../mde-server/src/sync/sync.controller.ts#L33-L67)

```ts
/** 返回当前用户的云端文件清单，不包含正文。 */
@Get('manifest')
getManifest(@Request() req) {
  return this.syncService.getManifest(req.user.userId);
}

/** 单文件写入接口，供新版按版本号同步的客户端优先使用。 */
@Put('file/:fileId')
pushFile(@Request() req, @Param('fileId') fileId: string, @Body() dto: PushFileDto) {
  return this.syncService.pushFile(req.user.userId, fileId, dto);
}
```

这说明 JWT 在云同步模块里的真正作用不是“让同步逻辑懂 token”，而是“把用户身份可靠地变成 `userId` 传给同步服务层”。

---

## 11. 401 时前端是怎么做续签和重试的

Axios 响应拦截器里实现了一套 401 自动恢复逻辑。

代码位置：[apiClient.js:L90-L107](../src/services/apiClient.js#L90-L107)

```js
apiClient.interceptors.response.use(
  (res) => res,
  async (error) => {
    if (error.response?.status === 401) {
      const { token, refreshToken, logout } = useAuthStore.getState();
      if (token && !error.config._retried) {
        error.config._retried = true;
        try {
          await refreshToken();
          error.config.headers.Authorization = `Bearer ${useAuthStore.getState().token}`;
          return apiClient(error.config);
        } catch {
          logout();
        }
      }
    }
    return Promise.reject(error);
  },
);
```

这条链路的逻辑是：

1. 某个同步请求返回 401
2. 调用 `useAuthStore.refreshToken()`
3. 如果续签成功，用新的 Bearer Token 重放原请求
4. 如果续签失败，直接登出

而 `refreshToken()` 的前端实现是：

代码位置：[useAuthStore.js:L92-L103](../src/store/useAuthStore.js#L92-L103)

```js
refreshToken: async () => {
  try {
    const { data } = await apiClient.post('/auth/refresh');
    set({ token: data.access_token, user: data.user });
    const store = await getTauriStore();
    await store.set('token', data.access_token);
    await store.set('user', data.user);
    await store.save();
  } catch {
    get().logout();
  }
},
```

这里再次说明，前端没有维护独立 refresh token，只是请求了 `/auth/refresh`。

---

## 12. 这套“refresh”机制的一个重要结论

如果只看名字，很容易以为这里实现的是标准 refresh token 体系，但从源码看并不是。

证据有两条：

1. `/auth/refresh` 本身受 [`JwtAuthGuard`](../mde-server/src/auth/auth.controller.ts#L34-L39) 保护
2. [`jwt.strategy.ts:L15-L15`](../mde-server/src/auth/strategies/jwt.strategy.ts#L15-L15) 明确设置了 `ignoreExpiration: false`

这意味着：

- 只有当前 token 还有效时，`/auth/refresh` 才能通过鉴权
- 如果 access_token 已经过期，请求 `/auth/refresh` 本身也会失败

所以严格来说，这不是标准的双令牌机制，而是“基于仍然有效的 access_token 重新签发 access_token”的续签方案。

这个结论在做技术文档或论文分析时非常值得单独点出来。

---

## 13. 云同步请求和 JWT 的完整调用链

如果把整条链路串起来，当前项目的 JWT 鉴权流程是这样的：

1. 用户在 [`LoginModal.jsx`](../src/components/overlays/LoginModal.jsx#L37-L53) 中提交登录
2. 前端调用 [`useAuthStore.login()`](../src/store/useAuthStore.js#L54-L68)
3. 后端 [`AuthController.login`](../mde-server/src/auth/auth.controller.ts#L21-L25) -> [`AuthService.login`](../mde-server/src/auth/auth.service.ts#L42-L47)
4. `AuthService.buildTokenResponse()` 返回 `access_token`
5. 前端把 token 写入内存和 Tauri Store
6. `syncEngine.fullSync()` 发起同步请求时使用 `apiClient`
7. `apiClient` 自动注入 `Authorization: Bearer <token>`
8. 后端 `JwtAuthGuard` + `JwtStrategy` 验证 Bearer Token
9. 验证通过后生成 `req.user.userId`
10. `SyncController` 把 `userId` 传给 `SyncService`

也就是说，云同步里的“用户隔离”最终依赖的是 `req.user.userId`，而这个值来自 JWT payload 中的 `sub`。

---

## 14. 阅读这块代码时建议的顺序

如果你准备彻底吃透“云同步中的 JWT 身份验证”，建议按下面顺序阅读：

1. [useAuthStore.js:L54-L103](../src/store/useAuthStore.js#L54-L103)
   - 先看登录、注册、刷新和本地持久化
2. [apiClient.js:L70-L107](../src/services/apiClient.js#L70-L107)
   - 再看 Bearer 注入和 401 重试
3. [syncEngine.js:L1153-L1189](../src/services/syncEngine.js#L1153-L1189)
   - 看同步入口如何依赖登录态
4. [auth.module.ts:L14-L32](../mde-server/src/auth/auth.module.ts#L14-L32)
   - 看 JWT 模块怎么配置
5. [auth.service.ts:L42-L67](../mde-server/src/auth/auth.service.ts#L42-L67)
   - 看 JWT 怎么签发
6. [jwt.strategy.ts:L12-L23](../mde-server/src/auth/strategies/jwt.strategy.ts#L12-L23)
   - 看 Bearer Token 怎么变成 `req.user`
7. [sync.controller.ts:L28-L67](../mde-server/src/sync/sync.controller.ts#L28-L67)
   - 最后看同步接口如何消费认证上下文

---

## 15. 结论

当前项目的云同步 JWT 身份验证，本质上是一套标准的“前端 Bearer 注入 + 后端 Passport JWT 守卫”方案：

- 前端 `useAuthStore` 维护 token 和登录态
- `apiClient` 自动附带 Bearer Token，并负责 401 续签重试
- 后端 `JwtStrategy` 负责验签和提取用户身份
- `SyncController` 统一受 `JwtAuthGuard` 保护
- `SyncService` 最终只处理已经鉴权后的 `userId`

但这套实现还有一个需要明确说明的特征：

- 它没有独立 refresh token
- `/auth/refresh` 本质上是“已登录用户的 access_token 续签”

所以如果你后面要继续演进这块，最自然的升级方向就是把它改造成真正的 access token / refresh token 双令牌体系。现在这版足够简洁，但在严格意义上还不是完整的刷新令牌设计。
