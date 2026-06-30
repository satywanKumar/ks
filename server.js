const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const fileUpload = require('express-fileupload');
const dotenv = require('dotenv');
const connectDB = require('./config/db');
const { errorHandler } = require('./middlewares/errorMiddleware');

// Route Imports
const authRoutes = require('./routes/authRoutes');
const bookingRoutes = require('./routes/bookingRoutes');
const adminRoutes = require('./routes/adminRoutes');

// Load environment variables
dotenv.config();

// Connect to Database
connectDB();

const app = express();

// Security Middlewares
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: false,
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      "img-src": ["'self'", "data:", "https://res.cloudinary.com"],
    },
  },
}));
app.use(cors({
  origin: true,
  credentials: true
}));

// Logging Middleware
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// Body Parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// File Upload Middleware
app.use(fileUpload({
  limits: { fileSize: 5 * 1024 * 1024 }, // Limit file size to 5MB
  abortOnLimit: true,
  responseOnLimit: 'File size limit exceeded (Max 5MB).'
}));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/admin', adminRoutes);

// Base route for welcome & health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'KS Self Study Zone Booking API is running.' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'KS Self Study Zone Booking Server is running.' });
});

// 404 Route handler
app.use('*', (req, res, next) => {
  res.status(404);
  next(new Error(`Not Found - ${req.originalUrl}`));
});

// Centralized Error Handling Middleware
app.use(errorHandler);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
});
