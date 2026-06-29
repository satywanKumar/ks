const Seat = require('../models/Seat');
const Booking = require('../models/Booking');

/**
 * Normalizes a date to midnight UTC/local to ensure consistent date comparisons.
 */
const normalizeDate = (dateInput) => {
  const d = new Date(dateInput);
  d.setHours(0, 0, 0, 0);
  return d;
};

/**
 * Returns the priority tier (1, 2, or 3) for a seat based on gender constraints.
 * Smaller tier represents higher priority.
 */
const getGenderTier = (seatNumber, gender) => {
  const num = Number(seatNumber);
  
  if (gender === 'Female') {
    // 1st Priority: Seats 18 to 23 (reserved for girls)
    if (num >= 18 && num <= 23) return 1;
    // 2nd Priority: Seats 13 to 17
    if (num >= 13 && num <= 17) return 2;
    // 3rd Priority: All other seats (1-12, 24-34)
    return 3;
  } else {
    // Male / Other
    // 1st Priority: Seats 9 to 12 and 24 to 34
    if ((num >= 9 && num <= 12) || (num >= 24 && num <= 34)) return 1;
    // 2nd Priority: Seats 1 to 8 (at the end for male)
    if (num >= 1 && num <= 8) return 2;
    // 3rd Priority: Seats 13 to 17
    if (num >= 13 && num <= 17) return 3;
    // 4th Priority: Seats 18 to 23 (blocked, should be excluded, but fallback)
    return 4;
  }
};

/**
 * Finds the optimal seat for a booking based on date, slots, gender, and category.
 * 
 * @param {Date|String} bookingDate The date of the booking
 * @param {Array<Number>} requestedSlots Array of slots (1-4)
 * @param {String} gender User gender ('Female', 'Male', 'Other')
 * @param {String} preparationCategory Student's preparation category (e.g. 'UPSC')
 * @returns {Promise<Object|null>} The assigned Seat document or null if none available
 */
const allocateSeat = async (bookingDate, requestedSlots, gender, preparationCategory = '') => {
  const normalizedDate = normalizeDate(bookingDate);

  // 1. Get all active seats
  let seats = await Seat.find({ status: 'active' });

  // 2. Filter seats by gender constraint
  // Seat 18-23 reserved only for girls
  if (gender !== 'Female') {
    seats = seats.filter(seat => !seat.isReservedForGirls);
  }

  // 3. Get all active (Approved or Pending) bookings for this date, populated with user category details
  const activeBookings = await Booking.find({
    date: normalizedDate,
    status: { $in: ['Approved', 'Pending'] }
  }).populate(['seat', 'user']);

  // Map to store existing booking slots info for each seat
  // Key: seatId, Value: Set of booked slots
  const seatBookingsMap = {};
  activeBookings.forEach(booking => {
    if (!booking.seat) return;
    const seatId = booking.seat._id.toString();
    if (!seatBookingsMap[seatId]) {
      seatBookingsMap[seatId] = new Set();
    }
    booking.slots.forEach(slot => seatBookingsMap[seatId].add(slot));
  });

  // 4. Filter and score available seats
  const availableSeatsInfo = [];

  for (const seat of seats) {
    const seatId = seat._id.toString();
    const bookedSlotsSet = seatBookingsMap[seatId] || new Set();

    // Check for overlap between requested slots and already booked slots
    let hasConflict = false;
    for (const slot of requestedSlots) {
      if (bookedSlotsSet.has(slot)) {
        hasConflict = true;
        break;
      }
    }

    if (hasConflict) {
      // Seat has overlap conflict, cannot allocate
      continue;
    }

    // Scoring parameters:
    // A. Gender Priority Tier
    const genderTier = getGenderTier(seat.seatNumber, gender);

    // B. Category Match Count: Number of slots booked on this seat for this date by students of the same category
    let sameCategorySlotsCount = 0;
    const bookingsOnSeat = activeBookings.filter(b => b.seat && b.seat._id.toString() === seatId);
    bookingsOnSeat.forEach(b => {
      if (b.user && b.user.preparationCategory === preparationCategory) {
        sameCategorySlotsCount += b.slots.length;
      }
    });

    // C. Existing cabin occupancy count (to consolidate cabins)
    const existingBookedSlotsCount = bookedSlotsSet.size;

    availableSeatsInfo.push({
      seat,
      genderTier,
      sameCategorySlotsCount,
      existingBookedSlotsCount,
      hasExistingBookings: existingBookedSlotsCount > 0
    });
  }

  if (availableSeatsInfo.length === 0) {
    return null; // No available seats
  }

  // 5. Sort seats according to prioritized rules:
  // Rule 1: Gender Tier (smaller tier first - strictly fills groups in priority order)
  // Rule 2: Same preparation category matches (larger matches first - clusters same-exam students together)
  // Rule 3: Fills partially occupied seats first (hasExistingBookings === true)
  // Rule 4: Completes existing seat usage to full 16 hours (descending existingBookedSlotsCount)
  // Rule 5: Assigns lowest seat number (ascending seatNumber)
  availableSeatsInfo.sort((a, b) => {
    // 1. Gender-based group priority
    if (a.genderTier !== b.genderTier) {
      return a.genderTier - b.genderTier;
    }

    // 2. Category consolidation alignment
    if (a.sameCategorySlotsCount !== b.sameCategorySlotsCount) {
      return b.sameCategorySlotsCount - a.sameCategorySlotsCount;
    }

    // 3. Partially occupied first
    if (a.hasExistingBookings && !b.hasExistingBookings) return -1;
    if (!a.hasExistingBookings && b.hasExistingBookings) return 1;

    // 4. Descending order of existing booked slots count to complete existing usage
    if (a.existingBookedSlotsCount !== b.existingBookedSlotsCount) {
      return b.existingBookedSlotsCount - a.existingBookedSlotsCount;
    }

    // 5. Lowest seat number first (stable sorting fallback)
    return a.seat.seatNumber - b.seat.seatNumber;
  });

  // Return the best seat
  return availableSeatsInfo[0].seat;
};

module.exports = {
  allocateSeat,
  normalizeDate
};
