const fs = require("fs");
const path = require("path");
const PROVIDERS_FILE = path.join(__dirname, "..", "data", "network_providers.json");
const CONNECTIONS_FILE = path.join(__dirname, "..", "data", "network_connections.json");
const PRIORITY_QUEUE_FILE = path.join(__dirname, "..", "data", "priority_queue.json");

// ═══ PROVIDER REGISTRATION ═══

function loadProviders() {
  try {
    if (!fs.existsSync(PROVIDERS_FILE)) return [];
    return JSON.parse(fs.readFileSync(PROVIDERS_FILE, "utf8"));
  } catch (e) { return []; }
}

function saveProviders(providers) {
  fs.writeFileSync(PROVIDERS_FILE, JSON.stringify(providers, null, 2));
}

function registerProvider({ userId, businessName, providerType, specialties, address, phone, fax, email, npi, acceptedInsurance, operatingHours, tier }) {
  const providers = loadProviders();
  const existing = providers.find(p => p.userId === userId);
  if (existing) throw new Error("Provider already registered");

  const provider = {
    id: Date.now().toString(),
    userId,
    businessName: businessName || "",
    providerType: providerType || "clinic",
    specialties: specialties || [],
    address: address || "",
    phone: phone || "",
    fax: fax || "",
    email: email || "",
    npi: npi || "",
    acceptedInsurance: acceptedInsurance || [],
    operatingHours: operatingHours || {},
    tier: tier || "basic",
    verified: false,
    badge: null,
    stats: {
      totalPatients: 0,
      priorityPatients: 0,
      avgResponseTime: null,
      priorAuthSpeed: null,
      patientSatisfaction: null
    },
    features: {
      priorityScheduling: true,
      directLabResults: false,
      electronicRefills: false,
      priorAuthFastTrack: false,
      autoSummaryBeforeVisit: true
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  providers.push(provider);
  saveProviders(providers);
  return provider;
}

function updateProvider(providerId, updates) {
  const providers = loadProviders();
  const p = providers.find(x => x.id === providerId);
  if (!p) return null;
  Object.assign(p, updates, { updatedAt: new Date().toISOString() });
  saveProviders(providers);
  return p;
}

function getProvider(providerId) {
  return loadProviders().find(p => p.id === providerId) || null;
}

function getProviderByUserId(userId) {
  return loadProviders().find(p => p.userId === userId) || null;
}

function searchProviders(filters) {
  let providers = loadProviders();
  if (filters.specialty) {
    providers = providers.filter(p =>
      p.specialties.some(s => s.toLowerCase().includes(filters.specialty.toLowerCase()))
    );
  }
  if (filters.insurance) {
    providers = providers.filter(p =>
      p.acceptedInsurance.some(i => i.toLowerCase().includes(filters.insurance.toLowerCase()))
    );
  }
  if (filters.type) {
    providers = providers.filter(p => p.providerType === filters.type);
  }
  if (filters.verified) {
    providers = providers.filter(p => p.verified);
  }
  return providers;
}

function verifyProvider(providerId) {
  const providers = loadProviders();
  const p = providers.find(x => x.id === providerId);
  if (!p) return null;
  p.verified = true;
  p.badge = "Health Agent Verified Provider";
  p.verifiedAt = new Date().toISOString();
  saveProviders(providers);
  return p;
}

// ═══ PATIENT-PROVIDER CONNECTIONS ═══

function loadConnections() {
  try {
    if (!fs.existsSync(CONNECTIONS_FILE)) return [];
    return JSON.parse(fs.readFileSync(CONNECTIONS_FILE, "utf8"));
  } catch (e) { return []; }
}

function saveConnections(connections) {
  fs.writeFileSync(CONNECTIONS_FILE, JSON.stringify(connections, null, 2));
}

function connectPatientToProvider(patientId, patientUserId, providerId) {
  const connections = loadConnections();
  const existing = connections.find(c =>
    c.patientId === patientId && c.providerId === providerId && c.active
  );
  if (existing) return { already: true, connection: existing };

  const provider = getProvider(providerId);
  if (!provider) throw new Error("Provider not found");

  const connection = {
    id: Date.now().toString(),
    patientId,
    patientUserId,
    providerId,
    providerName: provider.businessName,
    providerUserId: provider.userId,
    status: "active",
    active: true,
    priorityLevel: "standard",
    benefits: [],
    connectedAt: new Date().toISOString()
  };

  // Determine priority benefits
  connection.benefits = calculateBenefits(provider);
  if (provider.verified) {
    connection.priorityLevel = "priority";
  }

  connections.push(connection);
  saveConnections(connections);

  // Update provider stats
  const providers = loadProviders();
  const p = providers.find(x => x.id === providerId);
  if (p) {
    p.stats.totalPatients = (p.stats.totalPatients || 0) + 1;
    if (connection.priorityLevel === "priority") {
      p.stats.priorityPatients = (p.stats.priorityPatients || 0) + 1;
    }
    saveProviders(providers);
  }

  return { connected: true, connection };
}

function calculateBenefits(provider) {
  const benefits = [];
  benefits.push({
    id: "auto_summary",
    name: "Pre-Visit AI Summary",
    description: "Your complete medical summary is sent to " + provider.businessName + " before every appointment",
    active: provider.features.autoSummaryBeforeVisit
  });
  benefits.push({
    id: "priority_scheduling",
    name: "Priority Scheduling",
    description: "Get first-available appointments ahead of non-connected patients",
    active: provider.features.priorityScheduling
  });
  if (provider.features.priorAuthFastTrack) {
    benefits.push({
      id: "fast_auth",
      name: "Fast-Track Prior Authorization",
      description: "Prior authorizations processed in 24-48 hours instead of 5-10 days",
      active: true
    });
  }
  if (provider.features.directLabResults) {
    benefits.push({
      id: "direct_labs",
      name: "Direct Lab Results",
      description: "Lab results flow directly into your Health Agent app — no waiting for a portal",
      active: true
    });
  }
  if (provider.features.electronicRefills) {
    benefits.push({
      id: "e_refills",
      name: "One-Tap Refills",
      description: "Request prescription refills directly through the app",
      active: true
    });
  }
  return benefits;
}

function getPatientConnections(patientId) {
  return loadConnections().filter(c => c.patientId === patientId && c.active);
}

function getProviderConnections(providerId) {
  return loadConnections().filter(c => c.providerId === providerId && c.active);
}

function disconnectPatientFromProvider(connectionId) {
  const connections = loadConnections();
  const c = connections.find(x => x.id === connectionId);
  if (!c) return null;
  c.active = false;
  c.status = "disconnected";
  c.disconnectedAt = new Date().toISOString();
  saveConnections(connections);
  return c;
}

function isConnected(patientId, providerId) {
  return loadConnections().some(c =>
    c.patientId === patientId && c.providerId === providerId && c.active
  );
}

// ═══ PRIORITY QUEUE ═══

function loadQueue() {
  try {
    if (!fs.existsSync(PRIORITY_QUEUE_FILE)) return [];
    return JSON.parse(fs.readFileSync(PRIORITY_QUEUE_FILE, "utf8"));
  } catch (e) { return []; }
}

function saveQueue(queue) {
  fs.writeFileSync(PRIORITY_QUEUE_FILE, JSON.stringify(queue, null, 2));
}

function submitPriorityRequest({ patientId, patientUserId, providerId, requestType, details, urgency }) {
  const queue = loadQueue();
  const connected = isConnected(patientId, providerId);

  const request = {
    id: Date.now().toString(),
    patientId,
    patientUserId,
    providerId,
    requestType: requestType || "appointment",
    details: details || "",
    urgency: urgency || "routine",
    priority: connected ? "high" : "standard",
    networkConnected: connected,
    position: null,
    status: "submitted",
    estimatedResponse: connected ? "24 hours" : "3-5 business days",
    submittedAt: new Date().toISOString(),
    respondedAt: null,
    response: null
  };

  // Calculate queue position
  const providerQueue = queue.filter(q =>
    q.providerId === providerId && q.status !== "completed" && q.status !== "cancelled"
  );

  if (connected) {
    // Priority patients go before standard patients
    const standardStart = providerQueue.findIndex(q => !q.networkConnected);
    request.position = standardStart >= 0 ? standardStart + 1 : providerQueue.length + 1;
  } else {
    request.position = providerQueue.length + 1;
  }

  queue.push(request);
  saveQueue(queue);
  return request;
}

function respondToRequest(requestId, response, status) {
  const queue = loadQueue();
  const r = queue.find(x => x.id === requestId);
  if (!r) return null;
  r.response = response;
  r.status = status || "completed";
  r.respondedAt = new Date().toISOString();
  const responseTime = new Date(r.respondedAt).getTime() - new Date(r.submittedAt).getTime();
  r.responseTimeHours = Math.round(responseTime / (1000 * 60 * 60) * 10) / 10;
  saveQueue(queue);
  return r;
}

function getPatientQueue(patientId) {
  return loadQueue()
    .filter(q => q.patientId === patientId)
    .sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
}

function getProviderQueue(providerId) {
  return loadQueue()
    .filter(q => q.providerId === providerId && q.status !== "completed" && q.status !== "cancelled")
    .sort((a, b) => {
      // Priority patients first
      if (a.networkConnected && !b.networkConnected) return -1;
      if (!a.networkConnected && b.networkConnected) return 1;
      // Then by urgency
      const urgencyOrder = { emergency: 0, urgent: 1, routine: 2 };
      const ua = urgencyOrder[a.urgency] || 2;
      const ub = urgencyOrder[b.urgency] || 2;
      if (ua !== ub) return ua - ub;
      // Then by submission time
      return new Date(a.submittedAt) - new Date(b.submittedAt);
    });
}

// ═══ PROVIDER DASHBOARD DATA ═══

function getProviderDashboard(providerId) {
  const provider = getProvider(providerId);
  if (!provider) return null;
  const connections = getProviderConnections(providerId);
  const queue = getProviderQueue(providerId);
  const allRequests = loadQueue().filter(q => q.providerId === providerId);
  const completed = allRequests.filter(q => q.status === "completed");
  const avgResponseTime = completed.length > 0
    ? Math.round(completed.reduce((sum, q) => sum + (q.responseTimeHours || 0), 0) / completed.length * 10) / 10
    : null;

  return {
    provider: {
      id: provider.id,
      name: provider.businessName,
      verified: provider.verified,
      badge: provider.badge,
      tier: provider.tier
    },
    stats: {
      connectedPatients: connections.length,
      activeQueue: queue.length,
      priorityInQueue: queue.filter(q => q.networkConnected).length,
      standardInQueue: queue.filter(q => !q.networkConnected).length,
      totalRequestsHandled: completed.length,
      avgResponseTimeHours: avgResponseTime
    },
    queue: queue.slice(0, 50),
    recentCompleted: completed.slice(-10).reverse()
  };
}

// ═══ NETWORK ANALYTICS ═══

function getNetworkStats() {
  const providers = loadProviders();
  const connections = loadConnections();
  const queue = loadQueue();

  return {
    totalProviders: providers.length,
    verifiedProviders: providers.filter(p => p.verified).length,
    totalConnections: connections.filter(c => c.active).length,
    totalRequests: queue.length,
    priorityRequests: queue.filter(q => q.networkConnected).length,
    avgPriorityResponseHours: calcAvgResponse(queue.filter(q => q.networkConnected && q.status === "completed")),
    avgStandardResponseHours: calcAvgResponse(queue.filter(q => !q.networkConnected && q.status === "completed")),
    providersByType: {
      clinic: providers.filter(p => p.providerType === "clinic").length,
      hospital: providers.filter(p => p.providerType === "hospital").length,
      pharmacy: providers.filter(p => p.providerType === "pharmacy").length,
      lab: providers.filter(p => p.providerType === "lab").length,
      specialist: providers.filter(p => p.providerType === "specialist").length,
      insurance: providers.filter(p => p.providerType === "insurance").length
    }
  };
}

function calcAvgResponse(requests) {
  if (!requests.length) return null;
  return Math.round(requests.reduce((s, r) => s + (r.responseTimeHours || 0), 0) / requests.length * 10) / 10;
}

module.exports = {
  registerProvider, updateProvider, getProvider, getProviderByUserId,
  searchProviders, verifyProvider,
  connectPatientToProvider, getPatientConnections, getProviderConnections,
  disconnectPatientFromProvider, isConnected,
  submitPriorityRequest, respondToRequest, getPatientQueue, getProviderQueue,
  getProviderDashboard, getNetworkStats
};
