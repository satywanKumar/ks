const Booking = require('../models/Booking');
const Seat = require('../models/Seat');
const AuditLog = require('../models/AuditLog');
const CloudinaryFile = require('../models/CloudinaryFile');
const { allocateSeat, normalizeDate } = require('../services/seatAllocator');
const { calculateFee } = require('../utils/feeCalculator');
const { uploadToCloudinary } = require('../services/cloudinaryService');

/**
 * @desc    Create a new booking (auto assigns seat)
 * @route   POST /api/bookings
 * @access  Private
 */
const createBooking = async (req, res, next) => {
  try {
    const { date, slots } = req.body;

    if (!date || !slots) {
      return res.status(400).json({ success: false, message: 'Please provide booking date and slots' });
    }

    // Parse slots
    let parsedSlots = [];
    if (typeof slots === 'string') {
      parsedSlots = slots.split(',').map(s => parseInt(s.trim()));
    } else if (Array.isArray(slots)) {
      parsedSlots = slots.map(s => parseInt(s));
    } else {
      parsedSlots = [parseInt(slots)];
    }

    if (parsedSlots.some(isNaN) || parsedSlots.length === 0) {
      return res.status(400).json({ success: false, message: 'Invalid slots provided' });
    }

    // Check if user already has an active booking on this date overlapping with these slots
    const targetDate = normalizeDate(date);
    const existingUserBooking = await Booking.findOne({
      user: req.user._id,
      date: targetDate,
      status: { $in: ['Approved', 'Pending'] },
      slots: { $in: parsedSlots }
    });

    if (existingUserBooking) {
      return res.status(400).json({
        success: false,
        message: 'You already have a Pending/Approved booking for one or more of these slots on this date.'
      });
    }

    // Check files for payment screenshot
    if (!req.files || !req.files.paymentScreenshot) {
      return res.status(400).json({ success: false, message: 'Please upload a payment screenshot' });
    }

    // Auto-allocate Seat
    const assignedSeat = await allocateSeat(targetDate, parsedSlots, req.user.gender, req.user.preparationCategory);
    if (!assignedSeat) {
      return res.status(400).json({
        success: false,
        message: 'No seats available for the selected slots on this date. Try other slots or dates.'
      });
    }

    // Calculate auto fee
    const fee = calculateFee(parsedSlots);

    // Upload payment screenshot to Cloudinary
    const screenshotFile = req.files.paymentScreenshot;
    let cloudinaryResult;
    try {
      cloudinaryResult = await uploadToCloudinary(screenshotFile.data, 'payment_screenshots');
    } catch (uploadError) {
      console.error('Cloudinary upload failure:', uploadError);
      return res.status(500).json({ success: false, message: 'Failed to upload payment screenshot. Please try again.' });
    }

    // Create the booking
    const booking = await Booking.create({
      user: req.user._id,
      seat: assignedSeat._id,
      slots: parsedSlots,
      date: targetDate,
      fee,
      status: 'Pending',
      paymentScreenshot: {
        secure_url: cloudinaryResult.secure_url,
        public_id: cloudinaryResult.public_id
      },
      bookedAt: new Date(),
      paymentUploadedAt: new Date(),
      lastEditedAt: new Date(),
      modifiedBy: req.user._id
    });

    // Save CloudinaryFile log
    await CloudinaryFile.create({
      secure_url: cloudinaryResult.secure_url,
      public_id: cloudinaryResult.public_id,
      fileName: screenshotFile.name,
      uploadedBy: req.user._id
    });

    // Create Audit Log
    await AuditLog.create({
      action: 'CREATE_BOOKING',
      oldData: null,
      newData: booking.toObject(),
      changedBy: req.user._id,
      bookingId: booking._id
    });

    res.status(201).json({
      success: true,
      message: 'Booking request submitted successfully! Pending admin approval.',
      booking: await booking.populate('seat')
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get current user's bookings
 * @route   GET /api/bookings/my
 * @access  Private
 */
const getMyBookings = async (req, res, next) => {
  try {
    const bookings = await Booking.find({ user: req.user._id })
      .populate('seat')
      .sort({ date: -1, createdAt: -1 });

    res.json({
      success: true,
      bookings
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get detailed seat grid availability for a given date and slots
 * @route   GET /api/bookings/availability
 * @access  Private
 */
const getAvailability = async (req, res, next) => {
  try {
    const { date, slots } = req.query;

    if (!date) {
      return res.status(400).json({ success: false, message: 'Date query parameter is required' });
    }

    const targetDate = normalizeDate(date);
    
    // Parse slots
    let parsedSlots = [];
    if (slots) {
      if (typeof slots === 'string') {
        parsedSlots = slots.split(',').map(s => parseInt(s.trim()));
      } else if (Array.isArray(slots)) {
        parsedSlots = slots.map(s => parseInt(s));
      }
    }

    // Default to check all slots [1, 2, 3, 4] if not specified
    if (parsedSlots.length === 0) {
      parsedSlots = [1, 2, 3, 4];
    }

    // Get all active seats
    const seats = await Seat.find({ status: 'active' }).sort({ seatNumber: 1 });

    // Fetch active bookings for this date
    const activeBookings = await Booking.find({
      date: targetDate,
      status: { $in: ['Approved', 'Pending'] }
    });

    // Create a map of seatId -> slots occupancy on this date
    // Structure: { seatId: { slotNumber: 'Approved' | 'Pending' } }
    const occupancyMap = {};
    activeBookings.forEach(b => {
      const seatId = b.seat.toString();
      if (!occupancyMap[seatId]) {
        occupancyMap[seatId] = {};
      }
      b.slots.forEach(slot => {
        // Approved takes precedence over Pending for display
        if (!occupancyMap[seatId][slot] || occupancyMap[seatId][slot] === 'Pending') {
          occupancyMap[seatId][slot] = b.status;
        }
      });
    });

    // Construct the status grid for each seat for the SELECTED slots
    const seatGrid = seats.map(seat => {
      const seatId = seat._id.toString();
      const slotsOccupancy = occupancyMap[seatId] || {};

      // Determine overall seat state for the selected slots
      // If the seat is occupied by any of the checked slots:
      // - If any slot is 'Approved', state is 'Booked'
      // - If no slot is 'Approved' but some are 'Pending', state is 'Pending'
      // - If no slot is booked or pending, state is 'Available'
      let state = 'Available';
      let approvedCount = 0;
      let pendingCount = 0;

      parsedSlots.forEach(slot => {
        if (slotsOccupancy[slot] === 'Approved') {
          approvedCount++;
        } else if (slotsOccupancy[slot] === 'Pending') {
          pendingCount++;
        }
      });

      if (approvedCount > 0) {
        state = 'Booked';
      } else if (pendingCount > 0) {
        state = 'Pending';
      }

      return {
        _id: seat._id,
        seatNumber: seat.seatNumber,
        isReservedForGirls: seat.isReservedForGirls,
        slotsOccupancy: parsedSlots.map(slot => ({
          slot,
          status: slotsOccupancy[slot] || 'Available'
        })),
        overallState: state
      };
    });

    // Filter seat metrics matching user's gender
    const isFemale = req.user.gender === 'Female';
    const eligibleSeats = isFemale 
      ? seatGrid 
      : seatGrid.filter(s => !s.isReservedForGirls);

    const totalSeatsCount = eligibleSeats.length;
    const occupiedSeatsCount = eligibleSeats.filter(s => s.overallState === 'Booked').length;
    const pendingSeatsCount = eligibleSeats.filter(s => s.overallState === 'Pending').length;
    const availableSeatsCount = totalSeatsCount - occupiedSeatsCount - pendingSeatsCount;

    res.json({
      success: true,
      date: targetDate,
      checkedSlots: parsedSlots,
      metrics: {
        total: totalSeatsCount,
        available: availableSeatsCount,
        pending: pendingSeatsCount,
        booked: occupiedSeatsCount
      },
      seats: seatGrid // Send all seats so frontend can render the full layout with indicators
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Cancel user's own booking
 * @route   PUT /api/bookings/:id/cancel
 * @access  Private
 */
const cancelBooking = async (req, res, next) => {
  try {
    const booking = await Booking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    // Verify ownership
    if (booking.user.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Not authorized to cancel this booking' });
    }

    if (booking.status === 'Cancelled' || booking.status === 'Rejected') {
      return res.status(400).json({ success: false, message: `Booking is already ${booking.status}` });
    }

    const oldBookingData = booking.toObject();

    // Update status
    booking.status = 'Cancelled';
    booking.cancelledAt = new Date();
    booking.lastEditedAt = new Date();
    booking.modifiedBy = req.user._id;

    await booking.save();

    // Audit Log
    await AuditLog.create({
      action: 'CANCEL_BOOKING',
      oldData: oldBookingData,
      newData: booking.toObject(),
      changedBy: req.user._id,
      bookingId: booking._id
    });

    res.json({
      success: true,
      message: 'Booking cancelled successfully',
      booking
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createBooking,
  getMyBookings,
  getAvailability,
  cancelBooking
};
