const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Admin = require('../models/Admin');

// Generate JWT Token
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET || 'ks_study_zone_secret_key_2026', {
    expiresIn: process.env.JWT_EXPIRE || '30d'
  });
};

/**
 * @desc    Register a new user
 * @route   POST /api/auth/register
 * @access  Public
 */
const registerUser = async (req, res, next) => {
  try {
    const {
      fullName,
      email,
      phone,
      password,
      gender,
      age,
      address,
      pinCode,
      preparationCategory
    } = req.body;

    // Check if user already exists
    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({ success: false, message: 'User already exists with this email' });
    }

    // Create user
    const user = await User.create({
      fullName,
      email,
      phone,
      password,
      gender,
      age,
      address,
      pinCode,
      preparationCategory,
      role: 'user' // default role
    });

    if (user) {
      res.status(201).json({
        success: true,
        _id: user._id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        gender: user.gender,
        token: generateToken(user._id)
      });
    } else {
      res.status(400).json({ success: false, message: 'Invalid user data' });
    }
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Auth user & get token
 * @route   POST /api/auth/login
 * @access  Public
 */
const loginUser = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    // Validate request
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Please provide email and password' });
    }

    // Check for user by email or by full name (supports login as 'KS')
    const query = email.includes('@')
      ? { email: email.toLowerCase() }
      : { fullName: email };

    const user = await User.findOne(query);
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    // Check password
    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    // If admin, update last login in Admin model (or create if missing)
    if (user.role === 'admin') {
      let adminRecord = await Admin.findOne({ user: user._id });
      if (!adminRecord) {
        adminRecord = await Admin.create({ user: user._id, isSuperAdmin: true });
      }
      adminRecord.lastLoginAt = new Date();
      await adminRecord.save();
    }

    res.json({
      success: true,
      _id: user._id,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      gender: user.gender,
      token: generateToken(user._id)
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get user profile
 * @route   GET /api/auth/me
 * @access  Private
 */
const getUserProfile = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    if (user) {
      res.json({
        success: true,
        _id: user._id,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
        gender: user.gender,
        age: user.age,
        address: user.address,
        pinCode: user.pinCode,
        preparationCategory: user.preparationCategory,
        role: user.role
      });
    } else {
      res.status(404).json({ success: false, message: 'User not found' });
    }
  } catch (error) {
    next(error);
  }
};

module.exports = {
  registerUser,
  loginUser,
  getUserProfile
};
