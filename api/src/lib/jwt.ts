import jwt, { type SignOptions } from 'jsonwebtoken';

import { env } from '@/config/env';
import { unauthorized } from './errors';

/**
 * 'provider' is a service provider — a barber, cleaner or plumber who comes to
 * the customer. Its own actor rather than a flag on vendor: a vendor sells
 * stock and a provider sells time, and they sign into different screens.
 */
export type Actor = 'customer' | 'rider' | 'vendor' | 'admin' | 'provider';

export type TokenPayload = {
  sub: string;
  actor: Actor;
};

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN,
  } as SignOptions);
}

export function verifyToken(token: string): TokenPayload {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET);
    if (typeof decoded === 'string' || !decoded.sub || !('actor' in decoded)) {
      throw unauthorized('Malformed token.');
    }
    return { sub: String(decoded.sub), actor: decoded.actor as Actor };
  } catch {
    throw unauthorized('Your session has expired. Please sign in again.');
  }
}
