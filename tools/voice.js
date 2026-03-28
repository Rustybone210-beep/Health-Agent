const VapiSDK = require("@vapi-ai/server-sdk");
const vapi = new VapiSDK.VapiClient({ token: process.env.VAPI_API_KEY });

/**
 * Start an intelligent phone call with full patient context and call scripts
 */
async function startPhoneCall(toNumber, reason, patientInfo) {
  try {
    const patient = patientInfo || {};
    const callContext = buildCallContext(reason, patient);

    const call = await vapi.calls.create({
      assistantId: process.env.VAPI_ASSISTANT_ID,
      phoneNumberId: process.env.VAPI_PHONE_NUMBER_ID,
      customer: {
        number: toNumber
      },
      assistantOverrides: {
        firstMessage: callContext.greeting,
        model: {
          provider: "anthropic",
          model: "claude-sonnet-4-20250514",
          messages: [{
            role: "system",
            content: callContext.systemPrompt
          }]
        },
        voice: {
          provider: "11labs",
          voiceId: "21m00Tcm4TlvDq8ikWAM", // Rachel — professional, warm
        }
      }
    });

    return {
      callId: call.id,
      status: call.status,
      message: "Call initiated to " + toNumber,
      context: callContext.summary
    };
  } catch (error) {
    console.error("Vapi call error:", error.message);
    throw error;
  }
}

/**
 * Build intelligent call context based on reason and patient info
 */
