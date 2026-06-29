const express = require('express');
const router = express.Router();
const {
  createBooking,
  getMyBookings,
  getAvailability,
  cancelBooking
} = require('../controllers/bookingController');
const { protect } = require('../middlewares/authMiddleware');

router.use(protect);

router.post('/', createBooking);
router.get('/my', getMyBookings);
router.get('/availability', getAvailability);
router.put('/:id/cancel', cancelBooking);

module.exports = router;
