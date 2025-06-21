import express from 'express';
import axios, { AxiosError } from 'axios';
import { Request, Response, NextFunction } from 'express';

const router = express.Router();
const SPOTIFY_API_BASE = 'https://api.spotify.com/v1';
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';

// Enhanced authentication middleware with detailed logging
const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
  console.log('\n=== REQUIRE AUTH MIDDLEWARE ===');
  console.log('Timestamp:', new Date().toISOString());
  console.log('Request:', req.method, req.path);
  console.log('Session ID:', req.sessionID);
  console.log('Request Origin:', req.headers.origin);
  console.log('Request cookies:', req.headers.cookie);
  
  // Check if session exists
  if (!req.session) {
    console.log('❌ NO SESSION OBJECT');
    return res.status(401).json({ 
      error: 'No session found. Please log in again.',
      debug: { sessionExists: false, sessionID: req.sessionID }
    });
  }

  console.log('✅ Session exists');
  console.log('Session data:', JSON.stringify(req.session, null, 2));

  // Check for refresh token (most important)
  if (!req.session.refresh_token) {
    console.log('❌ NO REFRESH TOKEN');
    return res.status(401).json({ 
      error: 'No refresh token found. Please log in again.',
      debug: { 
        sessionExists: true, 
        sessionID: req.sessionID,
        hasRefreshToken: false,
        sessionKeys: Object.keys(req.session)
      }
    });
  }

  console.log('✅ Refresh token exists');

  // Check access token and expiration
  const hasAccessToken = !!req.session.access_token;
  const isTokenExpired = !req.session.token_expires_at || Date.now() >= req.session.token_expires_at - 60000;

  console.log('Access token status:');
  console.log('- Has access token:', hasAccessToken);
  console.log('- Token expires at:', req.session.token_expires_at);
  console.log('- Current time:', Date.now());
  console.log('- Is expired:', isTokenExpired);

  // If we have a valid access token, proceed
  if (hasAccessToken && !isTokenExpired) {
    console.log('✅ Access token is valid, proceeding');
    console.log('=== END REQUIRE AUTH ===\n');
    return next();
  }

  // Need to refresh the token
  console.log('🔄 Access token expired/missing, refreshing...');
  
  try {
    const response = await axios.post(
      SPOTIFY_TOKEN_URL,
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: req.session.refresh_token,
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${Buffer.from(
            `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
          ).toString('base64')}`,
        },
      }
    );

    const { access_token, expires_in, refresh_token } = response.data;
    console.log('✅ Token refreshed successfully');
    
    // Update session with new token
    req.session.access_token = access_token;
    req.session.token_expires_at = Date.now() + expires_in * 1000;
    
    // Update refresh token if provided
    if (refresh_token) {
      req.session.refresh_token = refresh_token;
      console.log('✅ Refresh token updated');
    }

    console.log('Updated session data:', JSON.stringify(req.session, null, 2));

    // Save session and proceed
    req.session.save((err) => {
      if (err) {
        console.error('❌ Error saving session after token refresh:', err);
        return res.status(500).json({ error: 'Failed to save session after refresh.' });
      }
      
      console.log('✅ Session saved after token refresh');
      console.log('=== END REQUIRE AUTH ===\n');
      next();
    });

  } catch (error) {
    console.error('❌ Failed to refresh token:', error);
    
    if (axios.isAxiosError(error)) {
      console.error('Spotify refresh error:', error.response?.data);
      console.error('Status:', error.response?.status);
    }
    
    // Destroy invalid session
    req.session.destroy((err) => {
      if (err) {
        console.error('❌ Failed to destroy session after refresh failure:', err);
      }
      
      res.status(401).json({ 
        error: 'Token refresh failed. Please log in again.',
        debug: { refreshFailed: true }
      });
    });
  }
};

// Generic error handler for API routes
const handleApiError = (error: unknown, res: Response, context: string) => {
  console.error(`❌ Error fetching ${context}:`, error);
  
  if (error instanceof AxiosError && error.response) {
    console.error('Spotify API error details:', error.response.data);
    return res.status(error.response.status).json({
      error: `Failed to fetch ${context} from Spotify.`,
      spotify_error: error.response.data
    });
  }
  
  res.status(500).json({ error: `Failed to fetch ${context}.` });
};

// All API routes are protected by the requireAuth middleware
router.use(requireAuth);

// Get user's top tracks
router.get('/top-tracks', async (req: Request, res: Response) => {
  try {
    const { time_range = 'medium_term', limit = 20 } = req.query;
    console.log(`Fetching top tracks: time_range=${time_range}, limit=${limit}`);
    
    const response = await axios.get(
      `${SPOTIFY_API_BASE}/me/top/tracks?time_range=${time_range}&limit=${limit}`,
      { headers: { 'Authorization': `Bearer ${req.session.access_token}` } }
    );
    
    console.log(`✅ Top tracks fetched: ${response.data.items?.length} tracks`);
    res.json(response.data);
  } catch (error) {
    handleApiError(error, res, 'top tracks');
  }
});

// Get user's top artists
router.get('/top-artists', async (req: Request, res: Response) => {
  try {
    const { time_range = 'medium_term', limit = 20 } = req.query;
    console.log(`Fetching top artists: time_range=${time_range}, limit=${limit}`);
    
    const response = await axios.get(
      `${SPOTIFY_API_BASE}/me/top/artists?time_range=${time_range}&limit=${limit}`,
      { headers: { 'Authorization': `Bearer ${req.session.access_token}` } }
    );
    
    console.log(`✅ Top artists fetched: ${response.data.items?.length} artists`);
    res.json(response.data);
  } catch (error) {
    handleApiError(error, res, 'top artists');
  }
});

// Get user's recently played tracks
router.get('/recently-played', async (req: Request, res: Response) => {
  try {
    const { limit = 20 } = req.query;
    console.log(`Fetching recently played: limit=${limit}`);
    
    const response = await axios.get(
      `${SPOTIFY_API_BASE}/me/player/recently-played?limit=${limit}`,
      { headers: { 'Authorization': `Bearer ${req.session.access_token}` } }
    );
    
    console.log(`✅ Recently played fetched: ${response.data.items?.length} tracks`);
    res.json(response.data);
  } catch (error) {
    handleApiError(error, res, 'recently played tracks');
  }
});

// Get current user's profile
router.get('/me', async (req: Request, res: Response) => {
  try {
    console.log('Fetching user profile');
    console.log('Session user data:', req.session.user);
    
    const response = await axios.get(
      `${SPOTIFY_API_BASE}/me`,
      { headers: { 'Authorization': `Bearer ${req.session.access_token}` } }
    );
    
    console.log('✅ User profile fetched:', response.data.id, response.data.display_name);
    
    // Merge Spotify data with session data
    res.json({ 
      ...response.data, 
      sessionUser: req.session.user,
      sessionID: req.sessionID
    });
  } catch (error) {
    handleApiError(error, res, 'user profile');
  }
});

export const apiRouter = router; 