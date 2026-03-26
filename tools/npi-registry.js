// npi-registry.js — Federal NPI Registry lookup
// 6M+ providers, free government API, no key needed
// https://npiregistry.cms.hhs.gov/api/

const https = require('https');

function searchProviders(options = {}) {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({
      version: '2.1',
      limit: options.limit || 10,
      skip: options.skip || 0
    });

    if(options.firstName) params.set('first_name', options.firstName);
    if(options.lastName) params.set('last_name', options.lastName);
    if(options.specialty) params.set('taxonomy_description', options.specialty);
    if(options.city) params.set('city', options.city);
    if(options.state) params.set('state', options.state || 'TX');
    if(options.postalCode) params.set('postal_code', options.postalCode);
    if(options.npi) params.set('number', options.npi);
    if(options.organizationName) params.set('organization_name', options.organizationName);

    const url = `https://npiregistry.cms.hhs.gov/api/?${params.toString()}`;

    https.get(url, { headers: { 'User-Agent': 'HealthAgent/1.0' } }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          const providers = (data.results || []).map(normalizeProvider);
          resolve({ providers, total: data.result_count || 0, query: options });
        } catch(e) {
          reject(new Error('NPI registry parse error: ' + e.message));
        }
      });
    }).on('error', reject).setTimeout(8000, () => reject(new Error('NPI registry timeout')));
  });
}

function normalizeProvider(raw) {
  const basic = raw.basic || {};
  const addresses = raw.addresses || [];
  const taxonomies = raw.taxonomies || [];
  const identifiers = raw.identifiers || [];

  const practiceAddr = addresses.find(a => a.address_purpose === 'LOCATION') || addresses[0] || {};
  const primaryTaxonomy = taxonomies.find(t => t.primary) || taxonomies[0] || {};

  return {
    npi: raw.number,
    type: raw.enumeration_type === 'NPI-1' ? 'individual' : 'organization',
    name: basic.organization_name ||
      [basic.first_name, basic.middle_name, basic.last_name, basic.credential].filter(Boolean).join(' '),
    firstName: basic.first_name || null,
    lastName: basic.last_name || null,
    credential: basic.credential || null,
    gender: basic.gender || null,
    specialty: primaryTaxonomy.desc || null,
    specialtyCode: primaryTaxonomy.code || null,
    licenseNumber: primaryTaxonomy.license || null,
    licenseState: primaryTaxonomy.state || null,
    address: {
      line1: practiceAddr.address_1 || null,
      line2: practiceAddr.address_2 || null,
      city: practiceAddr.city || null,
      state: practiceAddr.state || null,
      zip: practiceAddr.postal_code?.substring(0,5) || null,
      phone: practiceAddr.telephone_number || null,
      fax: practiceAddr.fax_number || null
    },
    fullAddress: [practiceAddr.address_1, practiceAddr.city, practiceAddr.state, practiceAddr.postal_code?.substring(0,5)].filter(Boolean).join(', '),
    lastUpdated: basic.last_updated || null,
    status: basic.status || null
  };
}

function buildProviderSearchUrl(provider) {
  const name = encodeURIComponent(provider.name || '');
  const loc = encodeURIComponent(provider.address?.city && provider.address?.state ? provider.address.city + ' ' + provider.address.state : 'San Antonio TX');
  return {
    google: `https://www.google.com/search?q=${name}+${encodeURIComponent(provider.specialty||'doctor')}+${loc}`,
    zocdoc: `https://www.zocdoc.com/search?q=${encodeURIComponent(provider.specialty||'doctor')}&address=${loc}`,
    healthgrades: `https://www.healthgrades.com/find-a-doctor/search?q=${name}&location=${loc}`
  };
}

async function lookupNPI(npi) {
  const result = await searchProviders({ npi });
  return result.providers[0] || null;
}

module.exports = { searchProviders, normalizeProvider, buildProviderSearchUrl, lookupNPI };
