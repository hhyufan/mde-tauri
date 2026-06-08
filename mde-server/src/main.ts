import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import express, { Express, json, urlencoded } from 'express';
import type { IncomingMessage, ServerResponse } from 'http';
import { AppModule } from './app.module';
import { setupApp } from './setup';

/**
 * NestJS 服务的统一入口。
 *
 * - 本地运行时（未检测到 Vercel 环境）会直接调用 `expressApp.listen()`，
 *   这样开发者仍可像以前一样使用 `npm run start:dev`。
 * - 在 Vercel 上，本模块导出默认 handler。Vercel 的 NestJS 框架预设会
 *   自动发现这个默认导出并将其作为函数入口，因此不再需要 `api/index.ts`。
 */

const expressApp: Express = express();
expressApp.set('etag', false);
// 提高请求体大小限制，避免较大的同步载荷（gzip 压缩后的文件内容）
// 触发 Express 默认的 100kb 上限。Vercel 仍有自己的单请求体积限制
// （Hobby 约 4.5MB，Pro 约 5MB），这里无法覆盖，因此客户端会按单文件
// 逐次上传，并在发送前先压缩载荷。
expressApp.use(json({ limit: '50mb' }));
expressApp.use(urlencoded({ limit: '50mb', extended: true }));

// 在多次 serverless 调用间复用，避免每个请求都重新初始化 Nest。
let bootstrapPromise: Promise<Express> | null = null;

async function bootstrap(): Promise<Express> {
  // 将 Nest 挂载到共享的 Express 实例上，确保本地与 serverless 路径行为一致。
  const app = await NestFactory.create(
    AppModule,
    new ExpressAdapter(expressApp),
    { logger: ['error', 'warn', 'log'] },
  );
  setupApp(app);
  await app.init();
  return expressApp;
}

const isServerless = Boolean(
  process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME,
);

if (!isServerless) {
  // 本地开发仍直接启动 HTTP 监听，而不是只导出 handler。
  bootstrap()
    .then(() => {
      const port = Number(process.env.PORT) || 3200;
      expressApp.listen(port, () => {
        console.log(`MDE Server running on http://localhost:${port}`);
      });
    })
    .catch((err) => {
      console.error('Failed to bootstrap MDE Server:', err);
      process.exit(1);
    });
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  // 首次调用 serverless 函数时再惰性初始化 Nest 应用。
  if (!bootstrapPromise) {
    bootstrapPromise = bootstrap();
  }
  const app = await bootstrapPromise;
  app(req as any, res as any);
}
