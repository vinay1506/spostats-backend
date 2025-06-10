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
  console.log('Callback received:', {
    query: req.query,
    redirectUri: process.env.SPOTIFY_REDIRECT_URI,
    frontendUrl: process.env.FRONTEND_URL,
    state: req.query.state
  });

  // Verify state parameter
  if (req.query.state !== 'spostats-auth') {
    console.error('Invalid state parameter:', req.query.state);
    return res.status(400).json({ error: 'Invalid state parameter' });
  }

  const { code } = req.query;

  if (!code) {
    console.error('No code provided in callback');
    return res.status(400).json({ error: 'No code provided' });
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

    // Store tokens in session
    req.session.access_token = access_token;
    req.session.refresh_token = refresh_token;
    req.session.token_expires_at = Date.now() + (expires_in * 1000);

    // Return success response
    res.json({ 
      status: 'success',
      message: 'Authentication successful',
      data: {
        access_token,
        expires_in,
        token_type: 'Bearer'
      }
    });
  } catch (error) {
    console.error('Error during token exchange:', error);
    res.status(500).json({ 
      status: 'error',
      message: 'Authentication failed',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
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
  const refresh_token = req.session.refresh_token;

  if (!refresh_token) {
    return res.status(401).json({ error: 'No refresh token available' });
  }

  try {
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
    
    req.session.access_token = access_token;
    req.session.token_expires_at = Date.now() + (expires_in * 1000);

    res.json({ access_token });
  } catch (error) {
    console.error('Error refreshing token:', error);
    res.status(500).json({ error: 'Could not refresh token' });
  }
});

export const authRouter = router; 