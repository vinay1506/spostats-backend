import express from 'express';
import axios, { AxiosError } from 'axios';
import { Request, Response, NextFunction } from 'express';

const router = express.Router();
const SPOTIFY_API_BASE = 'https://api.spotify.com/v1';
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';

// Middleware to check authentication and refresh token if necessary
const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
  // Enhanced logging for debugging session issues
  console.log('--- requireAuth Middleware ---');
  console.log('Timestamp:', new Date().toISOString());
  console.log('Session ID:', req.sessionID);
  console.log('Request Origin:', req.headers.origin);
  console.log('Session Exists:', !!req.session);
  console.log('Session Data:', JSON.stringify(req.session, null, 2));
  console.log('--- End of Session Debug ---');

  // 1. Check if refresh token exists. If not, user needs to log in.
  if (!req.session || !req.session.refresh_token) {
    console.log('Auth check failed: No session or no refresh token found.');
    // The error message is updated for clarity on the frontend.
    return res.status(401).json({ error: 'Session expired or token is invalid. Please log in again.' });
  }

  // 2. Check if access token exists and is not expired.
  const isTokenExpired = !req.session.token_expires_at || Date.now() >= req.session.token_expires_at - 60000;

  if (req.session.access_token && !isTokenExpired) {
    console.log('Access token is valid.');
    return next();
  }

  // 3. If access token is missing or expired, try to refresh it.
  console.log('Access token expired or missing. Attempting to refresh...');
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
    console.log('Token refreshed successfully.');

    // Update session with the new token details
    req.session.access_token = access_token;
    req.session.token_expires_at = Date.now() + expires_in * 1000;
    // Spotify may return a new refresh token, so we should update it if provided.
    if (refresh_token) {
      req.session.refresh_token = refresh_token;
    }

    // Save the session and proceed
    req.session.save((err) => {
      if (err) {
        console.error('Error saving session after token refresh:', err);
        return res.status(500).json({ error: 'Failed to save session after refresh.' });
      }
      console.log('Session saved. Proceeding with the request.');
      next();
    });
  } catch (error) {
    console.error('Failed to refresh Spotify token:', error);
    // If refresh fails, destroy the session to force re-login
    req.session.destroy((err) => {
        if (err) {
            console.error('Failed to destroy session after refresh failure.', err);
            return res.status(500).json({ error: 'Failed to process logout after token error.' });
        }
        res.status(401).json({ error: 'Your session has expired and token refresh failed. Please log in again.' });
    });
  }
};

// Generic error handler for API routes
const handleApiError = (error: unknown, res: Response, context: string) => {
    console.error(`Error fetching ${context}:`, error);
    if (error instanceof AxiosError && error.response) {
        return res.status(error.response.status).json({
            error: `Failed to fetch ${context} from Spotify.`,
            spotify_error: error.response.data
        });
    }
    res.status(500).json({ error: `Failed to fetch ${context}.` });
}

// All API routes are protected by the requireAuth middleware
router.use(requireAuth);

// Get user's top tracks
router.get('/top-tracks', async (req: Request, res: Response) => {
  try {
    const { time_range = 'medium_term', limit = 20 } = req.query;
    const response = await axios.get(
      `${SPOTIFY_API_BASE}/me/top/tracks?time_range=${time_range}&limit=${limit}`,
      { headers: { 'Authorization': `Bearer ${req.session.access_token}` } }
    );
    res.json(response.data);
  } catch (error) {
    handleApiError(error, res, 'top tracks');
  }
});

// Get user's top artists
router.get('/top-artists', async (req: Request, res: Response) => {
  try {
    const { time_range = 'medium_term', limit = 20 } = req.query;
    const response = await axios.get(
      `${SPOTIFY_API_BASE}/me/top/artists?time_range=${time_range}&limit=${limit}`,
      { headers: { 'Authorization': `Bearer ${req.session.access_token}` } }
    );
    res.json(response.data);
  } catch (error) {
    handleApiError(error, res, 'top artists');
  }
});

// Get user's recently played tracks
router.get('/recently-played', async (req: Request, res: Response) => {
  try {
    const { limit = 20 } = req.query;
    const response = await axios.get(
      `${SPOTIFY_API_BASE}/me/player/recently-played?limit=${limit}`,
      { headers: { 'Authorization': `Bearer ${req.session.access_token}` } }
    );
    res.json(response.data);
  } catch (error) {
    handleApiError(error, res, 'recently played tracks');
  }
});

// Get current user's profile
router.get('/me', async (req: Request, res: Response) => {
  console.log('Session in /me:', { sessionID: req.sessionID, user: req.session.user });
  try {
    const response = await axios.get(
      `${SPOTIFY_API_BASE}/me`,
      { headers: { 'Authorization': `Bearer ${req.session.access_token}` } }
    );
    // Also attach user details from our session which might be useful for the frontend
    res.json({ ...response.data, user: req.session.user });
  } catch (error) {
    handleApiError(error, res, 'user profile');
  }
});

export const apiRouter = router; 