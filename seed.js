const mongoose = require('mongoose');
const dotenv = require('dotenv');
const User = require('./models/User');
const Admin = require('./models/Admin');
const Seat = require('./models/Seat');
const Booking = require('./models/Booking');
const AuditLog = require('./models/AuditLog');
const CloudinaryFile = require('./models/CloudinaryFile');

dotenv.config();

const seedDB = async () => {
  try {
    // Connect to database
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/ks_study_zone');
    console.log('MongoDB connected for seeding.');

    // Clear existing data
    await User.deleteMany({});
    await Admin.deleteMany({});
    await Seat.deleteMany({});
    await Booking.deleteMany({});
    await AuditLog.deleteMany({});
    await CloudinaryFile.deleteMany({});
    console.log('Cleared existing collections.');

    // 1. Create 34 seats
    const seatsToInsert = [];
    for (let i = 1; i <= 34; i++) {
      const isReservedForGirls = i >= 18 && i <= 23; // Seats 18 to 23 are reserved for girls
      seatsToInsert.push({
        seatNumber: i,
        isReservedForGirls,
        status: 'active'
      });
    }
    const createdSeats = await Seat.insertMany(seatsToInsert);
    console.log(`Created ${createdSeats.length} seats (Seats 18-23 reserved for girls).`);

    // 2. Create default Admin user
    const adminUser = await User.create({
      fullName: 'KS',
      email: 'ks@gmail.com',
      phone: '9876543210',
      password: 'ks123456', // will be hashed by pre-save middleware
      gender: 'Male',
      age: 30,
      address: 'KS Zone Office, Main Avenue',
      pinCode: '800001',
      preparationCategory: 'Other',
      role: 'admin'
    });

    // Link User to Admin schema
    await Admin.create({
      user: adminUser._id,
      isSuperAdmin: true,
      permissions: ['all']
    });
    console.log('Seeded default admin (User: ks@gmail.com / Password: ks123456).');

    // 3. Seed a Female test user
    const femaleUser = await User.create({
      fullName: 'Rani Kumari',
      email: 'rani@gmail.com',
      phone: '9988776655',
      password: 'userpassword',
      gender: 'Female',
      age: 21,
      address: 'Shanti Nagar, Lane 2',
      pinCode: '800020',
      preparationCategory: 'UPSC',
      role: 'user'
    });
    console.log('Seeded female test user (rani@gmail.com / userpassword).');

    // 4. Seed a Male test user
    const maleUser = await User.create({
      fullName: 'Rajesh Kumar',
      email: 'rajesh@gmail.com',
      phone: '8877665544',
      password: 'userpassword',
      gender: 'Male',
      age: 19,
      address: 'Ashok Rajpath, Near College',
      pinCode: '800004',
      preparationCategory: 'JEE',
      role: 'user'
    });
    console.log('Seeded male test user (rajesh@gmail.com / userpassword).');

    console.log('Database Seeding Completed Successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Error seeding database:', error);
    process.exit(1);
  }
};

seedDB();
