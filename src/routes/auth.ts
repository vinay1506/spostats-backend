import express from 'express';
import axios from 'axios';
import { Request, Response } from 'express';

const router = express.Router();

// Spotify OAuth endpoints
const SPOTIFY_AUTH_URL = 'https://accounts.spotify.com/authorize';
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';

// Login route - redirects to Spotify
router.get('/login', (req: Request, res: Response) => {
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI;
  
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
    state: 'spostats-auth' // Add state parameter for security
  });

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
    console.log('Exchanging code for tokens...');
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
    console.log('Token exchange successful, expires in:', expires_in);

    // Store tokens in session with expiration
    req.session.access_token = access_token;
    req.session.refresh_token = refresh_token;
    req.session.token_expires_at = Date.now() + (expires_in * 1000);

    // Get user profile to store basic user info
    console.log('Fetching user profile...');
    const profileResponse = await axios.get('https://api.spotify.com/v1/me', {
      headers: {
        'Authorization': `Bearer ${access_token}`
      }
    });

    const { id, display_name, email } = profileResponse.data;
    req.session.user = { id, display_name, email };
    console.log('User profile fetched:', { id, display_name, email });

    // Save session before redirecting
    req.session.save((err) => {
      if (err) {
        console.error('Error saving session:', err);
        return res.redirect(`${process.env.FRONTEND_URL}/error?message=session_error`);
      }

      // Get the frontend URL from environment variable
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      
      // Create a temporary token for the frontend with expiration
      const tempToken = Buffer.from(JSON.stringify({
        access_token,
        expires_in,
        expires_at: Date.now() + (expires_in * 1000),
        user: { id, display_name, email }
      })).toString('base64');
      
      console.log('Redirecting to frontend with session established');
      // Redirect to frontend with temporary token
      res.redirect(`${frontendUrl}/auth/callback?token=${tempToken}`);
    });
  } catch (error) {
    console.error('Error during authentication:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.redirect(`${process.env.FRONTEND_URL}/error?message=${encodeURIComponent(errorMessage)}`);
  }
});

// Verify token endpoint for frontend
router.post('/verify', (req: Request, res: Response) => {
  const { token } = req.body;
  
  if (!token) {
    return res.status(400).json({ error: 'No token provided' });
  }

  try {
    const decoded = JSON.parse(Buffer.from(token, 'base64').toString());
    const { access_token, expires_in, user } = decoded;

    // Verify the token is still valid
    if (Date.now() >= (decoded.expires_at * 1000)) {
      return res.status(401).json({ error: 'Token expired' });
    }

    res.json({ 
      status: 'success',
      data: {
        access_token,
        expires_in,
        user
      }
    });
  } catch (error) {
    console.error('Error verifying token:', error);
    res.status(401).json({ error: 'Invalid token' });
  }
});

// Logout route
router.get('/logout', (req: Request, res: Response) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Error destroying session:', err);
      return res.status(500).json({ error: 'Could not log out' });
    }
    res.redirect(process.env.FRONTEND_URL!);
  });
});

// Refresh token route
router.post('/refresh', async (req: Request, res: Response) => {
  console.log('Token refresh requested:', {
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