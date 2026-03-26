// second-opinion-connector.js
// World-class second opinion programs with Medicare/insurance matching

const PROGRAMS = [
  {
    id: 'cleveland-clinic',
    name: 'Cleveland Clinic Virtual Second Opinions',
    url: 'https://my.clevelandclinic.org/departments/second-opinion',
    specialties: ['oncology','cardiology','neurology','spine','orthopedics','endocrinology','ophthalmology','gastroenterology','general'],
    insurance: ['self-pay','medicare','most-commercial'],
    states: 'all',
    cost: '$1,690 - $1,990 self-pay',
    timeline: '2-4 weeks',
    format: 'Remote/Virtual',
    notes: 'Board-certified specialists review records and provide written report. No travel required.',
    medicareCovers: false,
    selfPayAvailable: true
  },
  {
    id: 'johns-hopkins',
    name: 'Johns Hopkins Online Second Opinion',
    url: 'https://www.hopkinsmedicine.org/health/second-opinion',
    specialties: ['oncology','neurology','cardiology','spine','ophthalmology','endocrinology','general'],
    insurance: ['self-pay','some-medicare','commercial'],
    states: 'all',
    cost: '$750 - $1,500 self-pay',
    timeline: '1-3 weeks',
    format: 'Remote/Virtual',
    notes: 'Written expert opinion from world-renowned specialists. Accepts some Medicare Advantage plans.',
    medicareCovers: 'partial',
    selfPayAvailable: true
  },
  {
    id: 'mayo-clinic',
    name: 'Mayo Clinic Online Second Opinion',
    url: 'https://www.mayoclinic.org/appointments/second-opinion',
    specialties: ['oncology','neurology','cardiology','endocrinology','ophthalmology','spine','rare-disease','general'],
    insurance: ['self-pay','medicare','commercial'],
    states: 'all',
    cost: '$600 - $1,200 self-pay',
    timeline: '2-3 weeks',
    format: 'Remote or In-Person',
    notes: 'Can be fully remote or in-person at Rochester, Jacksonville, or Phoenix campuses.',
    medicareCovers: 'partial',
    selfPayAvailable: true
  },
  {
    id: 'cedars-sinai',
    name: 'Cedars-Sinai Virtual Second Opinion',
    url: 'https://www.cedars-sinai.org/virtual-programs/second-opinion.html',
    specialties: ['oncology','cardiology','neurology','spine','ophthalmology','gastroenterology','general'],
    insurance: ['self-pay','commercial'],
    states: 'all',
    cost: '$800 - $1,500 self-pay',
    timeline: '2-3 weeks',
    format: 'Remote/Virtual',
    notes: 'Specialists from one of the top-ranked hospitals in the US review your case remotely.',
    medicareCovers: false,
    selfPayAvailable: true
  },
  {
    id: 'ucla-health',
    name: 'UCLA Health Second Opinion',
    url: 'https://www.uclahealth.org/second-opinion',
    specialties: ['oncology','neurology','spine','ophthalmology','endocrinology','general'],
    insurance: ['self-pay','commercial','some-medicare'],
    states: 'all',
    cost: '$500 - $1,200 self-pay',
    timeline: '1-3 weeks',
    format: 'Remote or In-Person',
    notes: 'UCLA Stein Eye Institute for ophthalmology is world-renowned. Strong for dry eye and MGD.',
    medicareCovers: 'partial',
    selfPayAvailable: true
  },
  {
    id: 'emory-spine',
    name: 'Emory Spine & Orthopedics',
    url: 'https://www.emoryhealthcare.org/spine',
    specialties: ['spine','neurology','orthopedics','pain-management'],
    insurance: ['self-pay','medicare','commercial'],
    states: 'all',
    cost: '$400 - $900 self-pay',
    timeline: '1-2 weeks',
    format: 'Telehealth',
    notes: 'Top program for post-fusion neuropathy and spine second opinions. Telehealth available.',
    medicareCovers: true,
    selfPayAvailable: true
  },
  {
    id: 'bascom-palmer',
    name: 'Bascom Palmer Eye Institute',
    url: 'https://umiamihealth.org/bascom-palmer-eye-institute',
    specialties: ['ophthalmology','dry-eye','cornea','retina'],
    insurance: ['self-pay','medicare','commercial'],
    states: 'all',
    cost: '$300 - $800 self-pay',
    timeline: '1-3 weeks',
    format: 'In-Person (Miami) or Telehealth',
    notes: '#1 ranked eye hospital in the US. Specializes in treatment-resistant dry eye and MGD. Accepts Medicare.',
    medicareCovers: true,
    selfPayAvailable: true
  },
  {
    id: 'wills-eye',
    name: 'Wills Eye Hospital',
    url: 'https://www.willseye.org',
    specialties: ['ophthalmology','dry-eye','cornea','glaucoma'],
    insurance: ['self-pay','medicare','commercial'],
    states: 'all',
    cost: '$250 - $600 self-pay',
    timeline: '1-2 weeks',
    format: 'In-Person (Philadelphia) or Telehealth',
    notes: 'World leader in dry eye disease. Strong for MGD treatment-resistant cases.',
    medicareCovers: true,
    selfPayAvailable: true
  }
];

