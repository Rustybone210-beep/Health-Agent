const VapiSDK = require("@vapi-ai/server-sdk");
const vapi = new VapiSDK.VapiClient({ token: process.env.VAPI_API_KEY });

async function startPhoneCall(toNumber, reason, patientInfo) {
  try {
    const call = await vapi.calls.create({
      assistantId: process.env.VAPI_ASSISTANT_ID,
      customer: {
        number: toNumber
      },
      assistantOverrides: {
        firstMessage: "Hi, this is the Health Agent calling on behalf of " + (patientInfo.name || "a patient") + ". I'm calling regarding " + reason + ".",
        model: {
          messages: [
            {
              role: "system",
              content: "You are Health Agent, an AI healthcare navigator making a phone call on behalf of a caregiver. You are calling about: " + reason + ". Patient info: Name: " + (patientInfo.name || "Patient") + ", DOB: " + (patientInfo.dob || "on file") + ", Insurance: " + (patientInfo.insurance || "on file") + ". Be professional, efficient, and get the task done. Always confirm details before hanging up."
            }
          ]
        }
      }
    });
    return { callId: call.id, status: call.status, message: "Call initiated successfully" };
  } catch (error) {
    console.error("Vapi call error:", error.message);
    throw error;
  }
}

async function getCallStatus(callId) {
  try {
    const call = await vapi.calls.get(callId);
    return { callId: call.id, status: call.status, duration: call.endedAt ? "Completed" : "In progress" };
  } catch (error) {
    console.error("Call status error:", error.message);
    throw error;
  }
}

module.exports = { startPhoneCall, getCallStatus };
