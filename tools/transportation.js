const fs = require("fs");
const path = require("path");
const RIDES_FILE = path.join(__dirname, "..", "data", "ride_requests.json");

function loadRides() {
  try {
    if (!fs.existsSync(RIDES_FILE)) return [];
    return JSON.parse(fs.readFileSync(RIDES_FILE, "utf8"));
  } catch (e) { return []; }
}

function saveRides(rides) {
  fs.writeFileSync(RIDES_FILE, JSON.stringify(rides, null, 2));
}

function buildRideLinks(pickup, destination, dateTime) {
  const pu = encodeURIComponent(pickup || "");
  const dest = encodeURIComponent(destination || "");
  const links = [];
  links.push({
    name: "Uber",
    url: "https://m.uber.com/ul/?action=setPickup&pickup=my_location&dropoff[formatted_address]=" + dest,
    icon: "🚗",
    description: "Request a ride now"
  });
  links.push({
    name: "Lyft",
    url: "https://lyft.com/ride?destination[address]=" + dest,
    icon: "🚙",
    description: "Request a ride now"
  });
  links.push({
    name: "Google Maps",
    url: "https://www.google.com/maps/dir/" + pu + "/" + dest,
    icon: "🗺️",
    description: "Get driving directions"
  });
  links.push({
    name: "Apple Maps",
    url: "https://maps.apple.com/?daddr=" + dest,
    icon: "📍",
    description: "Get directions"
  });
  return links;
}

function requestRide({ patientId, ownerId, appointmentId, pickup, destination, dateTime, notes, rideType }) {
  const rides = loadRides();
  const ride = {
    id: Date.now().toString(),
    patientId,
    ownerId: ownerId || null,
    appointmentId: appointmentId || null,
    pickup: pickup || "",
    destination: destination || "",
    dateTime: dateTime || new Date().toISOString(),
    notes: notes || "",
    rideType: rideType || "standard",
    status: "requested",
    links: buildRideLinks(pickup, destination, dateTime),
    createdAt: new Date().toISOString()
  };
  rides.push(ride);
  saveRides(rides);
  return ride;
}

function getRides(patientId) {
  return loadRides().filter(r => r.patientId === patientId).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function buildTransportForAppointment(appointment, patientAddress) {
  if (!appointment) return null;
  const dest = appointment.address || appointment.clinic || "";
  if (!dest) return null;
  return {
    appointmentId: appointment.id,
    doctor: appointment.doctorName,
    date: appointment.date,
    time: appointment.time,
    destination: dest,
    pickup: patientAddress || "",
    links: buildRideLinks(patientAddress, dest),
    suggestion: "Appointment with " + (appointment.doctorName || "doctor") + " on " + appointment.date + " at " + (appointment.time || "TBD") + ". Book a ride?"
  };
}

module.exports = { requestRide, getRides, buildRideLinks, buildTransportForAppointment };
