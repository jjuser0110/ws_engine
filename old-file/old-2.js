const express = require("express");
const app = express();
const port = 3000;
const cors = require("cors");
const bodyParser = require("body-parser");

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cors());

const mysql = require("mysql");
const connection = mysql.createConnection({
  host: "localhost",
  user: "root",
  password: "",
  database: "whatsapp_api",
});

const whatsAppClients = [];
let latestCreatedAt = null;
let activeClients = [];
let availableClientsIds = [];

connection.connect();
setInterval(() => {
  // if latestCreatedAt is null, then get all the rows
  // if latestCreatedAt is not null, then get all the rows where created_at is greater than latestCreatedAt
  connection.query(`SELECT * FROM whats_app_clients WHERE created_at > '${latestCreatedAt}' AND deleted_at IS NULL`, (err, rows, fields) => {
    if (err) throw err;

    // Loop through all the rows of whats_app_clients table
    rows.forEach((row) => {
      // if the client is already in the array or status is active, then skip
      if (
        row.status == "active"
      ) {
        return;
      }

      // Push the id of the client to the availableClientsIds array
      availableClientsIds.push(row.id);

      // Import the required modules
      const { Client, LocalAuth } = require("whatsapp-web.js");
      const client = new Client({
        authStrategy: new LocalAuth({
          clientId: row.phone_number,
          dataPath: "./session.json",
        }),
      });

      // Set the login qr code
      client.on("qr", (qr) => {
        connection.query(
          `UPDATE whats_app_clients SET login_qr = '${qr}', status = 'inactive' WHERE id = ${row.id}`,
          (err, rows, fields) => {
            if (err) {
              console.log(err);
            }
          }
        );
      });

      // Set the session, when authenticated successfully
      client.on("authenticated", (session) => {
        connection.query(
          `UPDATE whats_app_clients SET login_qr = null WHERE id = ${row.id}`,
          (err, rows, fields) => {
            if (err) throw err;
          }
        );
      });

      // Set the status to active, when the client is ready
      client.on("ready", () => {
        connection.query(
          `UPDATE whats_app_clients SET status = 'active' WHERE id = ${row.id}`,
          (err, rows, fields) => {
            if (err) throw err;
          }
        );
      });

      // Set the status to inactive, when the client is authenticated failed
      client.on("auth_failure", (session) => {
        connection.query(
          `UPDATE whats_app_clients SET status = 'inactive' WHERE id = ${row.id}`,
          (err, rows, fields) => {
            if (err) throw err;
          }
        );

        // client.destroy();

        const { Client, LocalAuth } = require("whatsapp-web.js");
        const client = new Client({
          authStrategy: new LocalAuth({
            clientId: row.phone_number,
            dataPath: "./session.json",
          }),
        });

        client.on("qr", (qr) => {
          connection.query(
            `UPDATE whats_app_clients SET login_qr = '${qr}' WHERE id = ${row.id}`,
            (err, rows, fields) => {
              if (err) {
                console.log(err);
              }
            }
          );
        });
      });

      // Set the status to inactive, when the client is disconnected
      client.on("disconnected", (reason) => {
        connection.query(
          `UPDATE whats_app_clients SET status = 'inactive' WHERE id = ${row.id}`,
          (err, rows, fields) => {
            if (err) throw err;
          }
        );

        // client.destroy();

        const { Client, LocalAuth } = require("whatsapp-web.js");
        const client = new Client({
          authStrategy: new LocalAuth({
            clientId: row.phone_number,
            dataPath: "./session.json",
          }),
        });

        client.on("qr", (qr) => {
          connection.query(
            `UPDATE whats_app_clients SET login_qr = '${qr}' WHERE id = ${row.id}`,
            (err, rows, fields) => {
              if (err) {
                console.log(err);
              }
            }
          );
        });
      });

      // Set the status to inactive, when the client is logged out
      client.on("logout", (reason) => {
        connection.query(
          `UPDATE whats_app_clients SET status = 'inactive' WHERE id = ${row.id}`,
          (err, rows, fields) => {
            if (err) throw err;
          }
        );

        // client.destroy();

        const { Client, LocalAuth } = require("whatsapp-web.js");
        const client = new Client({
          authStrategy: new LocalAuth({
            clientId: row.phone_number,
            dataPath: "./session.json",
          }),
        });

        client.on("qr", (qr) => {
          connection.query(
            `UPDATE whats_app_clients SET login_qr = '${qr}' WHERE id = ${row.id}`,
            (err, rows, fields) => {
              if (err) {
                console.log(err);
              }
            }
          );
        });
      });

      // When the client receives a message with the content "register", it will send a random token to the user as a OTP
      client.on("message", (msg) => {
        if (msg.body.toLocaleLowerCase() == "register") {
          let number = msg.from.split("@")[0];
          let randomToken = generateOTP();

          connection.query(
            `INSERT INTO registration_tokens (phone_number, token, active, created_at, updated_at) VALUES ('${number}', '${randomToken}', true, NOW(), NOW())`,
            (err, rows, fields) => {
              if (err) {
                throw err;
              }
            }
          );

          msg.reply(`Your registration token is ${randomToken}`);
        }
      });

      if (latestCreatedAt == null) {
        latestCreatedAt = row.created_at;
      } else {
        if (latestCreatedAt < row.created_at) {
          latestCreatedAt = row.created_at;
        }
      }

      client.initialize();

      // if whatsapp client is not in the array, then push it
      if (!activeClients.find((x) => x.id == row.id)) {
        whatsAppClients.push(client);

        activeClients.push({
          id: row.id,
          index: whatsAppClients.length - 1,
        });
      }
    });
  });
}, 2000);

// for deleting deleted clients from the array
setInterval(() => {
  // select all client where not null deleted_at
  connection.query(
    `SELECT * FROM whats_app_clients WHERE deleted_at IS NOT NULL`,
    (err, rows, fields) => {
      if (err) throw err;

      // loop through all the rows
      rows.forEach((row) => {
        // delete whatsapp client from the array
        if (activeClients.find((x) => x.id == row.id)) {
          whatsAppClients.splice(
            activeClients.find((x) => x.id == row.id).index,
            1
          );
        }

        // delete client from the activeClients array
        if (activeClients.find((x) => x.id == row.id)) {
          activeClients.splice(
            activeClients.findIndex((x) => x.id == row.id),
            1
          );
        }
      });
    }
  );
}, 5000);

// Api route to request send message
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

function generateOTP() {
  // Generate 4 digit OTP and not in registration_tokens table
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

console.log(`Server is running on port ${port}`);
app.listen(port, () => {});
