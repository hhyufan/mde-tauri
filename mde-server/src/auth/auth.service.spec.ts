import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { createHash } from 'crypto';

describe('AuthService refresh rotation', () => {
  const user = {
    _id: { toString: () => '507f1f77bcf86cd799439011' },
    email: 'user@example.com',
    username: 'user',
    avatar: null,
    refreshTokens: [],
  };

  it('rotates a valid refresh token and returns a short-lived access token', async () => {
    const oldToken = 'a'.repeat(64);
    const users = {
      findByRefreshTokenHash: jest.fn().mockResolvedValue({
        ...user,
        refreshTokens: [{ tokenHash: createHash('sha256').update(oldToken).digest('hex'), expiresAt: new Date(Date.now() + 60_000) }],
      }),
      rotateRefreshToken: jest.fn().mockResolvedValue(true),
    };
    const jwt = { sign: jest.fn().mockReturnValue('access') };
    const service = new AuthService(users as any, jwt as any);

    const result = await service.refreshToken(oldToken);

    expect(result.access_token).toBe('access');
    expect(result.expiresIn).toBe(900);
    expect(result.refreshToken).not.toBe(oldToken);
    expect(users.rotateRefreshToken).toHaveBeenCalledTimes(1);
  });

  it('rejects an expired refresh token', async () => {
    const users = {
      findByRefreshTokenHash: jest.fn().mockResolvedValue({
        ...user,
        refreshTokens: [{ tokenHash: 'missing', expiresAt: new Date(0) }],
      }),
    };
    const service = new AuthService(users as any, { sign: jest.fn() } as any);
    await expect(service.refreshToken('b'.repeat(64))).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
