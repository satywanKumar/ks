const Booking = require('../models/Booking');
const Seat = require('../models/Seat');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const { normalizeDate } = require('../services/seatAllocator');
const { calculateFee } = require('../utils/feeCalculator');

/**
 * Helper to check if a seat is occupied on a target date and slots.
 * Excludes the current booking id if specified (for edits).
 */
const checkSeatOccupied = async (seatId, date, slots, excludeBookingId = null) => {
  const query = {
    seat: seatId,
    date: normalizeDate(date),
    status: { $in: ['Approved', 'Pending'] },
    slots: { $in: slots }
  };
  
  if (excludeBookingId) {
    query._id = { $ne: excludeBookingId };
  }

  const conflictingBookings = await Booking.find(query);
  return conflictingBookings.length > 0;
};

/**
 * @desc    Get all bookings (paginated, filtered, searchable)
 * @route   GET /api/admin/bookings
 * @access  Private/Admin
 */
const getAllBookings = async (req, res, next) => {
  try {
    const { page = 1, limit = 50, status, search, date, seatNumber } = req.query;
    const query = {};

    if (status) {
      query.status = status;
    }

    if (date) {
      query.date = normalizeDate(date);
    }

    if (seatNumber) {
      const seatObj = await Seat.findOne({ seatNumber: Number(seatNumber) });
      if (seatObj) {
        query.seat = seatObj._id;
      } else {
        query.seat = '000000000000000000000000';
      }
    }

    // Search by User Full Name, Email, or Phone
    if (search) {
      const matchedUsers = await User.find({
        $or: [
          { fullName: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } },
          { phone: { $regex: search, $options: 'i' } }
        ]
      }).select('_id');
      
      const userIds = matchedUsers.map(u => u._id);
      query.user = { $in: userIds };
    }

    const total = await Booking.countDocuments(query);
    const bookings = await Booking.find(query)
      .populate('user', '-password')
      .populate('seat')
      .sort({ date: -1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    res.json({
      success: true,
      total,
      page: Number(page),
      pages: Math.ceil(total / limit),
      bookings
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Approve/Reject/Cancel a booking
 * @route   PUT /api/admin/bookings/:id/status
 * @access  Private/Admin
 */
const updateBookingStatus = async (req, res, next) => {
  try {
    const { status } = req.body;
    
    if (!['Approved', 'Rejected', 'Cancelled'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status update' });
    }

    const booking = await Booking.findById(req.params.id);
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    const oldBookingData = booking.toObject();

    booking.status = status;
    
    if (status === 'Approved') {
      booking.approvedAt = new Date();
    } else if (status === 'Cancelled') {
      booking.cancelledAt = new Date();
    } else if (status === 'Rejected') {
      booking.status = 'Rejected'; // Rejection state
    }

    booking.lastEditedAt = new Date();
    booking.modifiedBy = req.user._id;

    await booking.save();

    // Audit Log
    await AuditLog.create({
      action: `${status.toUpperCase()}_BOOKING`,
      oldData: oldBookingData,
      newData: booking.toObject(),
      changedBy: req.user._id,
      bookingId: booking._id
    });

    res.json({
      success: true,
      message: `Booking status updated to ${status}`,
      booking: await booking.populate(['user', 'seat'])
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Edit booking details (slots, date, seat) with availability validation and force override
 * @route   PUT /api/admin/bookings/:id
 * @access  Private/Admin
 */
const editBooking = async (req, res, next) => {
  try {
    const { seatNumber, slots, date, forceAllocate } = req.body;
    const booking = await Booking.findById(req.params.id).populate('seat');
    
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    const oldBookingData = booking.toObject();
    let targetSeat = booking.seat;

    // Check if new seat number provided
    if (seatNumber && Number(seatNumber) !== booking.seat.seatNumber) {
      const newSeat = await Seat.findOne({ seatNumber: Number(seatNumber) });
      if (!newSeat) {
        return res.status(400).json({ success: false, message: 'Invalid seat number' });
      }
      targetSeat = newSeat;
    }

    const targetDate = date ? normalizeDate(date) : booking.date;
    const targetSlots = slots ? slots.map(Number) : booking.slots;

    // Validate availability
    const isOccupied = await checkSeatOccupied(targetSeat._id, targetDate, targetSlots, booking._id);

    if (isOccupied && !forceAllocate) {
      return res.json({
        success: false,
        isOccupied: true,
        message: 'Seat occupied. Proceed with force allocation?'
      });
    }

    // Gender check (unless force allocated)
    const user = await User.findById(booking.user);
    if (!forceAllocate && user && user.gender !== 'Female' && targetSeat.isReservedForGirls) {
      return res.status(400).json({
        success: false,
        message: 'Cannot allocate seats 18–23 to Male/Other users.'
      });
    }

    // Save details
    booking.seat = targetSeat._id;
    booking.date = targetDate;
    booking.slots = targetSlots;
    booking.fee = calculateFee(targetSlots);
    booking.lastEditedAt = new Date();
    booking.modifiedBy = req.user._id;

    await booking.save();

    // Audit Log
    await AuditLog.create({
      action: forceAllocate ? 'FORCE_EDIT_BOOKING' : 'EDIT_BOOKING',
      oldData: oldBookingData,
      newData: booking.toObject(),
      changedBy: req.user._id,
      bookingId: booking._id
    });

    res.json({
      success: true,
      message: 'Booking updated successfully',
      booking: await booking.populate(['user', 'seat'])
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Relocate a booking to a different seat
 * @route   PUT /api/admin/bookings/:id/relocate
 * @access  Private/Admin
 */
const relocateSeat = async (req, res, next) => {
  try {
    const { seatNumber, forceAllocate } = req.body;

    if (!seatNumber) {
      return res.status(400).json({ success: false, message: 'Please specify new seat number' });
    }

    const booking = await Booking.findById(req.params.id).populate('seat');
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    const newSeat = await Seat.findOne({ seatNumber: Number(seatNumber) });
    if (!newSeat) {
      return res.status(404).json({ success: false, message: 'Seat not found' });
    }

    // Gender Validation
    const user = await User.findById(booking.user);
    if (!forceAllocate && user && user.gender !== 'Female' && newSeat.isReservedForGirls) {
      return res.status(400).json({
        success: false,
        message: 'This seat is reserved only for girls.'
      });
    }

    // Check availability
    const isOccupied = await checkSeatOccupied(newSeat._id, booking.date, booking.slots, booking._id);
    if (isOccupied && !forceAllocate) {
      return res.json({
        success: false,
        isOccupied: true,
        message: 'Seat occupied. Proceed with force allocation?'
      });
    }

    const oldBookingData = booking.toObject();

    booking.seat = newSeat._id;
    booking.relocatedAt = new Date();
    booking.lastEditedAt = new Date();
    booking.modifiedBy = req.user._id;

    await booking.save();

    // Audit Log
    await AuditLog.create({
      action: forceAllocate ? 'FORCE_RELOCATE_SEAT' : 'RELOCATE_SEAT',
      oldData: oldBookingData,
      newData: booking.toObject(),
      changedBy: req.user._id,
      bookingId: booking._id
    });

    res.json({
      success: true,
      message: `Relocated booking successfully to Seat ${newSeat.seatNumber}`,
      booking: await booking.populate(['user', 'seat'])
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Direct manual booking by Admin
 * @route   POST /api/admin/bookings/manual
 * @access  Private/Admin
 */
const createManualBooking = async (req, res, next) => {
  try {
    const { userEmail, seatNumber, date, slots, forceAllocate } = req.body;

    if (!userEmail || !seatNumber || !date || !slots) {
      return res.status(400).json({ success: false, message: 'Missing required manual booking fields' });
    }

    const user = await User.findOne({ email: userEmail });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User with this email not found' });
    }

    const seat = await Seat.findOne({ seatNumber: Number(seatNumber) });
    if (!seat) {
      return res.status(404).json({ success: false, message: 'Seat not found' });
    }

    const targetDate = normalizeDate(date);
    const parsedSlots = slots.map(Number);

    // Gender check
    if (!forceAllocate && user.gender !== 'Female' && seat.isReservedForGirls) {
      return res.status(400).json({ success: false, message: 'Selected seat is reserved only for girls.' });
    }

    // Check availability
    const isOccupied = await checkSeatOccupied(seat._id, targetDate, parsedSlots);
    if (isOccupied && !forceAllocate) {
      return res.json({
        success: false,
        isOccupied: true,
        message: 'Seat occupied. Proceed with force allocation?'
      });
    }

    const fee = calculateFee(parsedSlots);

    const booking = await Booking.create({
      user: user._id,
      seat: seat._id,
      slots: parsedSlots,
      date: targetDate,
      fee,
      status: 'Approved', // Auto-approves manual booking
      paymentScreenshot: {
        secure_url: 'MANUAL_BY_ADMIN',
        public_id: 'MANUAL_BY_ADMIN'
      },
      bookedAt: new Date(),
      approvedAt: new Date(),
      lastEditedAt: new Date(),
      modifiedBy: req.user._id
    });

    // Audit Log
    await AuditLog.create({
      action: forceAllocate ? 'FORCE_MANUAL_BOOKING' : 'MANUAL_BOOKING',
      oldData: null,
      newData: booking.toObject(),
      changedBy: req.user._id,
      bookingId: booking._id
    });

    res.status(201).json({
      success: true,
      message: 'Manual booking created successfully',
      booking: await booking.populate(['user', 'seat'])
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Delete a booking permanently
 * @route   DELETE /api/admin/bookings/:id
 * @access  Private/Admin
 */
const deleteBooking = async (req, res, next) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    const oldBookingData = booking.toObject();
    await Booking.deleteOne({ _id: req.params.id });

    // Audit Log
    await AuditLog.create({
      action: 'DELETE_BOOKING',
      oldData: oldBookingData,
      newData: null,
      changedBy: req.user._id,
      bookingId: booking._id
    });

    res.json({
      success: true,
      message: 'Booking deleted permanently'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get all users list
 * @route   GET /api/admin/users
 * @access  Private/Admin
 */
const getAllUsers = async (req, res, next) => {
  try {
    const users = await User.find({}).select('-password').sort({ createdAt: -1 });
    res.json({ success: true, users });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Edit a user's details/role (including password)
 * @route   PUT /api/admin/users/:id
 * @access  Private/Admin
 */
const editUser = async (req, res, next) => {
  try {
    const { fullName, phone, gender, role, preparationCategory, pinCode, address, password } = req.body;
    const user = await User.findById(req.params.id);
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const oldUserData = user.toObject();

    if (fullName) user.fullName = fullName;
    if (phone) user.phone = phone;
    if (gender) user.gender = gender;
    if (role) user.role = role;
    if (preparationCategory) user.preparationCategory = preparationCategory;
    if (pinCode) user.pinCode = pinCode;
    if (address) user.address = address;
    if (password) user.password = password; // pre-save will auto hash this

    await user.save();

    // Audit Log
    await AuditLog.create({
      action: 'EDIT_USER',
      oldData: oldUserData,
      newData: user.toObject(),
      changedBy: req.user._id
    });

    res.json({
      success: true,
      message: 'User updated successfully',
      user
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Delete a user account and their bookings
 * @route   DELETE /api/admin/users/:id
 * @access  Private/Admin
 */
const deleteUser = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }


    const oldUserData = user.toObject();

    // 1. Find all user bookings to get their IDs and payment screenshot public IDs
    const bookings = await Booking.find({ user: user._id });
    const bookingIds = bookings.map(b => b._id);

    // 2. Import Cloudinary cleanup helper
    const CloudinaryFile = require('../models/CloudinaryFile');
    const { deleteFromCloudinary } = require('../services/cloudinaryService');

    // 3. Clean up Cloudinary assets from both direct bookings and logged CloudinaryFiles
    const publicIdsToDelete = new Set();

    bookings.forEach(b => {
      if (b.paymentScreenshot && b.paymentScreenshot.public_id && b.paymentScreenshot.public_id !== 'MANUAL_BY_ADMIN' && b.paymentScreenshot.public_id !== '') {
        publicIdsToDelete.add(b.paymentScreenshot.public_id);
      }
    });

    const loggedFiles = await CloudinaryFile.find({ uploadedBy: user._id });
    loggedFiles.forEach(f => {
      if (f.public_id) {
        publicIdsToDelete.add(f.public_id);
      }
    });

    // Delete assets from Cloudinary
    for (const publicId of publicIdsToDelete) {
      try {
        await deleteFromCloudinary(publicId);
      } catch (err) {
        console.error(`Failed to delete Cloudinary asset ${publicId} on user deletion:`, err);
      }
    }

    // 4. Delete DB entries for Bookings, CloudinaryFile logs, and AuditLogs
    await Booking.deleteMany({ user: user._id });
    await CloudinaryFile.deleteMany({ uploadedBy: user._id });
    await AuditLog.deleteMany({
      $or: [
        { changedBy: user._id },
        { bookingId: { $in: bookingIds } }
      ]
    });

    // 5. Delete linked Admin record if any
    if (user.role === 'admin') {
      await Admin.deleteOne({ user: user._id });
    }

    // 6. Delete User
    await User.deleteOne({ _id: user._id });

    // 7. Audit Log for the User Deletion action itself
    await AuditLog.create({
      action: 'DELETE_USER',
      oldData: oldUserData,
      newData: null,
      changedBy: req.user._id
    });

    res.json({
      success: true,
      message: 'User account and all associated bookings, files, and audit logs deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get all seats configurations and metadata
 * @route   GET /api/admin/seats
 * @access  Private/Admin
 */
const getSeatsStatus = async (req, res, next) => {
  try {
    const seats = await Seat.find({}).sort({ seatNumber: 1 });
    res.json({ success: true, seats });
  } catch (error) {
    next(error);
  }
};

module.exports = {
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
};
