import * as dns from 'dns';
import { INestApplication, ValidationPipe } from '@nestjs/common';

/**
 * 强制 Node 的 DNS 解析器使用可靠支持 SRV 记录查询的公共 DNS，
 * 以满足 `mongodb+srv://` 连接串的解析需求。
 *
 * 许多家用路由器和国内 ISP DNS 会静默丢弃 SRV 查询或直接超时，
 * 导致 Mongoose 在发现 Atlas 分片主机时出现 `querySrv ETIMEOUT`。
 * Vercel 运行时的 DNS 通常没有这个问题，因此这里在那边基本等同于无操作，
 * 但保留也没有副作用。
 *
 * 如需覆盖，可通过环境变量设置 `DNS_SERVERS=1.1.1.1,8.8.8.8`。
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
    // `setServers` 遇到非法地址会抛错，这里静默回退到默认行为。
  }
}

ensureDnsServers();

/**
 * 本地独立启动入口（`main.ts`）与 Vercel serverless handler
 * 共用的 Nest 应用配置。
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
