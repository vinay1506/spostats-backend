import express from 'express';
import axios, { AxiosError } from 'axios';
import { Request, Response } from 'express';

const router = express.Router();
const SPOTIFY_API_BASE = 'https://api.spotify.com/v1';
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';

// Middleware to check if user is authenticated
const requireAuth = (req: Request, res: Response, next: express.NextFunction) => {
  console.log('requireAuth: Checking session', { sessionID: req.sessionID, accessToken: !!req.session.access_token });
  if (!req.session.access_token) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
};

// Helper function to handle Spotify API token refresh
const refreshToken = async (req: Request) => {
  const refresh_token = req.session.refresh_token;

  if (!refresh_token) {
    console.error('No refresh token available');
    throw new Error('No refresh token available');
  }

  console.log('Attempting to refresh token...');
  try {
    const response = await axios.post(
      SPOTIFY_TOKEN_URL,
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refresh_token,
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

    const { access_token, expires_in } = response.data;
    console.log('Token refreshed successfully.');

    req.session.access_token = access_token;
    req.session.token_expires_at = Date.now() + expires_in * 1000;
    
    // It's good practice to also update the refresh token if a new one is sent
    if (response.data.refresh_token) {
      req.session.refresh_token = response.data.refresh_token;
    }

    await new Promise((resolve, reject) => {
        req.session.save(err => {
            if (err) return reject(err);
            resolve(null);
        });
    });

    return access_token;
  } catch (error) {
    console.error('Error refreshing Spotify token:', error);
    // If refresh fails, clear the session tokens to force re-login
    req.session.access_token = undefined;
    req.session.refresh_token = undefined;
    req.session.token_expires_at = undefined;
    await new Promise((resolve, reject) => {
        req.session.save(err => {
            if (err) return reject(err);
            resolve(null);
        });
    });
    throw new Error('Failed to refresh token');
  }
};

// Helper function to make authenticated Spotify API calls
const spotifyRequest = async (req: Request, endpoint: string) => {
  // Check if token is expired or close to expiring
  if (req.session.token_expires_at && Date.now() >= req.session.token_expires_at - 60000) {
    console.log('Token expired or about to expire, refreshing...');
    await refreshToken(req);
  }

  try {
    console.log(`Making Spotify API request to: ${endpoint}`);
    const response = await axios.get(`${SPOTIFY_API_BASE}${endpoint}`, {
      headers: {
        'Authorization': `Bearer ${req.session.access_token}`
      }
    });
    return response.data;
  } catch (error) {
    const axiosError = error as AxiosError;
    if (axiosError.response && axiosError.response.status === 401) {
        console.log('Spotify API returned 401, attempting to refresh token...');
        try {
            await refreshToken(req);
            // Retry the request with the new token
            console.log(`Retrying Spotify API request to: ${endpoint}`);
            const response = await axios.get(`${SPOTIFY_API_BASE}${endpoint}`, {
                headers: { 'Authorization': `Bearer ${req.session.access_token}` }
            });
            return response.data;
        } catch (refreshError) {
            console.error('Failed to refresh token, user needs to re-authenticate.');
            throw new Error('Spotify token refresh failed.');
        }
    }
    console.error('Spotify API error:', error);
    throw error;
  }
};

// Get user's top tracks
router.get('/top-tracks', requireAuth, async (req: Request, res: Response) => {
  try {
    const { time_range = 'medium_term', limit = 20 } = req.query;
    const data = await spotifyRequest(
      req,
      `/me/top/tracks?time_range=${time_range}&limit=${limit}`
    );
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch top tracks' });
  }
});

// Get user's top artists
router.get('/top-artists', requireAuth, async (req: Request, res: Response) => {
  try {
    const { time_range = 'medium_term', limit = 20 } = req.query;
    const data = await spotifyRequest(
      req,
      `/me/top/artists?time_range=${time_range}&limit=${limit}`
    );
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch top artists' });
  }
});

// Get user's recently played tracks
router.get('/recently-played', requireAuth, async (req: Request, res: Response) => {
  try {
    const { limit = 20 } = req.query;
    const data = await spotifyRequest(
      req,
      `/me/player/recently-played?limit=${limit}`
    );
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch recently played tracks' });
  }
});

// Get current user's profile
router.get('/me', requireAuth, async (req: Request, res: Response) => {
  console.log('Session in /me:', { sessionID: req.sessionID, user: req.session.user });
  try {
    const data = await spotifyRequest(
      req,
      '/me'
    );
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch user profile' });
  }
});

export const apiRouter = router; 