const express = require('express');
const router = express.Router();
const { protect, admin } = require('../middlewares/authMiddleware');
const {
  getAllBookings,
  updateBookingStatus,
  editBooking,
  relocateSeat,
  createManualBooking,
  deleteBooking,
  getAllUsers,
  editUser,
  deleteUser,
  getSeatsStatus
} = require('../controllers/adminController');
const { getReports } = require('../controllers/reportController');
const { getAuditLogs } = require('../controllers/auditController');

// Secure all admin routes with protect & admin middlewares
router.use(protect);
router.use(admin);

// Booking Management
router.get('/bookings', getAllBookings);
router.post('/bookings/manual', createManualBooking);
router.put('/bookings/:id', editBooking);
router.put('/bookings/:id/status', updateBookingStatus);
router.put('/bookings/:id/relocate', relocateSeat);
router.delete('/bookings/:id', deleteBooking);

// User Management
router.get('/users', getAllUsers);
router.put('/users/:id', editUser);
router.delete('/users/:id', deleteUser);

// Seat Mapping
router.get('/seats', getSeatsStatus);

// Analytics & Audit
router.get('/reports', getReports);
router.get('/audit-logs', getAuditLogs);

module.exports = router;
