const AuditLog = require('../models/AuditLog');

/**
 * @desc    Get system audit logs
 * @route   GET /api/admin/audit-logs
 * @access  Private/Admin
 */
const getAuditLogs = async (req, res, next) => {
  try {
    const { page = 1, limit = 50, action } = req.query;
    const query = {};

    if (action) {
      query.action = action;
    }

    const total = await AuditLog.countDocuments(query);
    const logs = await AuditLog.find(query)
      .populate('changedBy', 'fullName email role')
      .sort({ changedAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    res.json({
      success: true,
      total,
      page: Number(page),
      pages: Math.ceil(total / limit),
      logs
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAuditLogs
};
