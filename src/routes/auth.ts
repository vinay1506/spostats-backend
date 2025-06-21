import express from 'express';
import axios from 'axios';
import { Request, Response } from 'express';

const router = express.Router();

// Spotify OAuth endpoints
const SPOTIFY_AUTH_URL = 'https://accounts.spotify.com/authorize';
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';

// Extend session interface to include our custom properties
declare module 'express-session' {
  interface SessionData {
    access_token?: string;
    refresh_token?: string;
    token_expires_at?: number;
    user?: any;
  }
}

// Login route - redirects to Spotify
router.get('/login', (req: Request, res: Response) => {
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI?.trim();
  
  if (!redirectUri) {
    console.error('SPOTIFY_REDIRECT_URI is not set');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  console.log('=== LOGIN FLOW START ===');
  console.log('Session ID before login:', req.sessionID);
  console.log('Redirect URI:', redirectUri);

  const scope = [
    'user-read-private',
    'user-read-email',
    'user-top-read',
    'user-read-recently-played'
  ].join(' ');

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.SPOTIFY_CLIENT_ID!,
    scope: scope,
    redirect_uri: redirectUri,
    show_dialog: 'true',
    state: req.sessionID // Use session ID as state for verification
  });

  const authUrl = `${SPOTIFY_AUTH_URL}?${params.toString()}`;
  console.log('Redirecting to Spotify auth URL:', authUrl);
  
  res.redirect(authUrl);
});

// Debug endpoint to check environment variables
router.get('/debug-env', (req, res) => {
  res.json({
    frontendUrl: `"${process.env.FRONTEND_URL}"`, // Quotes will show spaces
    redirectUri: `"${process.env.SPOTIFY_REDIRECT_URI}"`,
    hasClientId: !!process.env.SPOTIFY_CLIENT_ID,
    nodeEnv: process.env.NODE_ENV
  });
});

// Debug endpoint for session
router.get('/debug-session', (req: Request, res: Response) => {
  console.log('=== SESSION DEBUG ===');
  console.log('Session ID:', req.sessionID);
  console.log('Session exists:', !!req.session);
  console.log('Session data:', JSON.stringify(req.session, null, 2));
  console.log('Session keys:', req.session ? Object.keys(req.session) : 'No session');
  
  res.json({
    sessionID: req.sessionID,
    sessionExists: !!req.session,
    sessionData: req.session || null,
    cookies: req.headers.cookie,
    origin: req.headers.origin,
    userAgent: req.headers['user-agent']
  });
});

// Callback route - handles the OAuth callback - COMPLETE IMPLEMENTATION
router.get('/callback', async (req: Request, res: Response) => {
  console.log('\n=== OAUTH CALLBACK START ===');
  console.log('Callback received with query:', req.query);
  console.log('Session ID in callback:', req.sessionID);
  console.log('Session data before processing:', JSON.stringify(req.session, null, 2));

  const { code, error } = req.query;

  if (error) {
    console.error('OAuth error:', error);
    return res.redirect(`${process.env.FRONTEND_URL}/error?message=${error}`);
  }

  if (!code) {
    console.error('No authorization code provided');
    return res.redirect(`${process.env.FRONTEND_URL}/error?message=no_code`);
  }

  try {
    console.log('Exchanging code for tokens...');
    
    const tokenResponse = await axios.post(SPOTIFY_TOKEN_URL, 
      new URLSearchParams({
        grant_type: 'authorization_code',
        code: code as string,
        redirect_uri: process.env.SPOTIFY_REDIRECT_URI!
      }), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${Buffer.from(
            `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
          ).toString('base64')}`
        },
        timeout: 10000
      }
    );

    const { access_token, refresh_token, expires_in } = tokenResponse.data;
    
    console.log('Token exchange successful!');
    console.log('Access token received:', !!access_token);
    console.log('Refresh token received:', !!refresh_token);
    console.log('Expires in:', expires_in);

    if (!access_token || !refresh_token) {
      console.error('❌ Missing tokens in response:', { access_token: !!access_token, refresh_token: !!refresh_token });
      return res.redirect(`${process.env.FRONTEND_URL}/error?message=invalid_tokens`);
    }

    const userResponse = await axios.get('https://api.spotify.com/v1/me', {
      headers: { 'Authorization': `Bearer ${access_token}` },
      timeout: 10000
    });

    const userProfile = userResponse.data;
    console.log('User profile fetched:', userProfile.id);

    if (!req.session) {
      console.error('❌ No session object available');
      return res.redirect(`${process.env.FRONTEND_URL}/error?message=no_session`);
    }

    req.session.access_token = access_token;
    req.session.refresh_token = refresh_token;
    req.session.token_expires_at = Date.now() + (expires_in * 1000);
    req.session.user = {
      id: userProfile.id,
      display_name: userProfile.display_name,
      email: userProfile.email,
      image: userProfile.images?.[0]?.url
    };

    console.log('Session data after token assignment:', {
      sessionID: req.sessionID,
      hasAccessToken: !!req.session.access_token,
      hasRefreshToken: !!req.session.refresh_token,
      tokenExpiresAt: req.session.token_expires_at,
      user: req.session.user?.id
    });

    await new Promise<void>((resolve, reject) => {
      req.session.save((err) => {
        if (err) {
          console.error('❌ Session save error:', err);
          reject(err);
        } else {
          console.log('✅ Session saved successfully');
          resolve();
        }
      });
    });

    console.log('Final verification - session contains:');
    console.log('- Access token:', !!req.session.access_token);
    console.log('- Refresh token:', !!req.session.refresh_token);
    console.log('- User data:', !!req.session.user);

    const frontendUrl = process.env.FRONTEND_URL?.trim();
    const redirectUrl = `${frontendUrl}/dashboard?auth=success`;
    console.log('Redirecting to:', redirectUrl);
    console.log('=== OAUTH CALLBACK COMPLETE ===\n');
    
    res.redirect(redirectUrl);

  } catch (error) {
    console.error('❌ OAuth callback error:', error);
    
    if (axios.isAxiosError(error)) {
      console.error('Axios error details:', {
        status: error.response?.status,
        data: error.response?.data,
        message: error.message
      });
    }
    
    res.redirect(`${process.env.FRONTEND_URL}/error?message=oauth_failed&details=${encodeURIComponent((error as any).message)}`);
  }
});