function matchPrograms(options = {}) {
  const { specialty, insurance, state, condition } = options;
  let results = [...PROGRAMS];

  // Filter by specialty if provided
  if (specialty) {
    const s = specialty.toLowerCase();
    results = results.filter(p =>
      p.specialties.some(sp => sp.includes(s) || s.includes(sp))
    );
  }

  // Filter by insurance
  if (insurance) {
    const ins = insurance.toLowerCase();
    if (ins.includes('medicare')) {
      results = results.filter(p =>
        p.medicareCovers === true || p.medicareCovers === 'partial' || p.selfPayAvailable
      );
      // Sort: Medicare-covered first
      results.sort((a, b) => {
        if (a.medicareCovers === true && b.medicareCovers !== true) return -1;
        if (b.medicareCovers === true && a.medicareCovers !== true) return 1;
        return 0;
      });
    }
  }

  // Score by condition keywords for better ranking
  if (condition) {
    const cond = condition.toLowerCase();
    results = results.map(p => {
      let score = 0;
      if (cond.includes('dry eye') || cond.includes('mge') || cond.includes('cornea')) {
        if (['bascom-palmer','wills-eye','ucla-health'].includes(p.id)) score += 10;
      }
      if (cond.includes('spine') || cond.includes('fusion') || cond.includes('neuropath')) {
        if (['emory-spine'].includes(p.id)) score += 10;
        if (['mayo-clinic','johns-hopkins'].includes(p.id)) score += 5;
      }
      if (cond.includes('thyroid') || cond.includes('synthroid') || cond.includes('endocrin')) {
        if (['mayo-clinic','cleveland-clinic','johns-hopkins'].includes(p.id)) score += 8;
      }
      return { ...p, score };
    });
    results.sort((a, b) => (b.score || 0) - (a.score || 0));
  }

  return results.slice(0, 5);
}

function buildCaseSummary(patient, condition) {
  const p = patient || {};
  const meds = (p.medications || []).map(m => m.name + ' ' + (m.dose || '')).join(', ');
  const conditions = (p.conditions || []).join(', ');
  const allergies = (p.allergies || []).join(', ');

  return `SECOND OPINION CASE SUMMARY
Patient: ${p.name || 'Unknown'} | DOB: ${p.dob || 'Unknown'}
Insurance: ${p.insurance?.primary || 'Unknown'} ${p.insurance?.secondary ? '+ ' + p.insurance.secondary : ''}
Primary Physician: ${p.primaryDoctor || 'Unknown'} — ${p.clinic || 'Unknown'}

REASON FOR SECOND OPINION:
${condition || 'Treatment-resistant condition requiring specialist review'}

ACTIVE CONDITIONS: ${conditions || 'See attached records'}
CURRENT MEDICATIONS: ${meds || 'See attached records'}
ALLERGIES: ${allergies || 'NKDA'}

RECORDS TO INCLUDE WITH REQUEST:
- Last 2 years of lab results
- Imaging reports (MRI, X-ray, CT)
- Specialist visit notes
- Current medication list
- Insurance card (front and back)
- Photo ID

Generated by Health Agent — ${new Date().toLocaleDateString()}`;
}

module.exports = { matchPrograms, buildCaseSummary, PROGRAMS };
