const mongoose = require('mongoose');

const cloudinaryFileSchema = new mongoose.Schema({
  secure_url: {
    type: String,
    required: true
  },
  public_id: {
    type: String,
    required: true
  },
  fileName: {
    type: String
  },
  uploadedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('CloudinaryFile', cloudinaryFileSchema);
