// ─── Rx Refill & Price Comparison Tool ────────────────────
// Checks prescription status and builds price comparison links

/**
 * Check if a prescription is expired or running low on refills
 * @param {object} rxData - Extracted data from scanning an Rx bottle
 * @returns {object} Status with warnings and recommended actions
 */
function checkRxStatus(rxData) {
  const result = {
    status: 'ok', // ok, expiring, expired, low_refills, no_refills
    warnings: [],
    actions: [],
    daysUntilExpiry: null,
    refillsRemaining: null
  };

  if (!rxData) return result;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Check expiration date
  if (rxData.expiration_date || rxData.exp_date || rxData.expires) {
    const expStr = rxData.expiration_date || rxData.exp_date || rxData.expires;
    const expDate = parseFlexDate(expStr);
    if (expDate) {
      const diffMs = expDate.getTime() - today.getTime();
      const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
      result.daysUntilExpiry = diffDays;

      if (diffDays < 0) {
        result.status = 'expired';
        result.warnings.push(`Prescription expired ${Math.abs(diffDays)} days ago`);
        result.actions.push('call_doctor');
        result.actions.push('price_compare');
      } else if (diffDays <= 30) {
        result.status = 'expiring';
        result.warnings.push(`Prescription expires in ${diffDays} days`);
        result.actions.push('call_pharmacy');
        result.actions.push('call_doctor');
        result.actions.push('price_compare');
      }
    }
  }

  // Check refills remaining
  const refillStr = rxData.refills_remaining || rxData.refills || rxData.refill;
  if (refillStr !== undefined && refillStr !== null) {
    const refills = parseInt(String(refillStr).replace(/[^\d]/g, ''), 10);
    if (!isNaN(refills)) {
      result.refillsRemaining = refills;
      if (refills === 0) {
        result.status = result.status === 'expired' ? 'expired' : 'no_refills';
        result.warnings.push('No refills remaining — need new prescription');
        if (!result.actions.includes('call_doctor')) result.actions.push('call_doctor');
        if (!result.actions.includes('price_compare')) result.actions.push('price_compare');
      } else if (refills <= 1) {
        if (result.status === 'ok') result.status = 'low_refills';
        result.warnings.push(`Only ${refills} refill${refills === 1 ? '' : 's'} remaining`);
        if (!result.actions.includes('call_pharmacy')) result.actions.push('call_pharmacy');
        if (!result.actions.includes('price_compare')) result.actions.push('price_compare');
      }
    }
  }

  // Check date filled — if filled more than 25 days ago for a 30-day supply, may need refill soon
  if (rxData.date_filled) {
    const filledDate = parseFlexDate(rxData.date_filled);
    if (filledDate) {
      const daysSinceFill = Math.ceil((today.getTime() - filledDate.getTime()) / (1000 * 60 * 60 * 24));
      const quantity = parseInt(String(rxData.quantity || '30').replace(/[^\d]/g, ''), 10) || 30;
      // Estimate days supply based on quantity (assume 1/day if frequency not parsed)
      const daysSupply = quantity;
      if (daysSinceFill >= daysSupply - 5 && daysSinceFill < daysSupply + 30) {
        result.warnings.push(`Filled ${daysSinceFill} days ago — may be running low`);
        if (!result.actions.includes('call_pharmacy')) result.actions.push('call_pharmacy');
      }
    }
  }

  // If everything looks ok but we have the data, suggest price compare anyway
  if (result.status === 'ok' && (rxData.medication_name || rxData.drug_name)) {
    result.actions.push('price_compare');
  }

  return result;
}

/**
 * Build price comparison URLs for a medication
 * @param {string} drugName - The medication name
 * @param {string} dosage - The dosage (e.g., "10mg")
 * @param {string} quantity - The quantity (e.g., "30")
 * @param {string} zipCode - User's zip code for local pricing
 * @returns {Array} Array of {name, url, description, icon} objects
 */
function buildPriceCompareLinks(drugName, dosage, quantity, zipCode) {
  if (!drugName) return [];

  const drug = encodeURIComponent(drugName.trim());
  const dose = encodeURIComponent((dosage || '').trim());
  const qty = encodeURIComponent((quantity || '30').trim());
  const zip = encodeURIComponent((zipCode || '78258').trim()); // Default to San Antonio

  const links = [];

  // GoodRx — most comprehensive price comparison
  links.push({
    name: 'GoodRx',
    url: `https://www.goodrx.com/search?search=${drug}`,
    description: 'Compare prices at nearby pharmacies',
    icon: '💊',
    savings: 'Up to 80% off retail'
  });

  // Mark Cuban's Cost Plus Drugs
  links.push({
    name: 'Cost Plus Drugs',
    url: `https://costplusdrugs.com/search/?q=${drug}`,
    description: 'Mark Cuban\'s transparent pricing',
    icon: '💰',
    savings: 'Cost + 15% + $5 pharmacy fee'
  });

  // Amazon Pharmacy
  links.push({
    name: 'Amazon Pharmacy',
    url: `https://pharmacy.amazon.com/search?drugName=${drug}`,
    description: 'Prime members save extra',
    icon: '📦',
    savings: 'Free delivery with Prime'
  });

  // SingleCare
  links.push({
    name: 'SingleCare',
    url: `https://www.singlecare.com/search?search=${drug}`,
    description: 'Free discount card at checkout',
    icon: '🎫',
    savings: 'Free savings card'
  });

  // RxSaver (by RetailMeNot)
  links.push({
    name: 'RxSaver',
    url: `https://www.rxsaver.com/drugs/${drug.toLowerCase().replace(/%20/g, '-')}`,
    description: 'Compare local pharmacy prices',
    icon: '🔍',
    savings: 'Local price comparison'
  });

  // Walmart $4 list check (direct to pharmacy page)
  links.push({
    name: 'Walmart Pharmacy',
    url: `https://www.walmart.com/search?q=${drug}+pharmacy`,
    description: '$4 generic program',
    icon: '🏪',
    savings: '$4/month for many generics'
  });

  return links;
}