function buildCallContext(reason, patient) {
  const name = patient.name || "the patient";
  const dob = patient.dob || "on file";
  const insurance = patient.insurance?.primary || "insurance on file";
  const memberId = patient.insurance?.memberId || "member ID on file";
  const doctor = patient.primaryDoctor || "their doctor";
  const pharmacy = patient.pharmacy?.name || "their pharmacy";
  const pharmacyPhone = patient.pharmacy?.phone || "";

  const reasonLower = (reason || "").toLowerCase();

  // Detect call type and build appropriate script
  let callType = "general";
  let greeting = "";
  let script = "";
  let objectionHandlers = "";

  if (reasonLower.includes("appointment") || reasonLower.includes("schedule")) {
    callType = "scheduling";
    greeting = `Hello, I'm calling on behalf of ${name} to schedule an appointment.`;
    script = `
PURPOSE: Schedule an appointment for ${name}.
PATIENT INFO: Name: ${name}, DOB: ${dob}, Insurance: ${insurance}, Member ID: ${memberId}

SCRIPT:
1. Identify yourself: "I'm calling on behalf of ${name}, date of birth ${dob}"
2. State the purpose: "${reason}"
3. Ask for available times
4. Confirm insurance is accepted: "${insurance}"
5. Ask about any prep instructions or requirements
6. Get confirmation number
7. Repeat back the appointment details to confirm

IF ASKED FOR AUTHORIZATION: Say "I am ${name}'s authorized healthcare representative. I have a signed caregiver authorization on file. I can provide the patient's date of birth and insurance information to verify."
`;
  } else if (reasonLower.includes("refill") || reasonLower.includes("prescription") || reasonLower.includes("pharmacy") || reasonLower.includes("medication")) {
    callType = "pharmacy";
    greeting = `Hello, I'm calling on behalf of ${name} regarding a prescription.`;
    script = `
PURPOSE: Handle prescription/refill for ${name}.
PATIENT INFO: Name: ${name}, DOB: ${dob}, Insurance: ${insurance}, Member ID: ${memberId}, Pharmacy: ${pharmacy}

SCRIPT:
1. Identify yourself: "I'm calling on behalf of ${name}, date of birth ${dob}"
2. State the purpose: "${reason}"
3. If checking status: Ask for the current status of the prescription
4. If requesting refill: Provide Rx number if available, ask about refill timeline
5. ALWAYS ask about the cost/copay: "What will the patient's out-of-pocket cost be?"
6. If cost is high (>$100): Ask "Are there any manufacturer coupons, patient assistance programs, or generic alternatives available?"
7. Ask about pickup/delivery timeline
8. Get a reference number for this call

IF COST IS VERY HIGH ($500+):
- Ask: "Is there a prior authorization that could reduce the cost?"
- Ask: "Can you check if a different tier medication is available?"
- Ask: "Is there a specialty pharmacy program with better pricing?"
- Ask: "Can you provide the cash price vs insurance price?"

IF ASKED FOR AUTHORIZATION: Say "I am ${name}'s authorized caregiver and healthcare representative. I have a signed authorization on file. The patient's date of birth is ${dob} and insurance is ${insurance}, member ID ${memberId}."

IF THEY NEED THE PATIENT TO AUTHORIZE:
- Say "I understand. Can we do a three-way call so the patient can provide verbal authorization?"
- If not: "Can you note on the account that I will have the patient call to add me as an authorized representative? What number should they call?"
`;
  } else if (reasonLower.includes("insurance") || reasonLower.includes("claim") || reasonLower.includes("denial") || reasonLower.includes("appeal") || reasonLower.includes("refund")) {
    callType = "insurance";
    greeting = `Hello, I'm calling on behalf of ${name} regarding an insurance matter.`;
    script = `
PURPOSE: Handle insurance issue for ${name}.
PATIENT INFO: Name: ${name}, DOB: ${dob}, Insurance: ${insurance}, Member ID: ${memberId}

SCRIPT:
1. Identify yourself: "I'm calling on behalf of ${name}, member ID ${memberId}, date of birth ${dob}"
2. State the purpose: "${reason}"
3. Get the representative's name and direct number
4. Get a reference number for this call

IF DEALING WITH A CLAIM/DENIAL:
- Ask for the claim number and date of service
- Ask for the specific denial reason code
- Ask: "What is the appeals process and deadline?"
- Ask: "Can you provide the fax number for appeals?"
- Ask: "What additional documentation is needed?"

IF DEALING WITH A REFUND:
- Ask: "What is the current status of the refund?"
- Ask: "When was the refund processed and what is the expected timeline?"
- If being delayed: "Medicare/insurance has confirmed payment. The provider has been paid. There is no reason to hold the patient's refund. Can I speak with a supervisor?"
- Get a commitment date in writing: "Can you confirm the refund date in writing via email or mail?"

IF ASKED FOR AUTHORIZATION: "I am ${name}'s authorized healthcare representative. The patient's date of birth is ${dob} and member ID is ${memberId}."

IF THEY REFUSE TO HELP:
- Ask for a supervisor
- Reference: "Under Medicare regulations, authorized representatives have the right to act on behalf of beneficiaries"
- Get their name and employee ID
`;
  } else if (reasonLower.includes("doctor") || reasonLower.includes("provider") || reasonLower.includes("office") || reasonLower.includes("records")) {
    callType = "provider";
    greeting = `Hello, I'm calling on behalf of ${name}, a patient of ${doctor}.`;
    script = `
PURPOSE: Contact provider for ${name}.
PATIENT INFO: Name: ${name}, DOB: ${dob}, Insurance: ${insurance}, Doctor: ${doctor}

SCRIPT:
1. Identify yourself: "I'm calling on behalf of ${name}, date of birth ${dob}, a patient of ${doctor}"
2. State the purpose: "${reason}"
3. If results/records: Ask for the status and how to obtain them
4. If referral needed: Ask about the referral process and timeline
5. If follow-up needed: Ask about available appointments

IF ASKED FOR AUTHORIZATION: "I am ${name}'s authorized caregiver. I have a signed HIPAA authorization on file. The patient's date of birth is ${dob}."

IF REQUESTING RECORDS TRANSFER:
- Ask for their fax number to receive the records request form
- Ask about the timeline for records transfer (typically 30 days by law)
- Ask about any fees for records copies
`;
  } else {
    greeting = `Hello, I'm calling on behalf of ${name}.`;
    script = `
PURPOSE: ${reason}
PATIENT INFO: Name: ${name}, DOB: ${dob}, Insurance: ${insurance}, Member ID: ${memberId}

SCRIPT:
1. Identify yourself: "I'm calling on behalf of ${name}, date of birth ${dob}"
2. State the purpose clearly: "${reason}"
3. Get the representative's name
4. Take detailed notes on what they say
5. Get a reference/confirmation number
6. Ask about next steps and timeline

IF ASKED FOR AUTHORIZATION: "I am ${name}'s authorized healthcare representative and caregiver. The patient's date of birth is ${dob}."
`;
  }

  const systemPrompt = `You are a professional healthcare representative making a phone call on behalf of a patient. You are warm, confident, knowledgeable, and persistent. You speak clearly and professionally.

CRITICAL RULES:
- You are AUTHORIZED to speak on behalf of ${name}. You are their caregiver with signed authorization.
- NEVER give up if they say you're not authorized. Escalate to supervisor if needed.
- ALWAYS get a reference number or confirmation number for every call.
- ALWAYS get the name of the person you're speaking with.
- ALWAYS ask about costs, copays, and out-of-pocket expenses.
- If put on hold, wait patiently. If transferred, re-introduce yourself.
- If you get a voicemail, leave a clear message with callback number.
- Be polite but firm. You are advocating for your patient.
- If someone is evasive about refunds or payments owed to the patient, escalate immediately.
- Take detailed notes of everything discussed.

PATIENT INFORMATION:
- Name: ${name}
- Date of Birth: ${dob}
- Insurance: ${insurance}
- Member ID: ${memberId}
- Primary Doctor: ${doctor}
- Pharmacy: ${pharmacy} ${pharmacyPhone}

CALL TYPE: ${callType}
${script}

COMMON OBJECTION HANDLERS:
- "We need the patient to call" → "I am the patient's authorized representative. Can we do a three-way call, or can you note my authorization on the account?"
- "We can't discuss this" → "I have a signed HIPAA authorization and caregiver designation. The patient's DOB is ${dob} for verification."
- "You need to submit that in writing" → "I can do that. What is the fax number and mailing address? What should be included in the written request?"
- "The doctor/manager is not available" → "I understand. When is the best time to reach them? Can I leave a message and get a callback?"
- "We're still processing" → "What is the expected completion date? Can I get a reference number to follow up?"
- "That's our policy" → "I understand your policy. However, [state the patient's rights]. May I speak with a supervisor about this?"

AFTER THE CALL:
Summarize everything that happened: who you spoke with, what was discussed, what was agreed, reference numbers, next steps, and any follow-up needed.`;

  return {
    greeting,
    systemPrompt,
    summary: `${callType} call for ${name}: ${reason}`,
    callType
  };
}

async function getCallStatus(callId) {
  try {
    const call = await vapi.calls.get(callId);
    return {
      callId: call.id,
      status: call.status,
      duration: call.duration,
      transcript: call.transcript,
      summary: call.summary,
      recordingUrl: call.recordingUrl
    };
  } catch (error) {
    console.error("Call status error:", error.message);
    throw error;
  }
}

module.exports = { startPhoneCall, getCallStatus, buildCallContext };
