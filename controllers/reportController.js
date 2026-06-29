const Booking = require('../models/Booking');
const User = require('../models/User');
const Seat = require('../models/Seat');
const { normalizeDate } = require('../services/seatAllocator');

/**
 * @desc    Get dashboard analytics & reports
 * @route   GET /api/admin/reports
 * @access  Private/Admin
 */
const getReports = async (req, res, next) => {
  try {
    // 1. Total Earnings (Approved Bookings only)
    const revenueData = await Booking.aggregate([
      { $match: { status: 'Approved' } },
      { $group: { _id: null, totalEarnings: { $sum: '$fee' } } }
    ]);
    const totalEarnings = revenueData.length > 0 ? revenueData[0].totalEarnings : 0;

    // 2. Count of bookings by state
    const bookingsCountData = await Booking.aggregate([
      { $group: { _id: '$status', count: { $count: {} } } }
    ]);
    const bookingStatuses = { Pending: 0, Approved: 0, Rejected: 0, Cancelled: 0 };
    bookingsCountData.forEach(item => {
      if (bookingStatuses[item._id] !== undefined) {
        bookingStatuses[item._id] = item.count;
      }
    });

    // 3. User counts
    const totalUsers = await User.countDocuments({ role: 'user' });

    // 4. Peak Slot Distribution (Approved or Pending)
    const activeBookings = await Booking.find({ status: { $in: ['Approved', 'Pending'] } });
    const slotCounts = { SLOT_1: 0, SLOT_2: 0, SLOT_3: 0, SLOT_4: 0 };
    activeBookings.forEach(booking => {
      booking.slots.forEach(slot => {
        const slotKey = `SLOT_${slot}`;
        if (slotCounts[slotKey] !== undefined) {
          slotCounts[slotKey]++;
        }
      });
    });

    // 5. Preparation Category breakdown among registered users
    const categoryData = await User.aggregate([
      { $match: { role: 'user' } },
      { $group: { _id: '$preparationCategory', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);
    const prepCategoryBreakdown = categoryData.map(item => ({
      category: item._id || 'Other',
      count: item.count
    }));

    // 6. Seat utilization metrics (for today/overall)
    // We calculate occupancy for the current week / day
    const today = normalizeDate(new Date());
    const bookingsToday = await Booking.find({
      date: today,
      status: { $in: ['Approved', 'Pending'] }
    });

    // Count slots booked today
    let totalSlotsBookedToday = 0;
    bookingsToday.forEach(b => {
      totalSlotsBookedToday += b.slots.length;
    });

    const maxSlotsPossible = 34 * 4; // 34 seats * 4 slots = 136 slot-seats
    const occupancyTodayPercent = maxSlotsPossible > 0
      ? Math.round((totalSlotsBookedToday / maxSlotsPossible) * 100)
      : 0;

    // Monthly revenue breakdown (last 6 months)
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
    sixMonthsAgo.setDate(1);
    sixMonthsAgo.setHours(0, 0, 0, 0);

    const monthlyRevenueData = await Booking.aggregate([
      { 
        $match: { 
          status: 'Approved',
          date: { $gte: sixMonthsAgo } 
        } 
      },
      {
        $group: {
          _id: {
            year: { $year: '$date' },
            month: { $month: '$date' }
          },
          earnings: { $sum: '$fee' }
        }
      },
      {
        $sort: { '_id.year': 1, '_id.month': 1 }
      }
    ]);

    const monthsName = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthlyRevenue = monthlyRevenueData.map(item => {
      return {
        month: `${monthsName[item._id.month - 1]} ${item._id.year}`,
        earnings: item.earnings
      };
    });

    res.json({
      success: true,
      data: {
        totalEarnings,
        bookingStatuses,
        totalUsers,
        slotCounts,
        prepCategoryBreakdown,
        occupancyTodayPercent,
        monthlyRevenue
      }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getReports
};