// Logout route
router.post('/logout', (req: Request, res: Response) => {
  console.log('=== LOGOUT ===');
  console.log('Session ID:', req.sessionID);
  
  req.session.destroy((err) => {
    if (err) {
      console.error('Error destroying session:', err);
      return res.status(500).json({ error: 'Failed to logout' });
    }
    
    console.log('Session destroyed successfully');
    res.clearCookie('spostats.sid');
    res.json({ success: true, message: 'Logged out successfully' });
  });
});

// Check auth status
router.get('/status', (req: Request, res: Response) => {
  console.log('=== AUTH STATUS CHECK ===');
  console.log('Session ID:', req.sessionID);
  console.log('Session exists:', !!req.session);
  console.log('Has access token:', !!req.session?.access_token);
  console.log('Has refresh token:', !!req.session?.refresh_token);
  console.log('Token expires at:', req.session?.token_expires_at);
  console.log('Current time:', Date.now());
  
  const isAuthenticated = !!(req.session?.access_token && req.session?.refresh_token);
  const tokenExpired = req.session?.token_expires_at ? Date.now() >= req.session.token_expires_at - 60000 : true;
  
  res.json({
    authenticated: isAuthenticated,
    tokenExpired: tokenExpired,
    user: req.session?.user,
    sessionID: req.sessionID,
    expiresAt: req.session?.token_expires_at
  });
});

// Refresh token route (can be called by frontend if needed)
router.post('/refresh', async (req: Request, res: Response) => {
  console.log('Token refresh requested from dedicated endpoint:', {
    sessionID: req.sessionID,
    hasRefreshToken: !!req.session.refresh_token,
    tokenExpiresAt: req.session.token_expires_at
  });

  const refresh_token = req.session.refresh_token;

  if (!refresh_token) {
    console.error('No refresh token available in session');
    return res.status(401).json({ error: 'No refresh token available' });
  }

  try {
    console.log('Refreshing token...');
    const response = await axios.post(SPOTIFY_TOKEN_URL,
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refresh_token
      }), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${Buffer.from(
            `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
          ).toString('base64')}`
        }
      }
    );

    const { access_token, expires_in } = response.data;
    console.log('Token refresh successful, expires in:', expires_in);
    
    // Update session with new token
    req.session.access_token = access_token;
    req.session.token_expires_at = Date.now() + (expires_in * 1000);

    // Save session before sending response
    req.session.save((err) => {
      if (err) {
        console.error('Error saving session during refresh:', err);
        return res.status(500).json({ error: 'Could not save session' });
      }

      res.json({
        message: 'Token refreshed successfully',
        access_token,
        expires_in,
        expires_at: req.session.token_expires_at
      });
    });
  } catch (error) {
    console.error('Error refreshing token:', error);
    res.status(500).json({ error: 'Could not refresh token' });
  }
});

// Set session from frontend token (for cross-origin session establishment)
router.post('/session', (req: Request, res: Response) => {
  // Expecting: { user, access_token, refresh_token, token_expires_at }
  const { user, access_token, refresh_token, token_expires_at } = req.body;

  Object.assign(req.session, {
    user,
    access_token,
    refresh_token,
    token_expires_at
  });

  console.log('--- /auth/session ---');
  console.log('Session after /auth/session:', JSON.stringify(req.session, null, 2));
  console.log('--- End /auth/session Debug ---');

  req.session.save((err) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to save session' });
    }
    res.json({ status: 'ok' });
  });
});

export const authRouter = router; 