/**
 * Build a refill action plan based on Rx status
 * @param {object} rxData - Extracted Rx data
 * @param {object} rxStatus - Result from checkRxStatus
 * @param {object} patient - Patient profile with pharmacy/doctor info
 * @returns {object} Action plan with steps
 */
function buildRefillPlan(rxData, rxStatus, patient) {
  const plan = {
    urgency: 'normal', // normal, soon, urgent
    steps: [],
    callTargets: []
  };

  const medName = rxData.medication_name || rxData.drug_name || 'the medication';
  const rxNumber = rxData.rx_number || rxData.rxNumber || null;
  const pharmacy = patient?.pharmacy || {};
  const pharmacyName = rxData.pharmacy_name || pharmacy.name || 'your pharmacy';
  const pharmacyPhone = rxData.pharmacy_phone || pharmacy.phone || null;
  const doctor = patient?.primaryDoctor || rxData.prescriber || 'the prescribing doctor';

  if (rxStatus.status === 'expired' || rxStatus.status === 'no_refills') {
    plan.urgency = 'urgent';
    plan.steps.push(`Call ${doctor}'s office to request a new prescription for ${medName}`);
    plan.steps.push(`Ask if they can send it electronically to ${pharmacyName}`);
    plan.steps.push('While waiting, check price comparison to find the best deal');
    plan.steps.push('If the medication is critical, ask about emergency/bridge supply');

    plan.callTargets.push({
      name: `${doctor}'s Office`,
      phone: null, // Would need to look up
      reason: `Need new prescription for ${medName} — ${rxStatus.status === 'expired' ? 'Rx expired' : 'no refills remaining'}`,
      priority: 'high'
    });

    if (pharmacyPhone) {
      plan.callTargets.push({
        name: pharmacyName,
        phone: pharmacyPhone,
        reason: `Ask about emergency supply of ${medName} while waiting for new Rx`,
        priority: 'medium'
      });
    }
  } else if (rxStatus.status === 'expiring' || rxStatus.status === 'low_refills') {
    plan.urgency = 'soon';
    plan.steps.push(`Call ${pharmacyName} to refill ${medName}${rxNumber ? ' (Rx #' + rxNumber + ')' : ''}`);
    plan.steps.push('If refills are low, ask the pharmacy to contact the doctor for more');
    plan.steps.push('Compare prices — you might save money switching pharmacies');

    if (pharmacyPhone) {
      plan.callTargets.push({
        name: pharmacyName,
        phone: pharmacyPhone,
        reason: `Refill ${medName}${rxNumber ? ' Rx #' + rxNumber : ''}`,
        priority: 'high'
      });
    }
  } else {
    plan.urgency = 'normal';
    plan.steps.push(`${medName} looks current — check prices to make sure you're getting the best deal`);
    plan.steps.push(`Your pharmacy: ${pharmacyName}${pharmacyPhone ? ' at ' + pharmacyPhone : ''}`);
  }

  return plan;
}

/**
 * Parse flexible date formats from Rx labels
 * Handles: MM/DD/YYYY, MM-DD-YYYY, YYYY-MM-DD, Mon DD YYYY, etc.
 */
function parseFlexDate(str) {
  if (!str) return null;
  const s = String(str).trim();

  // Try standard Date parse first
  const d = new Date(s);
  if (!isNaN(d.getTime()) && d.getFullYear() > 2000) return d;

  // Try MM/DD/YYYY or MM-DD-YYYY
  const mdyMatch = s.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (mdyMatch) {
    let [, m, d2, y] = mdyMatch;
    if (y.length === 2) y = '20' + y;
    const parsed = new Date(`${y}-${String(m).padStart(2, '0')}-${String(d2).padStart(2, '0')}`);
    if (!isNaN(parsed.getTime())) return parsed;
  }

  return null;
}

module.exports = {
  checkRxStatus,
  buildPriceCompareLinks,
  buildRefillPlan,
  parseFlexDate
};
