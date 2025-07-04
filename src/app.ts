import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import { authRouter } from './routes/auth';
import { apiRouter } from './routes/api';

// Load environment variables
dotenv.config();

const app = express();

// Trust the first proxy for secure cookies in production (e.g., on Vercel)
app.set('trust proxy', 1);

// Middleware
app.use(express.json());
app.use(cookieParser());

const allowedOrigins = [
  'https://spotracker-nine.vercel.app', // Your production frontend
  process.env.FRONTEND_URL, // From your .env file
  'http://localhost:3000' // For local development
].filter(Boolean) as string[]; // Filter out undefined values

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) === -1) {
      const msg = `The CORS policy for this site does not allow access from the specified Origin: ${origin}`;
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Enhanced logging middleware
app.use((req, res, next) => {
  console.log(`\n=== REQUEST DEBUG ===`);
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  console.log('Cookies:', req.headers.cookie);
  console.log('Origin:', req.headers.origin);
  console.log('User-Agent:', req.headers['user-agent']);
  console.log('======================\n');
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Routes
app.use('/auth', authRouter);
app.use('/api', apiRouter);

// Error handling middleware
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled Error:', err.stack);
  res.status(500).json({ 
    status: 'error',
    message: process.env.NODE_ENV === 'production' 
      ? 'Internal server error' 
      : err.message 
  });
});

export default app;