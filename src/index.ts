import dotenv from 'dotenv';
import app from './app';

// Load environment variables from .env file
dotenv.config();

// Start the server
const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV}`);
  console.log(`Frontend URL: ${process.env.FRONTEND_URL}`);
  console.log('Server startup complete.');
}).on('error', (err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

// Export for serverless environments like Vercel
export default app; 