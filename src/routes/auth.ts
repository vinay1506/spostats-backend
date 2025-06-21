import express from 'express';
import axios from 'axios';
import { Request, Response } from 'express';

const router = express.Router();

// Spotify OAuth endpoints
const SPOTIFY_AUTH_URL = 'https://accounts.spotify.com/authorize';
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';

// Login route - redirects to Spotify
router.get('/login', (req: Request, res: Response) => {
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI?.trim();
  
  if (!redirectUri) {
    console.error('SPOTIFY_REDIRECT_URI is not set');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  console.log('Starting login flow with redirect URI:', redirectUri);

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
    state: 'spostats-auth'
  });

  // Ensure the URL is properly encoded
  const authUrl = `${SPOTIFY_AUTH_URL}?${params.toString()}`;
  console.log('Redirecting to Spotify auth URL:', authUrl);
  
  res.redirect(authUrl);
});

// Callback route - handles the OAuth callback
router.get('/callback', async (req: Request, res: Response) => {
  console.log('Auth callback received:', {
    query: req.query,
    cookies: req.cookies,
    sessionID: req.sessionID,
    redirectUri: process.env.SPOTIFY_REDIRECT_URI,
    frontendUrl: process.env.FRONTEND_URL,
    state: req.query.state
  });

  // Verify state parameter
  if (req.query.state !== 'spostats-auth') {
    console.error('Invalid state parameter:', req.query.state);
    return res.redirect(`${process.env.FRONTEND_URL}/error?message=invalid_state`);
  }

  const { code } = req.query;

  if (!code) {
    console.error('No code provided in callback');
    return res.redirect(`${process.env.FRONTEND_URL}/error?message=no_code`);
  }

  try {
    // Exchange code for access token
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
        }
      }
    );

    const { access_token, refresh_token, expires_in } = tokenResponse.data;

    // Get user profile to store basic user info
    const profileResponse = await axios.get('https://api.spotify.com/v1/me', {
      headers: {
        'Authorization': `Bearer ${access_token}`
      }
    });

    const { id, display_name, email } = profileResponse.data;
    
    // Assign data to the session object
    Object.assign(req.session, {
      access_token,
      refresh_token,
      token_expires_at: Date.now() + (expires_in * 1000),
      user: { id, display_name, email }
    });

    console.log('--- OAuth Callback ---');
    console.log('Session data being saved:', JSON.stringify(req.session, null, 2));
    console.log('--- End of OAuth Callback Debug ---');

    // Save session before redirecting
    req.session.save((err) => {
      if (err) {
        console.error('Error saving session:', err);
        return res.redirect(`${process.env.FRONTEND_URL}/error?message=session_error`);
      }

      // Construct the token payload for the frontend
      const tokenPayload = {
        access_token,
        refresh_token,
        expires_in,
        expires_at: req.session.token_expires_at,
        user: req.session.user
      };
      const token = Buffer.from(JSON.stringify(tokenPayload)).toString('base64');

      // Redirect to the correct frontend callback URL with the token
      const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:3000').trim();
      const redirectUrl = `${frontendUrl}/auth/callback?token=${encodeURIComponent(token)}`;
      console.log('Redirecting to:', redirectUrl);
      res.redirect(redirectUrl);
    });
  } catch (error) {
    console.error('Error during authentication:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.redirect(`${process.env.FRONTEND_URL}/error?message=${encodeURIComponent(errorMessage)}`);
  }
});

// Logout route
router.get('/logout', (req: Request, res: Response) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Error destroying session:', err);
      return res.status(500).json({ error: 'Could not log out' });
    }
    const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:3000').trim();
    res.redirect(frontendUrl);
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

export const authRouter = router; 