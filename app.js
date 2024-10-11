const express = require("express");
const axios = require("axios");
const cors = require("cors");
const bodyParser = require("body-parser");
const mysql = require("mysql");
const { Client, LocalAuth } = require("whatsapp-web.js");

const port = 3000;
const app = express();

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cors());

const connection = mysql.createPool({
  host: "localhost",
  user: "root",
  password: "",
  database: "whatsapp_api",
});

const whatsAppClients = new Map(); // Use a Map for quick lookup of clients by ID

// Helper function for executing queries with async/await
const executeQuery = (query, params = []) => {
  return new Promise((resolve, reject) => {
    connection.query(query, params, (err, results) => {
      if (err) return reject(err);
      resolve(results);
    });
  });
};

// Function to initialize existing clients
async function initializeClients() {
  try {
    const clients = await executeQuery(
      `SELECT * FROM whats_app_clients WHERE deleted_at IS NULL AND status = 'active'`
    );
    clients.forEach((client) => {
      generateClient(client.id);
    });
  } catch (error) {
    console.error("Error initializing clients:", error);
  }
}

// Interval for checking new clients
setInterval(async () => {
  console.log("Checking for new clients...");
  try {
    const clients = await executeQuery(
      `SELECT * FROM whats_app_clients WHERE deleted_at IS NULL AND status != 'active'`
    );
    clients.forEach((client) => {
      generateClient(client.id);
    });
  } catch (error) {
    console.error("Error checking new clients:", error);
  }
}, 5000);

// Function for generating a new client
function generateClient(id) {
  // Skip if client already exists
  if (whatsAppClients.has(id)) return;

  const client = new Client({
    webVersionCache: { type: "none" },
    authStrategy: new LocalAuth({
      clientId: id,
      dataPath: `./session_${id}.json`, // Separate session data for each client
    }),
  });

  client.on("qr", async (qr) => {
    try {
      await executeQuery(
        `UPDATE whats_app_clients SET login_qr = ?, status = 'inactive' WHERE id = ?`,
        [qr, id]
      );
    } catch (error) {
      console.error("Error updating QR code:", error);
    }
  });

  client.on("authenticated", async () => {
    try {
      await executeQuery(
        `UPDATE whats_app_clients SET login_qr = NULL WHERE id = ?`,
        [id]
      );
    } catch (error) {
      console.error("Error updating client status:", error);
    }
  });

  client.on("ready", async () => {
    try {
      await executeQuery(
        `UPDATE whats_app_clients SET status = 'active' WHERE id = ?`,
        [id]
      );
    } catch (error) {
      console.error("Error updating client status to active:", error);
    }
  });

  client.on("auth_failure", async () => {
    await handleClientDisconnection(id, client);
  });

  client.on("disconnected", async () => {
    await handleClientDisconnection(id, client);
  });

  client.on("logout", async () => {
    await handleClientDisconnection(id, client);
  });

  client.on("message", async (msg) => {
    if (msg.body.toLowerCase() === "register") {
      await handleRegisterMessage(msg, client);
    } else {
      msg.reply(`Your command is not recognized`);
    }
  });

  client.initialize();
  whatsAppClients.set(id, client);
}

// Function to handle client disconnection
async function handleClientDisconnection(id, client) {
  try {
    await executeQuery(
      `UPDATE whats_app_clients SET status = 'inactive' WHERE id = ?`,
      [id]
    );
  } catch (error) {
    console.error("Error updating client status to inactive:", error);
  }

  client.destroy();
  whatsAppClients.delete(id);
}

// Function to handle registration message
async function handleRegisterMessage(msg, client) {
  const number = msg.from.split("@")[0];
  const randomToken = await generateOTP();

  try {
    await executeQuery(
      `INSERT INTO registration_tokens (phone_number, token, active, created_at, updated_at) VALUES (?, ?, true, NOW(), NOW())`,
      [number, randomToken]
    );

    msg.reply(`Your registration token is ${randomToken}`);

    // save sender's number to table phone_numbers, don't save if already exists
    await savePhoneNumber(number, client);
  } catch (error) {
    console.error("Error inserting registration token:", error);
  }
}

// Function to save phone number
async function savePhoneNumber(number, client) {
  try {
    const existingNumber = await executeQuery(
      `SELECT * FROM phone_numbers WHERE phone_number = ? AND receiver_phone_number = ?`,
      [number, client.info.me.user]
    );

    if (existingNumber.length === 0) {
      await executeQuery(
        `INSERT INTO phone_numbers (phone_number, receiver_phone_number, created_at, updated_at) VALUES (?, ?, NOW(), NOW())`,
        [number, client.info.me.user]
      );
    }
  } catch (error) {
    console.error("Error saving phone number:", error);
  }
}

// Generate 4-digit OTP not in registration_tokens table
async function generateOTP() {
  let randomToken;
  let existingToken;

  do {
    randomToken = Math.floor(1000 + Math.random() * 9000);
    existingToken = await executeQuery(
      `SELECT * FROM registration_tokens WHERE token = ?`,
      [randomToken]
    );
  } while (existingToken.length > 0);

  return randomToken;
}

// Function to send a message
async function requestSendMessage(phone_number, message, client) {
  const clientArray = Array.from(whatsAppClients.values());
  const clientObject = clientArray.find((c) => c.info.me.user === client);

  try {
    await clientObject.sendMessage(
      `${
        phone_number.includes("@c.us") ? phone_number : phone_number + "@c.us"
      }`,
      message
    );
    return "success";
  } catch (error) {
    return "error";
  }
}

// API route to request send message
app.post("/send-message", async (req, res) => {
  const { phone_number, message, client } = req.body;

  if (!phone_number || !message || !client) {
    return res
      .status(400)
      .json({ status: "error", message: "Invalid request" });
  }

  const response = await requestSendMessage(phone_number, message, client);

  if (response === "error") {
    return res
      .status(500)
      .json({
        status: "error",
        message: "Failed to send message, try another client",
      });
  }

  return res
    .status(200)
    .json({ status: "success", message: "Message sent successfully" });
});

console.log(`Server is running on port ${port}`);
app.listen(port, () => {
  initializeClients(); // Initialize clients on server start
});
