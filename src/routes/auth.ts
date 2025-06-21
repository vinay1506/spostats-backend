import express from 'express';
import axios from 'axios';
import { Request, Response } from 'express';
import { JWTSessionManager } from '../utils/jwtSession';

const router = express.Router();

// Spotify OAuth endpoints
const SPOTIFY_AUTH_URL = 'https://accounts.spotify.com/authorize';
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';

// Generate random state for OAuth security
function generateState(): string {
  return Math.random().toString(36).substring(2, 15) + 
         Math.random().toString(36).substring(2, 15);
}

// Login route - redirects to Spotify
router.get('/login', (req: Request, res: Response) => {
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI?.trim();
  
  if (!redirectUri) {
    console.error('SPOTIFY_REDIRECT_URI is not set');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  console.log('=== LOGIN FLOW START ===');
  console.log('Redirect URI:', redirectUri);

  const state = generateState();
  const scope = [
    'user-read-private',
    'user-read-email',
    'user-top-read',
    'user-read-recently-played'
  ].join(' ');

  // Store state in a temporary cookie for verification
  res.cookie('oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 10 * 60 * 1000, // 10 minutes
    path: '/'
  });

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.SPOTIFY_CLIENT_ID!,
    scope: scope,
    redirect_uri: redirectUri,
    show_dialog: 'true',
    state: state
  });

  const authUrl = `${SPOTIFY_AUTH_URL}?${params.toString()}`;
  console.log('Redirecting to Spotify auth URL');
  
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

// OAuth callback route
router.get('/callback', async (req: Request, res: Response) => {
  console.log('\n=== OAUTH CALLBACK START ===');
  console.log('Callback received with query:', req.query);

  const { code, state, error } = req.query;
  const storedState = req.cookies.oauth_state;

  // Handle OAuth errors
  if (error) {
    console.error('OAuth error:', error);
    return res.redirect(`${process.env.FRONTEND_URL}/error?message=${error}`);
  }

  // Verify state parameter
  if (!state || state !== storedState) {
    console.error('State mismatch or missing state');
    return res.redirect(`${process.env.FRONTEND_URL}/error?message=state_mismatch`);
  }

  if (!code) {
    console.error('No authorization code provided');
    return res.redirect(`${process.env.FRONTEND_URL}/error?message=no_code`);
  }

  try {
    console.log('Exchanging code for tokens...');
    
    // Exchange authorization code for access token
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
        timeout: 15000
      }
    );

    const { access_token, refresh_token, expires_in } = tokenResponse.data;
    
    if (!access_token || !refresh_token) {
      console.error('❌ Missing tokens from Spotify response');
      return res.redirect(`${process.env.FRONTEND_URL}/error?message=missing_tokens`);
    }

    console.log('✅ Token exchange successful');
    console.log('Access token length:', access_token.length);
    console.log('Refresh token length:', refresh_token.length);
    console.log('Expires in:', expires_in, 'seconds');

    // Get user profile from Spotify
    console.log('Fetching user profile...');
    const userResponse = await axios.get('https://api.spotify.com/v1/me', {
      headers: { 'Authorization': `Bearer ${access_token}` },
      timeout: 10000
    });

    const userProfile = userResponse.data;
    console.log('✅ User profile fetched:', userProfile.id, userProfile.display_name);

    // Create session data
    const sessionData = {
      access_token,
      refresh_token,
      token_expires_at: Date.now() + (expires_in * 1000),
      user: {
        id: userProfile.id,
        display_name: userProfile.display_name,
        email: userProfile.email,
        image: userProfile.images?.[0]?.url
      }
    };

    // Create JWT session
    JWTSessionManager.createSession(res, sessionData);

    // Clear state cookie
    res.clearCookie('oauth_state');

    console.log('✅ Session created successfully');
    console.log('Session data:', {
      user_id: sessionData.user.id,
      has_access_token: !!sessionData.access_token,
      has_refresh_token: !!sessionData.refresh_token,
      expires_at: new Date(sessionData.token_expires_at).toISOString()
    });

    // Redirect to frontend
    const frontendUrl = process.env.FRONTEND_URL?.trim();
    const redirectUrl = `${frontendUrl}/dashboard?auth=success`;
    console.log('Redirecting to:', redirectUrl);
    console.log('=== OAUTH CALLBACK COMPLETE ===\n');
    
    res.redirect(redirectUrl);

  } catch (error) {
    console.error('❌ OAuth callback error:', error);
    
    if (axios.isAxiosError(error)) {
      console.error('Spotify API error:', error.response?.data);
      console.error('Status:', error.response?.status);
    }
    
    res.redirect(`${process.env.FRONTEND_URL}/error?message=oauth_failed`);
  }
});

// Logout route
router.post('/logout', (req: Request, res: Response) => {
  console.log('=== LOGOUT ===');
  JWTSessionManager.clearSession(res);
  res.json({ success: true, message: 'Logged out successfully' });
});

// Check auth status
router.get('/status', (req: Request, res: Response) => {
  console.log('=== AUTH STATUS CHECK ===');
  const sessionData = JWTSessionManager.getSession(req);
  const isValid = JWTSessionManager.isSessionValid(sessionData);
  console.log('Session status:', {
    hasSession: !!sessionData,
    isValid,
    hasAccessToken: !!sessionData?.access_token,
    hasRefreshToken: !!sessionData?.refresh_token,
    userId: sessionData?.user?.id
  });
  const tokenExpired = sessionData?.token_expires_at ? 
    Date.now() >= sessionData.token_expires_at - 60000 : true;
  res.json({
    authenticated: isValid,
    tokenExpired: tokenExpired,
    user: sessionData?.user,
    expiresAt: sessionData?.token_expires_at
  });
});

// Debug session endpoint
router.get('/debug-session', (req: Request, res: Response) => {
  console.log('=== SESSION DEBUG ===');
  const sessionData = JWTSessionManager.getSession(req);
  res.json({
    hasSession: !!sessionData,
    sessionData: sessionData ? {
      user: sessionData.user,
      hasAccessToken: !!sessionData.access_token,
      hasRefreshToken: !!sessionData.refresh_token,
      tokenExpiresAt: sessionData.token_expires_at,
      isExpired: sessionData.token_expires_at ? Date.now() >= sessionData.token_expires_at : true
    } : null,
    cookies: req.headers.cookie,
    timestamp: new Date().toISOString()
  });
});

export const authRouter = router; 