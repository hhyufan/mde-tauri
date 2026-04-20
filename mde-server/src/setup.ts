import * as dns from 'dns';
import { INestApplication, ValidationPipe } from '@nestjs/common';

/**
 * Force Node's DNS resolver to use public DNS servers that reliably support
 * SRV record lookups required by `mongodb+srv://` connection strings.
 *
 * Many home routers and Chinese ISP DNS servers silently drop or time out
 * on SRV queries, which manifests as `querySrv ETIMEOUT` when Mongoose
 * tries to discover Atlas shard hosts. Vercel's runtime DNS is fine, so
 * this is a no-op there in practice, but harmless.
 *
 * Override by setting `DNS_SERVERS=1.1.1.1,8.8.8.8` in the environment.
 */
function ensureDnsServers(): void {
  const fromEnv = process.env.DNS_SERVERS?.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const servers = fromEnv?.length
    ? fromEnv
    : ['1.1.1.1', '8.8.8.8', '223.5.5.5'];
  try {
    dns.setServers(servers);
  } catch {
    // setServers throws on malformed addresses; fall back silently.
  }
}

ensureDnsServers();

/**
 * Shared Nest application configuration used by both the local
 * standalone bootstrap (`main.ts`) and the Vercel serverless
 * handler (`api/index.ts`).
 */
export function setupApp(app: INestApplication): void {
  app.use((req, res, next) => {
    if (req.path.startsWith('/sync')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.setHeader('Surrogate-Control', 'no-store');
    }
    next();
  });

  app.enableCors({
    origin: true,
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );
}
