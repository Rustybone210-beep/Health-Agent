const TIERS = {
  free: {
    name: "Free",
    price: 0,
    patientsAllowed: 1,
    features: ["1 patient", "AI chat", "Document scanning", "Basic medication tracking"]
  },
  pro: {
    name: "Pro",
    priceMonthly: 999,
    priceYearly: 8999,
    patientsAllowed: 10,
    features: ["10 patients", "Everything in Free", "Rx price comparison", "Lab analyzer", "Drug interactions", "Provider search", "Phone calls", "Email sending", "Priority AI"]
  },
  family: {
    name: "Family",
    priceMonthly: 1499,
    priceYearly: 12999,
    patientsAllowed: 5,
    features: ["5 patients", "Everything in Pro", "Caregiver sharing", "Family dashboard", "Medication reminders", "Adherence tracking"]
  }
};

let stripe = null;
try {
  if (process.env.STRIPE_SECRET_KEY) {
    stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
  }
} catch (e) {
  console.log("Stripe not configured — add STRIPE_SECRET_KEY to .env");
}

async function createCheckoutSession(userId, email, tier, interval) {
  if (!stripe) throw new Error("Stripe not configured");
  const tierInfo = TIERS[tier];
  if (!tierInfo || tier === "free") throw new Error("Invalid tier");

  const price = interval === "yearly" ? tierInfo.priceYearly : tierInfo.priceMonthly;

  const session = await stripe.checkout.sessions.create({
    customer_email: email,
    payment_method_types: ["card"],
    line_items: [{
      price_data: {
        currency: "usd",
        product_data: {
          name: "Health Agent " + tierInfo.name,
          description: tierInfo.features.join(", ")
        },
        unit_amount: price,
        recurring: { interval: interval === "yearly" ? "year" : "month" }
      },
      quantity: 1
    }],
    mode: "subscription",
    success_url: (process.env.APP_URL || "http://localhost:3000") + "/?upgraded=true",
    cancel_url: (process.env.APP_URL || "http://localhost:3000") + "/pricing",
    metadata: { userId, tier }
  });

  return session;
}

async function handleWebhook(payload, sig) {
  if (!stripe) throw new Error("Stripe not configured");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) throw new Error("Webhook secret not configured");

  const event = stripe.webhooks.constructEvent(payload, sig, webhookSecret);

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      const userId = session.metadata?.userId;
      const tier = session.metadata?.tier;
      if (userId && tier) {
        return { action: "upgrade", userId, tier, customerId: session.customer };
      }
      break;
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object;
      return { action: "cancel", customerId: sub.customer };
      break;
    }
    case "invoice.payment_failed": {
      const invoice = event.data.object;
      return { action: "payment_failed", customerId: invoice.customer };
      break;
    }
  }

  return { action: "ignored", type: event.type };
}

async function createPortalSession(customerId) {
  if (!stripe) throw new Error("Stripe not configured");
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: (process.env.APP_URL || "http://localhost:3000") + "/"
  });
  return session;
}

module.exports = { TIERS, createCheckoutSession, handleWebhook, createPortalSession, stripe };
