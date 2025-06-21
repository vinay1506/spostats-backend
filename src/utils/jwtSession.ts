import jwt from 'jsonwebtoken';
import { Request, Response } from 'express';

interface SessionData {
  access_token?: string;
  refresh_token?: string;
  token_expires_at?: number;
  user?: {
    id: string;
    display_name: string;
    email: string;
    image?: string;
  };
}

interface JWTPayload {
  sessionData: SessionData;
  iat: number;
  exp: number;
}

const JWT_COOKIE_NAME = 'spotracker_session';
const JWT_SECRET = process.env.SESSION_SECRET || 'fallback-secret-key-change-in-production';
const JWT_EXPIRES_IN = '24h';

export class JWTSessionManager {
  // Create and set session cookie
  static createSession(res: Response, sessionData: SessionData): void {
    try {
      const token = jwt.sign(
        { sessionData },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
      );

      const cookieOptions = {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' as const : 'lax' as const,
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        path: '/'
      };

      res.cookie(JWT_COOKIE_NAME, token, cookieOptions);
      console.log('✅ JWT session created and cookie set');
    } catch (error) {
      console.error('❌ Error creating JWT session:', error);
      throw new Error('Failed to create session');
    }
  }

  // Get session data from cookie
  static getSession(req: Request): SessionData | null {
    try {
      const token = req.cookies[JWT_COOKIE_NAME];
      if (!token) {
        console.log('No JWT session cookie found');
        return null;
      }
      const decoded = jwt.verify(token, JWT_SECRET) as JWTPayload;
      console.log('✅ JWT session decoded successfully');
      console.log('Session data keys:', Object.keys(decoded.sessionData));
      return decoded.sessionData;
    } catch (error) {
      if ((error as any) instanceof jwt.JsonWebTokenError) {
        console.log('❌ Invalid JWT session token:', (error as any).message);
      } else {
        console.error('❌ Error decoding JWT session:', error);
      }
      return null;
    }
  }

  // Update session data
  static updateSession(req: Request, res: Response, sessionData: SessionData): void {
    try {
      // Merge with existing session data
      const existingSession = this.getSession(req) || {};
      const updatedSession = { ...existingSession, ...sessionData };
      this.createSession(res, updatedSession);
      console.log('✅ JWT session updated');
    } catch (error) {
      console.error('❌ Error updating JWT session:', error);
      throw new Error('Failed to update session');
    }
  }

  // Clear session
  static clearSession(res: Response): void {
    res.clearCookie(JWT_COOKIE_NAME, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      path: '/'
    });
    console.log('✅ JWT session cleared');
  }

  // Check if session is valid and not expired
  static isSessionValid(sessionData: SessionData | null): boolean {
    if (!sessionData) return false;
    const hasTokens = !!(sessionData.access_token && sessionData.refresh_token);
    const isNotExpired = sessionData.token_expires_at ? 
      Date.now() < sessionData.token_expires_at - 60000 : false; // 1 minute buffer
    return hasTokens && (isNotExpired || !!sessionData.refresh_token);
  }
} 