import express from 'express';
import axios, { AxiosError } from 'axios';
import { Request, Response, NextFunction } from 'express';
import { JWTSessionManager } from '../utils/jwtSession';

const router = express.Router();
const SPOTIFY_API_BASE = 'https://api.spotify.com/v1';
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';

// Authentication middleware using JWT
const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
  console.log('\n=== REQUIRE AUTH MIDDLEWARE ===');
  console.log('Timestamp:', new Date().toISOString());
  console.log('Request:', req.method, req.path);
  console.log('Origin:', req.headers.origin);

  // Get session from JWT
  const sessionData = JWTSessionManager.getSession(req);
  
  if (!sessionData) {
    console.log('❌ NO SESSION DATA');
    return res.status(401).json({ 
      error: 'No session found. Please log in again.',
      code: 'NO_SESSION'
    });
  }

  console.log('✅ Session data found');
  console.log('Session contains:', {
    user: !!sessionData.user,
    access_token: !!sessionData.access_token,
    refresh_token: !!sessionData.refresh_token
  });

  // Check for refresh token
  if (!sessionData.refresh_token) {
    console.log('❌ NO REFRESH TOKEN');
    return res.status(401).json({ 
      error: 'Authentication expired. Please log in again.',
      code: 'NO_REFRESH_TOKEN'
    });
  }

  console.log('✅ Refresh token exists');

  // Check access token validity
  const hasAccessToken = !!sessionData.access_token;
  const isTokenExpired = !sessionData.token_expires_at || 
    Date.now() >= sessionData.token_expires_at - 60000;

  console.log('Token status:', { hasAccessToken, isTokenExpired });

  // If access token is valid, proceed
  if (hasAccessToken && !isTokenExpired) {
    console.log('✅ Valid access token, proceeding');
    console.log('=== END REQUIRE AUTH ===\n');
    
    // Attach session data to request for use in route handlers
    (req as any).sessionData = sessionData;
    return next();
  }

  // Need to refresh the token
  console.log('🔄 Access token expired/missing, refreshing...');
  
  try {
    const response = await axios.post(
      SPOTIFY_TOKEN_URL,
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: sessionData.refresh_token,
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${Buffer.from(
            `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
          ).toString('base64')}`,
        },
        timeout: 10000
      }
    );

    const { access_token, expires_in, refresh_token } = response.data;
    console.log('✅ Token refreshed successfully');
    
    // Update session with new token
    const updatedSessionData = {
      ...sessionData,
      access_token,
      token_expires_at: Date.now() + expires_in * 1000
    };
    
    // Update refresh token if provided
    if (refresh_token) {
      updatedSessionData.refresh_token = refresh_token;
      console.log('✅ Refresh token updated');
    }

    // Save updated session
    JWTSessionManager.createSession(res, updatedSessionData);

    console.log('✅ Session updated with new tokens');
    console.log('=== END REQUIRE AUTH ===\n');
    
    // Attach session data to request
    (req as any).sessionData = updatedSessionData;
    next();

  } catch (error) {
    console.error('❌ Failed to refresh token:', error);
    
    if (axios.isAxiosError(error)) {
      console.error('Spotify refresh error:', error.response?.data);
      console.error('Status:', error.response?.status);
    }
    
    // Clear invalid session
    JWTSessionManager.clearSession(res);
    
    res.status(401).json({ 
      error: 'Token refresh failed. Please log in again.',
      code: 'REFRESH_FAILED'
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
    const sessionData = (req as any).sessionData;
    
    console.log(`Fetching top tracks: time_range=${time_range}, limit=${limit}`);
    
    const response = await axios.get(
      `${SPOTIFY_API_BASE}/me/top/tracks?time_range=${time_range}&limit=${limit}`,
      { 
        headers: { 'Authorization': `Bearer ${sessionData.access_token}` },
        timeout: 10000 
      }
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
    const sessionData = (req as any).sessionData;
    
    console.log(`Fetching top artists: time_range=${time_range}, limit=${limit}`);
    
    const response = await axios.get(
      `${SPOTIFY_API_BASE}/me/top/artists?time_range=${time_range}&limit=${limit}`,
      { 
        headers: { 'Authorization': `Bearer ${sessionData.access_token}` },
        timeout: 10000 
      }
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
    const sessionData = (req as any).sessionData;
    
    console.log(`Fetching recently played: limit=${limit}`);
    
    const response = await axios.get(
      `${SPOTIFY_API_BASE}/me/player/recently-played?limit=${limit}`,
      { 
        headers: { 'Authorization': `Bearer ${sessionData.access_token}` },
        timeout: 10000 
      }
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
    const sessionData = (req as any).sessionData;
    
    console.log('Fetching user profile');
    
    const response = await axios.get(
      `${SPOTIFY_API_BASE}/me`,
      { 
        headers: { 'Authorization': `Bearer ${sessionData.access_token}` },
        timeout: 10000 
      }
    );
    
    console.log('✅ User profile fetched:', response.data.id, response.data.display_name);
    
    // Return Spotify data merged with session data
    res.json({ 
      ...response.data, 
      sessionUser: sessionData.user,
      tokenExpiresAt: sessionData.token_expires_at
    });
  } catch (error) {
    handleApiError(error, res, 'user profile');
  }
});

export const apiRouter = router; 