import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import express, { Express, json, urlencoded } from 'express';
import type { IncomingMessage, ServerResponse } from 'http';
import { AppModule } from './app.module';
import { setupApp } from './setup';

/**
 * Single entry point for the NestJS service.
 *
 * - Locally (no Vercel runtime detected) we call `expressApp.listen()` so
 *   developers can run `npm run start:dev` exactly as before.
 * - On Vercel the module exports a default handler. Vercel's NestJS framework
 *   preset auto-discovers this default export and uses it as the function
 *   entry, which is why we no longer need `api/index.ts`.
 */

const expressApp: Express = express();
// Body limits raised so larger sync payloads (gzip-compressed file blobs)
// don't trip Express's default 100kb cap. Vercel itself imposes its own
// per-request body cap (~4.5MB Hobby / ~5MB Pro) that we cannot override
// here — the client therefore uploads one file per request and gzips
// payloads before sending.
expressApp.use(json({ limit: '50mb' }));
expressApp.use(urlencoded({ limit: '50mb', extended: true }));

let bootstrapPromise: Promise<Express> | null = null;

async function bootstrap(): Promise<Express> {
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
  if (!bootstrapPromise) {
    bootstrapPromise = bootstrap();
  }
  const app = await bootstrapPromise;
  app(req as any, res as any);
}
