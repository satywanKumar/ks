const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  seat: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Seat',
    required: true
  },
  slots: {
    type: [Number], // array of slots e.g. [1, 2, 3, 4]
    required: true,
    validate: {
      validator: function (val) {
        return val && val.length > 0 && val.every(s => [1, 2, 3, 4].includes(s));
      },
      message: 'Slots must contain valid slot numbers (1, 2, 3, or 4).'
    }
  },
  date: {
    type: Date,
    required: true
  },
  fee: {
    type: Number,
    required: true,
    min: 0
  },
  status: {
    type: String,
    enum: ['Pending', 'Approved', 'Rejected', 'Cancelled'],
    default: 'Pending'
  },
  paymentScreenshot: {
    secure_url: {
      type: String,
      default: ''
    },
    public_id: {
      type: String,
      default: ''
    }
  },
  // Audit details
  bookedAt: {
    type: Date,
    default: Date.now
  },
  paymentUploadedAt: {
    type: Date
  },
  approvedAt: {
    type: Date
  },
  cancelledAt: {
    type: Date
  },
  relocatedAt: {
    type: Date
  },
  lastEditedAt: {
    type: Date
  },
  modifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Booking', bookingSchema);
