import express from 'express';
import axios from 'axios';
import { Request, Response } from 'express';

const router = express.Router();

// Middleware to check authentication
const requireAuth = (req: Request, res: Response, next: Function) => {
  if (!req.session.access_token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
};

// Get user's top tracks
router.get('/top-tracks', requireAuth, async (req: Request, res: Response) => {
  try {
    const response = await axios.get('https://api.spotify.com/v1/me/top/tracks', {
      headers: {
        'Authorization': `Bearer ${req.session.access_token}`
      },
      params: {
        limit: 50,
        time_range: req.query.time_range || 'medium_term'
      }
    });

    res.json(response.data);
  } catch (error) {
    console.error('Error fetching top tracks:', error);
    res.status(500).json({ error: 'Failed to fetch top tracks' });
  }
});

// Get user's top artists
router.get('/top-artists', requireAuth, async (req: Request, res: Response) => {
  try {
    const response = await axios.get('https://api.spotify.com/v1/me/top/artists', {
      headers: {
        'Authorization': `Bearer ${req.session.access_token}`
      },
      params: {
        limit: 50,
        time_range: req.query.time_range || 'medium_term'
      }
    });

    res.json(response.data);
  } catch (error) {
    console.error('Error fetching top artists:', error);
    res.status(500).json({ error: 'Failed to fetch top artists' });
  }
});

// Get user's recently played tracks
router.get('/recently-played', requireAuth, async (req: Request, res: Response) => {
  try {
    const response = await axios.get('https://api.spotify.com/v1/me/player/recently-played', {
      headers: {
        'Authorization': `Bearer ${req.session.access_token}`
      },
      params: {
        limit: 50
      }
    });

    res.json(response.data);
  } catch (error) {
    console.error('Error fetching recently played:', error);
    res.status(500).json({ error: 'Failed to fetch recently played tracks' });
  }
});

export const statsRouter = router; 