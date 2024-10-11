const express = require("express");
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

const whatsAppClients = [];

// interval for checking new clients
setInterval(() => {
  connection.query(`SELECT * FROM whats_app_clients WHERE deleted_at IS NULL AND status != 'active'`, (err, rows, fields) => {
    if (err) throw err;

    // Loop through all the rows of whats_app_clients table
    rows.forEach((row) => {
      generateCLient(row.id);
    });
  });
}, 2000);

// function for generating new client
function generateCLient(id) {
  // if id already exists in the array, then skip
  if (whatsAppClients.find((client) => client.id == id)) {
    return;
  }

  // initialize the client
  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: id,
      dataPath: "./session.json",
    }),
  });

  // set the login qr code when the client is not authenticated
  client.on("qr", (qr) => {
    connection.query(
      `UPDATE whats_app_clients SET login_qr = '${qr}', status = 'inactive' WHERE id = ${id}`,
      (err, rows, fields) => {
        if (err) throw err;
      }
    );
  });

  // remove login qr code when the client is authenticated
  client.on("authenticated", () => {
    connection.query(
      `UPDATE whats_app_clients SET login_qr = null WHERE id = ${id}`,
      (err, rows, fields) => {
        if (err) throw err;
      }
    );
  });

  // set the status to active when the client is ready
  client.on("ready", () => {
    connection.query(
      `UPDATE whats_app_clients SET status = 'active' WHERE id = ${id}`,
      (err, rows, fields) => {
        if (err) throw err;
      }
    );
  });

  // set the status to inactive, when the client is authenticated failed
  client.on("auth_failure", () => {
    connection.query(
      `UPDATE whats_app_clients SET status = 'inactive' WHERE id = ${id}`,
      (err, rows, fields) => {
        if (err) throw err;
      }
    );

    // destroy the client and remove from the array
    // client.destroy();
    // whatsAppClients.splice(whatsAppClients.indexOf(whatsAppClients.find((client) => client.id == id)), 1);
  });

  // set the status to inactive, when the client is disconnected
  client.on("disconnected", () => {
    connection.query(
      `UPDATE whats_app_clients SET status = 'inactive' WHERE id = ${id}`,
      (err, rows, fields) => {
        if (err) throw err;
      }
    );

    // destroy the client and remove from the array
    // client.destroy();
    whatsAppClients.splice(whatsAppClients.indexOf(whatsAppClients.find((client) => client.id == id)), 1);
  });

  // set the status to inactive, when the client is logged out
  client.on("logout", () => {
    connection.query(
      `UPDATE whats_app_clients SET status = 'inactive' WHERE id = ${id}`,
      (err, rows, fields) => {
        if (err) throw err;
      }
    );

    // destroy the client and remove from the array
    // client.destroy();
    whatsAppClients.splice(whatsAppClients.indexOf(whatsAppClients.find((client) => client.id == id)), 1);
  });

  // when the client receives a message with the content "register", it will send a random token to the user as a OTP
  client.on("message", (msg) => {
    if (msg.body.toLocaleLowerCase() == "register") {
      let number = msg.from.split("@")[0];
      let randomToken = generateOTP();

      connection.query(
        `INSERT INTO registration_tokens (phone_number, token, active, created_at, updated_at) VALUES ('${number}', '${randomToken}', true, NOW(), NOW())`,
        (err, rows, fields) => {
          if (err) throw err;
        }
      );

      msg.reply(`Your registration token is ${randomToken}`);
    }
  });

  // initialize the client
  client.initialize();

  // add the client to the array with id and client object
  whatsAppClients.push({ id: id, client: client });
}

// generate 4 digit OTP and not in registration_tokens table
function generateOTP() {
  let randomToken = Math.floor(1000 + Math.random() * 9000);

  connection.query(
    `SELECT * FROM registration_tokens WHERE token = '${randomToken}'`,
    (err, rows, fields) => {
      if (rows.length > 0) {
        generateOTP();
      } else {
        return randomToken;
      }
    }
  );

  return randomToken;
}

// function to send message
function requestSendMessage(phone_number, message, client = 0) {
  if (client > whatsAppClients.length) {
    return "error";
  }

  if (!whatsAppClients[client]) {
    return "error";
  }

  whatsAppClients[client]
    .sendMessage(
      `${
        phone_number.includes("@c.us") ? phone_number : phone_number + "@c.us"
      }`,
      message
    )
    .then((response) => {
      // return "success";
    })
    .catch((err) => {
      requestSendMessage(phone_number, message, client + 1);
    });
}

// api route to request send message
app.post("/send-message", (req, res) => {
  let phone_number = req.body.phone_number;
  let message = req.body.message;

  if (phone_number && message) {
    let response = requestSendMessage(phone_number, message);

    if (response == "error") {
      return res.status(500).json({
        status: "error",
        message: "Internal server error",
      });
    } else {
      return res.status(200).json({
        status: "success",
        message: "Message sent successfully",
      });
    }
  } else {
    return res.status(400).json({
      status: "error",
      message: "Invalid request",
    });
  }
});

console.log(`Server is running on port ${port}`);
app.listen(port, () => {});
