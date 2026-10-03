const crypto = require("node:crypto");

const API_URL = "https://api.pagar.co.mz/api/v1";

const API_KEY = "sk_test_CdYHMPgPHHWYeGWicqw1zTb7GtlS6SdI9FfrcCB_q7M";
const SIGNING_SECRET = "sig_test_2cBlDR5QwqiJlr32JqUYsKYODMI4-o_rnU5hCv5Fdkk";
const WEBHOOK_SECRET = "COLAR WEBHOOK SECRET LIVE AQUI";

const PRODUCT_NAME = "Produto digital";
const PRODUCT_DESCRIPTION = "Compra de produto digital";
const PRODUCT_AMOUNT_MZN = 250;

function send(res, status, data) {
  res.status(status).json(data);
}

function reference() {
  return `pedido-${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
}

function validatePhone(phone) {
  return /^(82|83|84|85|86|87)\d{7}$/.test(phone);
}

function normalizeMethod(method) {
  const value = String(method || "").toUpperCase();

  if (value === "MPESA" || value === "M-PESA") {
    return "MPESA";
  }

  if (
    value === "EMOLA" ||
    value === "E-MOLA" ||
    value === "E MOLA"
  ) {
    return "EMOLA";
  }

  return null;
}

async function responseData(response) {
  let data = {};

  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok) {
    const error = new Error(
      data.message || "Erro na Pagar API"
    );

    error.status = response.status;
    error.code = data.error;
    error.requestId = data.requestId;

    throw error;
  }

  return data;
}

async function pagarGet(path) {
  const response = await fetch(
    API_URL + path,
    {
      method: "GET",
      headers: {
        Authorization: "Bearer " + API_KEY,
        Accept: "application/json"
      }
    }
  );

  return responseData(response);
}

async function pagarPost(
  path,
  body,
  idempotencyKey
) {
  const timestamp =
    Date.now().toString();

  const nonce =
    crypto.randomBytes(18).toString("base64url");

  const rawBody =
    JSON.stringify(body);

  const bodyHash =
    crypto
      .createHash("sha256")
      .update(rawBody)
      .digest("hex");

  const url =
    API_URL + path;

  const canonicalPath =
    new URL(url).pathname;

  const canonical = [
    timestamp,
    nonce,
    "POST",
    canonicalPath,
    bodyHash
  ].join("\n");

  const signature =
    crypto
      .createHmac(
        "sha256",
        SIGNING_SECRET
      )
      .update(canonical)
      .digest("hex");

  const response =
    await fetch(url, {
      method: "POST",

      headers: {
        Authorization:
          "Bearer " + API_KEY,

        "Content-Type":
          "application/json",

        Accept:
          "application/json",

        "Idempotency-Key":
          idempotencyKey,

        "X-Pagar-Timestamp":
          timestamp,

        "X-Pagar-Nonce":
          nonce,

        "X-Pagar-Signature":
          "v1=" + signature
      },

      body: rawBody
    });

  return responseData(response);
}

async function getRawBody(req) {
  if (Buffer.isBuffer(req.body)) {
    return req.body;
  }

  if (typeof req.body === "string") {
    return Buffer.from(req.body);
  }

  return await new Promise(
    (resolve, reject) => {
      const chunks = [];

      req.on(
        "data",
        chunk => {
          chunks.push(
            Buffer.isBuffer(chunk)
              ? chunk
              : Buffer.from(chunk)
          );
        }
      );

      req.on(
        "end",
        () => {
          resolve(
            Buffer.concat(chunks)
          );
        }
      );

      req.on(
        "error",
        reject
      );
    }
  );
}

function verifyWebhook(
  rawBody,
  eventId,
  signatureHeader
) {
  if (!eventId) {
    return false;
  }

  if (!signatureHeader) {
    return false;
  }

  const parts =
    Object.fromEntries(
      signatureHeader
        .split(",")
        .map(part => {
          const index =
            part.indexOf("=");

          if (index === -1) {
            return [
              part.trim(),
              ""
            ];
          }

          return [
            part
              .slice(0, index)
              .trim(),

            part
              .slice(index + 1)
              .trim()
          ];
        })
    );

  const timestamp =
    parts.t;

  const received =
    parts.v1;

  if (
    !/^\d+$/.test(
      timestamp || ""
    )
  ) {
    return false;
  }

  if (
    !/^[a-f0-9]{64}$/.test(
      received || ""
    )
  ) {
    return false;
  }

  const timestampSeconds =
    Number(timestamp);

  if (
    Math.abs(
      Date.now() / 1000 -
      timestampSeconds
    ) > 300
  ) {
    return false;
  }

  const expected =
    crypto
      .createHmac(
        "sha256",
        WEBHOOK_SECRET
      )
      .update(
        timestamp +
        "." +
        rawBody.toString("utf8")
      )
      .digest("hex");

  const receivedBuffer =
    Buffer.from(
      received,
      "hex"
    );

  const expectedBuffer =
    Buffer.from(
      expected,
      "hex"
    );

  if (
    receivedBuffer.length !==
    expectedBuffer.length
  ) {
    return false;
  }

  return crypto.timingSafeEqual(
    receivedBuffer,
    expectedBuffer
  );
}

module.exports.config = {
  api: {
    bodyParser: false
  }
};

module.exports = async function handler(
  req,
  res
) {
  res.setHeader(
    "Access-Control-Allow-Origin",
    "*"
  );

  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, OPTIONS"
  );

  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Pagar-Signature, Pagar-Event-Id"
  );

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  try {
    const url = new URL(
      req.url,
      "https://localhost"
    );

    const action =
      url.searchParams.get("action");

    if (
      req.method === "POST" &&
      action === "webhook"
    ) {
      const rawBody =
        await getRawBody(req);

      const eventId =
        req.headers[
          "pagar-event-id"
        ];

      const signature =
        req.headers[
          "pagar-signature"
        ] || "";

      const valid =
        verifyWebhook(
          rawBody,
          eventId,
          signature
        );

      if (!valid) {
        return res
          .status(401)
          .json({
            success: false,
            error:
              "INVALID_WEBHOOK_SIGNATURE"
          });
      }

      let event;

      try {
        event =
          JSON.parse(
            rawBody.toString("utf8")
          );
      } catch {
        return res
          .status(400)
          .json({
            success: false,
            error:
              "INVALID_WEBHOOK_BODY"
          });
      }

      console.log(
        "PAGAR WEBHOOK",
        JSON.stringify({
          eventId,
          event
        })
      );

      return res
        .status(200)
        .json({
          success: true
        });
    }

    if (
      req.method === "POST"
    ) {
      let body = req.body;

      if (
        typeof body === "string"
      ) {
        body =
          JSON.parse(body);
      }

      body =
        body || {};

      const method =
        normalizeMethod(
          body.method
        );

      let payerPhone =
        String(
          body.payerPhone || ""
        )
          .replace(/\s+/g, "")
          .replace(
            /^\+258/,
            ""
          );

      if (!method) {
        return send(
          res,
          400,
          {
            success: false,
            error:
              "INVALID_METHOD",
            message:
              "Método de pagamento inválido."
          }
        );
      }

      if (
        !validatePhone(
          payerPhone
        )
      ) {
        return send(
          res,
          400,
          {
            success: false,
            error:
              "INVALID_PHONE",
            message:
              "Número de telefone inválido."
          }
        );
      }

      const orderReference =
        reference();

      const idempotencyKey =
        "payment:" +
        orderReference;

      const paymentRequest = {
        reference:
          orderReference,

        title:
          PRODUCT_NAME,

        description:
          PRODUCT_DESCRIPTION,

        amountMzn:
          PRODUCT_AMOUNT_MZN,

        method,

        payerPhone
      };

      const result =
        await pagarPost(
          "/payments",
          paymentRequest,
          idempotencyKey
        );

      const payment =
        result.payment || {};

      return send(
        res,
        202,
        {
          success: true,

          paymentId:
            payment.id || null,

          status:
            payment.status ||
            "PROCESSING",

          payment
        }
      );
    }

    if (
      req.method === "GET" &&
      action === "status"
    ) {
      const paymentId =
        url.searchParams.get(
          "paymentId"
        );

      if (!paymentId) {
        return send(
          res,
          400,
          {
            success: false,
            error:
              "MISSING_PAYMENT_ID",
            message:
              "paymentId é obrigatório."
          }
        );
      }

      const result =
        await pagarGet(
          "/payments/" +
          encodeURIComponent(
            paymentId
          )
        );

      const payment =
        result.payment ||
        result;

      return send(
        res,
        200,
        {
          success: true,
          payment
        }
      );
    }

    if (
      req.method === "GET" &&
      action === "reference"
    ) {
      const value =
        url.searchParams.get(
          "reference"
        );

      if (!value) {
        return send(
          res,
          400,
          {
            success: false,
            error:
              "MISSING_REFERENCE"
          }
        );
      }

      const result =
        await pagarGet(
          "/payments/by-reference/" +
          encodeURIComponent(
            value
          )
        );

      return send(
        res,
        200,
        {
          success: true,
          payment:
            result.payment ||
            result
        }
      );
    }

    return send(
      res,
      404,
      {
        success: false,
        error:
          "ENDPOINT_NOT_FOUND"
      }
    );

  } catch (error) {
    console.error(
      "PAGAR ERROR",
      {
        message:
          error.message,

        status:
          error.status,

        code:
          error.code,

        requestId:
          error.requestId
      }
    );

    return send(
      res,
      error.status || 500,
      {
        success: false,

        error:
          error.code ||
          "PAGAR_API_ERROR",

        message:
          error.status &&
          error.status < 500
            ? error.message
            : "Não foi possível processar o pagamento.",

        requestId:
          error.requestId ||
          null
      }
    );
  }
};
