/**
 * Calculates the booking fee based on selected slots.
 * 
 * SLOT_1: 6:00 AM – 10:00 AM
 * SLOT_2: 10:00 AM – 2:00 PM
 * SLOT_3: 2:00 PM – 6:00 PM
 * SLOT_4: 6:00 PM – 10:00 PM
 * 
 * Pricing Rules:
 * - 1 Slot: ₹299
 * - 2 Continuous Slots: ₹549
 * - 3 Continuous Slots: ₹699
 * - 4 Continuous Slots: ₹799
 * - Non-continuous Slots: number_of_slots * 299
 * 
 * @param {Array<Number>} slots Array of slot numbers (1-4)
 * @returns {Number} Calculated fee in INR
 */
const calculateFee = (slots) => {
  if (!slots || slots.length === 0) return 0;
  
  // Sort slots in ascending order
  const sorted = [...slots].sort((a, b) => a - b);
  
  // Check if they are continuous
  let isContinuous = true;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] !== sorted[i - 1] + 1) {
      isContinuous = false;
      break;
    }
  }
  
  const count = sorted.length;
  
  if (isContinuous) {
    switch (count) {
      case 1:
        return 299;
      case 2:
        return 549;
      case 3:
        return 699;
      case 4:
        return 799;
      default:
        return count * 299;
    }
  } else {
    return count * 299;
  }
};

module.exports = { calculateFee };
