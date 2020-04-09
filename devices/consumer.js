// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License. See License in the project root for license information.

const {
    Connection, Receiver, EventContext, ConnectionOptions, ReceiverOptions, delay, ReceiverEvents, types
  } = require ("rhea-promise")
  
  
  const host = process.env.AMQP_HOST;
  const username = process.env.AMQP_USERNAME;
  const password = process.env.AMQP_PASSWORD ;
  const port = parseInt(process.env.AMQP_PORT || "5671");
  const receiverAddress = process.env.SENDER_ADDRESS || "devices";
  
  async function main() {
    const connectionOptions= {
      transport: "tls",
      host: host,
      hostname: host,
      username: username,
      password: password,
      port: port,
      reconnect: false
    };
    const connection = new Connection(connectionOptions);
    const receiverName = "receiver-1";
    // receive messages from the past one hour
    const filterClause = `amqp.annotation.x-opt-enqueued-time > '${Date.now() - 3600 * 1000}'`;
    const receiverOptions = {
      name: receiverName,
      source: {
        address: receiverAddress,
        filter: {
          "apache.org:selector-filter:string": types.wrap_described(filterClause, 0x468C00000004)
        }
      },
      onSessionError: (context) => {
        const sessionError = context.session && context.session.error;
        if (sessionError) {
          console.log(">>>>> [%s] An error occurred for session of receiver '%s': %O.",
            connection.id, receiverName, sessionError);
        }
      }
    };
  
    await connection.open();
    const receiver = await connection.createReceiver(receiverOptions);
    receiver.on(ReceiverEvents.message, (context) => {
      console.log("Received message: %O", context.message);
    });
    receiver.on(ReceiverEvents.receiverError, (context) => {
      const receiverError = context.receiver && context.receiver.error;
      if (receiverError) {
        console.log(">>>>> [%s] An error occurred for receiver '%s': %O.",
          connection.id, receiverName, receiverError);
      }
    });
    // sleeping for 2 mins to let the receiver receive messages and then closing it.
    await delay(120000);
    await receiver.close();
    await connection.close();
  }
  
  main().catch((err) => console.log(err));