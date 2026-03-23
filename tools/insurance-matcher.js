const fs = require("fs");
const path = require("path");

// Federal Poverty Level 2026 (estimated)
const FPL_BASE = 15650;
const FPL_PER_PERSON = 5500;

function getFPL(familySize) {
  return FPL_BASE + (Math.max(0, (familySize || 1) - 1) * FPL_PER_PERSON);
}

function getFPLPercent(income, familySize) {
  const fpl = getFPL(familySize);
  return Math.round((income / fpl) * 100);
}

// Medicaid expansion states (as of 2026)
const MEDICAID_EXPANSION_STATES = new Set([
  'AK','AZ','AR','CA','CO','CT','DE','HI','IL','IN','IA','KY','LA','ME',
  'MD','MA','MI','MN','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH',
  'OK','OR','PA','RI','SD','UT','VA','VT','WA','WV','ID','MO','WI'
]);

// States that haven't expanded Medicaid
const NON_EXPANSION_STATES = new Set([
  'AL','FL','GA','KS','MS','SC','TN','TX','WY'
]);

/**
 * Match a user to insurance options based on their profile
 * @param {object} profile - User profile with age, income, state, familySize, employed, etc.
 * @returns {object} Recommendations with programs, eligibility, and apply links
 */
function matchInsurance(profile) {
  const {
    age = null,
    annualIncome = null,
    state = 'TX',
    familySize = 1,
    employed = false,
    hasEmployerInsurance = false,
    pregnant = false,
    disabled = false,
    veteran = false,
    citizenOrLegalResident = true,
    children = 0,
    childrenAges = []
  } = profile;

  const results = {
    profile: { age, annualIncome, state, familySize, fplPercent: null },
    recommendations: [],
    warnings: [],
    nextSteps: []
  };

  if (annualIncome !== null) {
    results.profile.fplPercent = getFPLPercent(annualIncome, familySize);
  }

  const fplPct = results.profile.fplPercent;
  const stateUpper = (state || 'TX').toUpperCase().trim();
  const stateEnc = encodeURIComponent(stateUpper);

  // === MEDICARE (65+) ===
  if (age && age >= 65) {
    results.recommendations.push({
      program: 'Medicare',
      type: 'federal',
      priority: 1,
      eligible: true,
      description: 'Federal health insurance for people 65 and older. Part A (hospital) is usually free. Part B (doctors) has a monthly premium.',
      monthlyCost: 'Part A: $0 (most people). Part B: ~$185/month. Part D (drugs): varies.',
      coverageLevel: 'Comprehensive hospital, doctor, and preventive care',
      howToApply: [
        'Visit ssa.gov or call 1-800-772-1213',
        'Apply up to 3 months before turning 65',
        'Bring Social Security number, birth certificate, and proof of citizenship'
      ],
      links: [
        { name: 'Medicare.gov', url: 'https://www.medicare.gov/basics/get-started-with-medicare', description: 'Official enrollment' },
        { name: 'Find Medicare Plans', url: 'https://www.medicare.gov/plan-compare/', description: 'Compare plans in your area' }
      ]
    });

    // Medicare Savings Programs for low income
    if (fplPct !== null && fplPct <= 135) {
      results.recommendations.push({
        program: 'Medicare Savings Program',
        type: 'state',
        priority: 2,
        eligible: true,
        description: 'Helps pay Medicare premiums, deductibles, and copays for people with limited income.',
        monthlyCost: 'Reduced or $0 depending on income',
        howToApply: ['Contact your state Medicaid office', 'Apply at your local DHS office'],
        links: [
          { name: 'Medicare Savings Programs', url: 'https://www.medicare.gov/basics/costs/help/medicare-savings-programs', description: 'Check eligibility' }
        ]
      });
    }

    // Extra Help (Part D)
    if (fplPct !== null && fplPct <= 150) {
      results.recommendations.push({
        program: 'Extra Help (Low Income Subsidy)',
        type: 'federal',
        priority: 3,
        eligible: true,
        description: 'Helps pay Part D prescription drug costs. Can save up to $5,000/year on medications.',
        monthlyCost: '$0 or reduced copays on prescriptions',
        howToApply: ['Apply at ssa.gov/extrahelp or call 1-800-772-1213'],
        links: [
          { name: 'Apply for Extra Help', url: 'https://www.ssa.gov/medicare/part-d-extra-help', description: 'SSA application' }
        ]
      });
    }
  }

  // === MEDICAID ===
  if (age && age < 65) {
    const isExpansionState = MEDICAID_EXPANSION_STATES.has(stateUpper);
    const medicaidEligible = isExpansionState ? (fplPct !== null && fplPct <= 138) : (fplPct !== null && fplPct <= 100 && (pregnant || disabled || children > 0));

    if (medicaidEligible || fplPct === null) {
      results.recommendations.push({
        program: 'Medicaid',
        type: 'state',
        priority: 1,
        eligible: medicaidEligible || null,
        description: isExpansionState
          ? 'Free or very low-cost health coverage. Your state expanded Medicaid to cover adults up to 138% FPL.'
          : 'Free or low-cost coverage. In ' + stateUpper + ', Medicaid covers pregnant women, children, disabled adults, and very low-income parents.',
        monthlyCost: '$0 or very small copays',
        coverageLevel: 'Comprehensive — doctor visits, hospital, prescriptions, mental health, dental (varies by state)',
        howToApply: [
          'Apply at Healthcare.gov or your state Medicaid office',
          'Bring proof of income, ID, and residency',
          'Processing takes 30-45 days'
        ],
        links: [
          { name: 'Healthcare.gov', url: 'https://www.healthcare.gov/medicaid-chip/', description: 'Check eligibility & apply' },
          { name: 'State Medicaid Office', url: `https://www.medicaid.gov/state-overviews`, description: 'Find your state office' }
        ]
      });
    }

    if (!isExpansionState && fplPct !== null && fplPct > 100) {
      results.warnings.push(`${stateUpper} has not expanded Medicaid. Adults without children earning above poverty level may fall in the "coverage gap." The Marketplace is your best option.`);
    }
  }

  // === CHIP (Children) ===
  if (children > 0 || childrenAges.length > 0) {
    const chipEligible = fplPct === null || fplPct <= 300;
    if (chipEligible) {
      results.recommendations.push({
        program: "Children's Health Insurance Program (CHIP)",
        type: 'state',
        priority: 2,
        eligible: chipEligible,
        description: 'Low-cost health coverage for children in families that earn too much for Medicaid but cannot afford private insurance.',
        monthlyCost: '$0 to low monthly premiums depending on income',
        coverageLevel: 'Comprehensive pediatric care — checkups, immunizations, dental, vision, prescriptions',
        howToApply: [
          'Apply at Healthcare.gov or call 1-877-KIDS-NOW (1-877-543-7669)',
          'Bring birth certificates, proof of income, and residency'
        ],
        links: [
          { name: 'InsureKidsNow.gov', url: 'https://www.insurekidsnow.gov/', description: 'Find CHIP in your state' },
          { name: 'Healthcare.gov CHIP', url: 'https://www.healthcare.gov/medicaid-chip/childrens-health-insurance-program/', description: 'Apply online' }
        ]
      });
    }
  }

  // === ACA MARKETPLACE ===
  if (age && age < 65) {
    const subsidyEligible = fplPct !== null && fplPct >= 100 && fplPct <= 400;
    const enhancedSubsidy = fplPct !== null && fplPct <= 150;

    results.recommendations.push({
      program: 'ACA Marketplace (Obamacare)',
      type: 'federal',
      priority: subsidyEligible ? 2 : 4,
      eligible: true,
      description: subsidyEligible
        ? 'You likely qualify for premium subsidies! Monthly premiums could be as low as $0-$50/month depending on income.'
        : 'Health insurance plans from private carriers. Open enrollment Nov 1 - Jan 15 each year. Special enrollment if you have a qualifying life event.',
      monthlyCost: subsidyEligible
        ? (enhancedSubsidy ? 'Likely $0-$10/month with subsidies' : 'Reduced premiums with tax credits')
        : 'Varies — $200-$600+/month without subsidies',
      coverageLevel: 'Bronze, Silver, Gold, Platinum tiers. All must cover essential health benefits.',
      howToApply: [
        'Go to Healthcare.gov (or your state marketplace)',
        'Create an account and fill out the application',
        'Compare plans and select one',
        'Bring income documents (W-2, tax return, pay stubs)'
      ],
      links: [
        { name: 'Healthcare.gov', url: 'https://www.healthcare.gov/', description: 'Browse & enroll in plans' },
        { name: 'See If You Qualify', url: 'https://www.healthcare.gov/see-plans/', description: 'Preview plans and prices' },
        { name: 'Find Local Help', url: `https://localhelp.healthcare.gov/#/${stateEnc}`, description: 'Free in-person enrollment help' }
      ]
    });

    if (enhancedSubsidy) {
      results.nextSteps.push('With your income level, you may qualify for a $0 premium Silver plan with very low copays. This is often the best deal.');
    }
  }

  // === VA HEALTH CARE ===
  if (veteran) {
    results.recommendations.push({
      program: 'VA Health Care',
      type: 'federal',
      priority: 1,
      eligible: true,
      description: 'Health care benefits for veterans. Covers doctor visits, hospital care, prescriptions, mental health, and more.',
      monthlyCost: '$0 or very low copays depending on service-connected disability rating and income',
      howToApply: [
        'Apply at VA.gov or call 1-877-222-8387',
        'Bring DD-214 (discharge papers) and income information'
      ],
      links: [
        { name: 'VA.gov Health Care', url: 'https://www.va.gov/health-care/apply/application/introduction', description: 'Apply online' },
        { name: 'Am I Eligible?', url: 'https://www.va.gov/health-care/eligibility/', description: 'Check eligibility' }
      ]
    });
  }

  // === EMPLOYER INSURANCE CHECK ===
  if (employed && !hasEmployerInsurance) {
    results.warnings.push('If your employer offers health insurance, you may be required to take it before qualifying for Marketplace subsidies. Check with your HR department about available plans and costs.');
  }

  // === CITIZENSHIP CHECK ===
  if (!citizenOrLegalResident) {
    results.warnings.push('Marketplace plans and most Medicaid programs require U.S. citizenship or legal residency. Emergency Medicaid is available regardless of immigration status. Community health centers provide care on a sliding fee scale.');
    results.recommendations.push({
      program: 'Community Health Centers',
      type: 'community',
      priority: 2,
      eligible: true,
      description: 'Federally funded health centers that provide care to everyone regardless of insurance or immigration status. Fees are based on ability to pay.',
      monthlyCost: 'Sliding scale based on income — can be $0',
      howToApply: ['Find a center near you at findahealthcenter.hrsa.gov'],
      links: [
        { name: 'Find a Health Center', url: 'https://findahealthcenter.hrsa.gov/', description: 'Search by ZIP code' }
      ]
    });
  }

  // === COMMUNITY RESOURCES (always include) ===
  results.recommendations.push({
    program: 'Community Health Centers',
    type: 'community',
    priority: 5,
    eligible: true,
    description: 'Sliding-fee clinics available to everyone. Good option while waiting for insurance to start or as a backup.',
    monthlyCost: 'Pay what you can afford',
    howToApply: ['Visit findahealthcenter.hrsa.gov and search your ZIP code'],
    links: [
      { name: 'Find a Health Center', url: 'https://findahealthcenter.hrsa.gov/', description: 'HRSA Health Center Finder' }
    ]
  });

  // Sort by priority
  results.recommendations.sort((a, b) => a.priority - b.priority);

  // Deduplicate Community Health Centers
  const seen = new Set();
  results.recommendations = results.recommendations.filter(r => {
    if (seen.has(r.program)) return false;
    seen.add(r.program);
    return true;
  });

  // Build next steps
  if (!results.nextSteps.length) {
    if (results.recommendations.length > 0) {
      const top = results.recommendations[0];
      results.nextSteps.push(`Your best option appears to be ${top.program}. Start by visiting the enrollment link above.`);
    }
    results.nextSteps.push('Need help applying? Health Agent can walk you through the application step by step.');
  }

  return results;
}

/**
 * Build enrollment links for a specific program
 */
function getEnrollmentLinks(program, state) {
  const stateEnc = encodeURIComponent((state || 'TX').toUpperCase());
  const links = {
    'Medicare': [
      { name: 'Medicare.gov', url: 'https://www.medicare.gov/', description: 'Official Medicare site' },
      { name: 'Social Security', url: 'https://www.ssa.gov/medicare/', description: 'Enroll through SSA' }
    ],
    'Medicaid': [
      { name: 'Healthcare.gov', url: 'https://www.healthcare.gov/medicaid-chip/', description: 'Apply for Medicaid' },
      { name: 'Find Local Help', url: `https://localhelp.healthcare.gov/#/${stateEnc}`, description: 'In-person help' }
    ],
    'ACA Marketplace': [
      { name: 'Healthcare.gov', url: 'https://www.healthcare.gov/', description: 'Browse plans' },
      { name: 'Preview Plans', url: 'https://www.healthcare.gov/see-plans/', description: 'See prices' }
    ]
  };
  return links[program] || links['ACA Marketplace'];
}

module.exports = { matchInsurance, getEnrollmentLinks, getFPLPercent };
