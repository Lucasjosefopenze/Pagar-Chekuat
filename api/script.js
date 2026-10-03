const crypto = require("node:crypto");

const API_KEY = "sk_test_CdYHMPgPHHWYeGWicqw1zTb7GtlS6SdI9FfrcCB_q7M";
const SIGNING_SECRET = "sig_test_2cBlDR5QwqiJlr32JqUYsKYODMI4-o_rnU5hCv5Fdkk";

const API_URL = "https://api.pagar.co.mz/api/v1";

const PRODUCT_NAME = "Produto digital";
const PRODUCT_DESCRIPTION = "Compra de produto digital";
const PRODUCT_AMOUNT_MZN = 250;

function json(res, status, data) {
  return res.status(status).json(data);
}

function generateReference() {
  return `pedido-${Date.now()}-${crypto.randomBytes(5).toString("hex")}`;
}

function generateIdempotencyKey(reference) {
  return `payment:${reference}`;
}

async function readResponse(response) {
  let data = {};

  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok) {
    const error = new Error(
      data.message || "Pedido rejeitado pela Pagar API"
    );

    error.code = data.error;
    error.requestId = data.requestId;
    error.status = response.status;
    error.data = data;

    throw error;
  }

  return data;
}

async function pagarGet(path) {
  const response = await fetch(API_URL + path, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      Accept: "application/json"
    }
  });

  return readResponse(response);
}

async function pagarPost(path, body, idempotencyKey) {
  const timestamp = Date.now().toString();

  const nonce = crypto
    .randomBytes(18)
    .toString("base64url");

  const rawBody = JSON.stringify(body);

  const bodyHash = crypto
    .createHash("sha256")
    .update(rawBody)
    .digest("hex");

  const url = API_URL + path;
  const canonicalPath = new URL(url).pathname;

  const canonical = [
    timestamp,
    nonce,
    "POST",
    canonicalPath,
    bodyHash
  ].join("\n");

  const signature = crypto
    .createHmac("sha256", SIGNING_SECRET)
    .update(canonical)
    .digest("hex");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "Idempotency-Key": idempotencyKey,
      "X-Pagar-Timestamp": timestamp,
      "X-Pagar-Nonce": nonce,
      "X-Pagar-Signature": `v1=${signature}`
    },
    body: rawBody
  });

  return readResponse(response);
}

function validatePhone(phone) {
  return /^(82|83|84|85|86|87)\d{7}$/.test(phone);
}

function normalizeMethod(method) {
  const value = String(method || "").toUpperCase();

  if (value === "M-PESA" || value === "MPESA") {
    return "MPESA";
  }

  if (
    value === "E-MOLA" ||
    value === "EMOLA" ||
    value === "E MOLA"
  ) {
    return "EMOLA";
  }

  return null;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, OPTIONS"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type"
  );

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (
    !API_KEY ||
    API_KEY === "COLOCAR API AQUI" ||
    !SIGNING_SECRET ||
    SIGNING_SECRET === "COLAR SECRET AQUI"
  ) {
    return json(res, 500, {
      success: false,
      error: "SERVER_CONFIGURATION_ERROR",
      message: "Configure a API Key e o Signing Secret."
    });
  }

  try {
    if (req.method === "POST") {
      const body =
        typeof req.body === "string"
          ? JSON.parse(req.body)
          : req.body || {};

      const method = normalizeMethod(body.method);

      const payerPhone = String(
        body.payerPhone || ""
      )
        .replace(/\s+/g, "")
        .replace(/^\+258/, "");

      if (!method) {
        return json(res, 400, {
          success: false,
          error: "INVALID_METHOD",
          message: "Método de pagamento inválido."
        });
      }

      if (!validatePhone(payerPhone)) {
        return json(res, 400, {
          success: false,
          error: "INVALID_PHONE",
          message: "Número de telefone inválido."
        });
      }

      const reference = generateReference();

      const idempotencyKey =
        generateIdempotencyKey(reference);

      const paymentBody = {
        reference,
        title: PRODUCT_NAME,
        description: PRODUCT_DESCRIPTION,
        amountMzn: PRODUCT_AMOUNT_MZN,
        method,
        payerPhone
      };

      const result = await pagarPost(
        "/payments",
        paymentBody,
        idempotencyKey
      );

      const payment = result.payment || {};

      return json(res, 202, {
        success: true,
        paymentId: payment.id || null,
        status: payment.status || "PROCESSING",
        payment
      });
    }

    if (req.method === "GET") {
      const action = String(
        req.query?.action || ""
      );

      if (action !== "status") {
        return json(res, 400, {
          success: false,
          error: "INVALID_ACTION",
          message: "Ação inválida."
        });
      }

      const paymentId = String(
        req.query?.paymentId || ""
      ).trim();

      if (!paymentId) {
        return json(res, 400, {
          success: false,
          error: "MISSING_PAYMENT_ID",
          message: "paymentId é obrigatório."
        });
      }

      const result = await pagarGet(
        `/payments/${encodeURIComponent(paymentId)}`
      );

      return json(res, 200, {
        success: true,
        payment: result.payment || result
      });
    }

    return json(res, 405, {
      success: false,
      error: "METHOD_NOT_ALLOWED",
      message: "Método não permitido."
    });

  } catch (error) {
    console.error("Pagar API error:", {
      message: error.message,
      code: error.code,
      status: error.status,
      requestId: error.requestId
    });

    return json(res, error.status || 500, {
      success: false,
      error: error.code || "PAGAR_API_ERROR",
      message:
        error.status && error.status < 500
          ? error.message
          : "Não foi possível processar o pagamento.",
      requestId: error.requestId || null
    });
  }
};
