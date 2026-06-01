const https = require("https");
const http  = require("http");

// ── Cashfree Production Credentials ────────────────────────────────────────
const APP_ID    = process.env.CASHFREE_APP_ID    || "11085212bfc8f80fc1248c655a81258011";
const SECRET    = process.env.CASHFREE_SECRET    || "cfsk_ma_prod_0cd77743f25070a41ac286fb603b6c17_3c99769a";
const CF_URL    = "api.cashfree.com";
const SITE_URL  = process.env.SITE_URL || "https://affluentconsultancy.in";
const PORT      = process.env.PORT || 3000;

// ── HTTPS request helper ────────────────────────────────────────────────────
function httpsReq(method, hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const buf = body ? Buffer.from(body, "utf8") : null;
    const opts = {
      hostname,
      path,
      method,
      headers: buf ? { ...headers, "Content-Length": buf.length } : headers
    };
    const req = https.request(opts, (res) => {
      let raw = "";
      res.on("data", c => raw += c);
      res.on("end", () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(raw) }); }
        catch (e) { reject(new Error("Bad JSON: " + raw.substring(0, 300))); }
      });
    });
    req.on("error", reject);
    if (buf) req.write(buf);
    req.end();
  });
}

// ── Parse POST body ─────────────────────────────────────────────────────────
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", c => raw += c);
    req.on("end", () => {
      try { resolve(JSON.parse(raw || "{}")); }
      catch (e) { resolve({}); }
    });
    req.on("error", reject);
  });
}

// ── Server ──────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {

  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Content-Type", "application/json");

  if (req.method === "OPTIONS") { res.writeHead(200); res.end(); return; }

  const url = req.url.split("?")[0];

  // Health check
  if (req.method === "GET" && url === "/") {
    res.writeHead(200);
    res.end(JSON.stringify({ status: "Affluent Consultancy Payment Server is running!" }));
    return;
  }

  // ── Payment endpoint ──────────────────────────────────────────────────────
  if (req.method === "POST" && url === "/payment") {
    try {
      const body   = await parseBody(req);
      const amount = parseFloat(body.amount);
      const name   = String(body.name  || "Customer").trim();
      const phone  = String(body.phone || "9999999999").trim();
      const email  = String(body.email || "no-reply@affluentconsultancy.in").trim();

      if (!amount || amount < 1) {
        res.writeHead(400);
        res.end(JSON.stringify({ success: false, error: "Enter a valid amount (minimum ₹1)." }));
        return;
      }

      const orderId   = "ACS" + Date.now() + Math.random().toString(36).substr(2, 4).toUpperCase();
      const returnUrl = SITE_URL + "/payments/status/?order_id=" + orderId;

      // Cashfree Create Order API
      const payload = JSON.stringify({
        order_id:       orderId,
        order_amount:   amount,
        order_currency: "INR",
        customer_details: {
          customer_id:    "CUST_" + Date.now(),
          customer_name:  name,
          customer_phone: phone,
          customer_email: email
        },
        order_meta: {
          return_url: returnUrl,
          notify_url: SITE_URL + "/api/webhook"
        }
      });

      console.log("Creating Cashfree order:", orderId, "amount:", amount);

      let result;
      try {
        result = await httpsReq(
          "POST",
          CF_URL,
          "/pg/orders",
          {
            "Content-Type":  "application/json",
            "x-api-version": "2023-08-01",
            "x-client-id":   APP_ID,
            "x-client-secret": SECRET
          },
          payload
        );
      } catch (e) {
        console.error("Cashfree error:", e.message);
        res.writeHead(502);
        res.end(JSON.stringify({ success: false, error: "Could not reach payment gateway. Try again." }));
        return;
      }

      console.log("Cashfree response:", JSON.stringify(result.data));

      // Cashfree returns payment_session_id on success
      if (result.data && result.data.payment_session_id) {
        res.writeHead(200);
        res.end(JSON.stringify({
          success:           true,
          payment_session_id: result.data.payment_session_id,
          order_id:          orderId,
          order_token:       result.data.order_token || ""
        }));
        return;
      }

      res.writeHead(502);
      res.end(JSON.stringify({
        success: false,
        error:   result.data?.message || "Payment gateway error. Please try again.",
        detail:  result.data
      }));

    } catch (err) {
      console.error("Unhandled:", err.message);
      res.writeHead(500);
      res.end(JSON.stringify({ success: false, error: "Server error: " + err.message }));
    }
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(PORT, () => {
  console.log("Payment server running on port " + PORT);
});
