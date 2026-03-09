const VapiSDK = require("@vapi-ai/server-sdk");
const vapi = new VapiSDK.VapiClient({ token: process.env.VAPI_API_KEY });

async function startPhoneCall(toNumber, reason, patientInfo) {
  try {
    const call = await vapi.calls.create({
      assistantId: process.env.VAPI_ASSISTANT_ID,
      phoneNumberId: process.env.VAPI_PHONE_NUMBER_ID,
      customer: {
        number: toNumber
      }
    });
    return { callId: call.id, status: call.status, message: "Call initiated to " + toNumber };
  } catch (error) {
    console.error("Vapi call error:", error.message);
    throw error;
  }
}

async function getCallStatus(callId) {
  try {
    const call = await vapi.calls.get(callId);
    return { callId: call.id, status: call.status };
  } catch (error) {
    console.error("Call status error:", error.message);
    throw error;
  }
}

module.exports = { startPhoneCall, getCallStatus };
