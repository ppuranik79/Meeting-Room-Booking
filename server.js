const express    = require('express');
const mongoose   = require('mongoose');
const bodyParser = require('body-parser');
const cors       = require('cors');
const nodemailer = require('nodemailer');
require('dotenv').config();  // for SMTP creds + MONGO_URI

// 1. App & DB setup
const app = express();
app.use(cors(), bodyParser.json());
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});
const db = mongoose.connection;
db.on('error', console.error);
db.once('open', () => console.log('MongoDB connected'));

// 2. Schemas
const roomSchema = new mongoose.Schema({
  name: String,
  capacity: Number
});
const Room = mongoose.model('Room', roomSchema);

const bookingSchema = new mongoose.Schema({
  room:      { type: mongoose.Schema.Types.ObjectId, ref: 'Room' },
  date:      String,     // YYYY-MM-DD
  startTime: String,     // HH:MM
  endTime:   String,     // HH:MM
  email:     String,
  createdAt: { type: Date, default: Date.now }
});
const Booking = mongoose.model('Booking', bookingSchema);

// 3. Seed rooms
async function seedRooms() {
  const count = await Room.countDocuments();
  if (count === 0) {
    await Room.insertMany([
      { name: '12-seater Conference', capacity: 12 },
      { name: '4-seater Discussion',  capacity: 4 },
      { name: '2-seater Discussion',  capacity: 2 }
    ]);
    console.log('Seeded rooms');
  }
}
seedRooms();

// 4. Email transporter
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

// 5. Overlap helper
function timesOverlap(aStart, aEnd, bStart, bEnd) {
  return (aStart < bEnd && bStart < aEnd);
}

// 6. Routes

// List rooms
app.get('/api/rooms', async (req, res) => {
  const rooms = await Room.find().lean();
  res.json(rooms);
});

// Create booking
app.post('/api/bookings', async (req, res) => {
  try {
    const { roomId, date, startTime, endTime, email } = req.body;

    // no Sundays
    if (new Date(date).getDay() === 0) {
      return res.status(400).json({ error: 'Bookings on Sundays are not allowed.' });
    }
    // valid times
    if (!(startTime < endTime)) {
      return res.status(400).json({ error: 'Start time must be before end time.' });
    }
    // conflict check
    const existing = await Booking.find({ room: roomId, date });
    for (let b of existing) {
      if (timesOverlap(startTime, endTime, b.startTime, b.endTime)) {
        return res.status(400).json({ error: 'Time slot overlaps with an existing booking.' });
      }
    }
    // save
    const booking = new Booking({ room: roomId, date, startTime, endTime, email });
    await booking.save();

    // email bodies
    const room = await Room.findById(roomId);
    const subject  = `New Booking: ${room.name} on ${date}`;
    const textBody = `Room: ${room.name}\nDate: ${date}\nTime: ${startTime}-${endTime}\nBooked by: ${email}`;

    // notify Preetham
    await transporter.sendMail({
      to: 'Preetham@rainmakers.work',
      from: process.env.SMTP_FROM,
      subject, text: textBody
    });
    // confirm to booker
    await transporter.sendMail({
      to: email,
      from: process.env.SMTP_FROM,
      subject: 'Your room booking is confirmed',
      text: `Thank you for your booking.\n\n${textBody}`
    });

    res.json({ success: true, bookingId: booking._id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// start server
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`API listening on ${PORT}`));
