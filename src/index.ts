import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import dotenv from 'dotenv';
import { authRouter } from './routes/auth';
import { apiRouter } from './routes/api';

// Load environment variables
dotenv.config();

// Log environment configuration
console.log('Environment Configuration:');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('FRONTEND_URL:', process.env.FRONTEND_URL);
console.log('SPOTIFY_REDIRECT_URI:', process.env.SPOTIFY_REDIRECT_URI);

const app = express();

// Middleware
app.use(express.json());
app.use(cookieParser());
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? process.env.FRONTEND_URL 
    : true, // Allow all origins in development/testing
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Session configuration for serverless environment
const sessionConfig = {
  secret: process.env.SESSION_SECRET || 'your-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: 'lax' as const,
    domain: process.env.NODE_ENV === 'production' ? '.railway.app' : undefined
  },
  // In production, we'll use a more secure approach
  store: process.env.NODE_ENV === 'production' 
    ? new session.MemoryStore() // TODO: Replace with Redis or similar in production
    : new session.MemoryStore()
};

// Use session middleware
app.use(session(sessionConfig));

// Routes
app.use('/auth', authRouter);
app.use('/api', apiRouter);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Error handling middleware
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// Start the server
const PORT = process.env.PORT || 3000;
console.log('Starting server...');
console.log('Environment variables:');
console.log('- NODE_ENV:', process.env.NODE_ENV);
console.log('- PORT:', PORT);
console.log('- FRONTEND_URL:', process.env.FRONTEND_URL);
console.log('- SPOTIFY_REDIRECT_URI:', process.env.SPOTIFY_REDIRECT_URI);

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV}`);
  console.log('Server startup complete');
}).on('error', (err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

// Export for Vercel
export default app; 