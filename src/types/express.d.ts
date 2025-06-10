import 'express-session';

declare module 'express-session' {
  interface SessionData {
    access_token?: string;
    refresh_token?: string;
    token_expires_at?: number;
    user?: {
      id: string;
      display_name: string;
      email: string;
    };
  }
} 