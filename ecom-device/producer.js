//  Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License. See License in the project root for license information.

const {
    Connection,
    Message,
    ConnectionOptions,
    Delivery,
    AwaitableSenderOptions,
    AwaitableSender
  } = require ("rhea-promise")

  const 
    host =  `${process.env.EVENTHUB_ACCOUNT}.servicebus.windows.net`,
    username = process.env.AMQP_USERNAME,
    password = process.env.AMQP_PASSWORD,
    port = parseInt(process.env.AMQP_PORT || "5671"),
    senderAddress = process.env.EVENTHUB_HUB


  const devicetypes = [
    'UK-RED',
    'UK-GREEN',
    'UK-GOLD',
    'UK-BLUE',
    'UK-PURPLE',
    'UK-SILVER',
    'UK-PLATINUM',
    'UK-YELLOW',
    'UK-ORANGE',
    'UK-ALMOND',
    'EUROPE-RED',
    'EUROPE-GREEN',
    'EUROPE-GOLD',
    'EUROPE-BLUE',
    'EUROPE-PURPLE',
    'EUROPE-SILVER',
    'EUROPE-PLATINUM',
    'EUROPE-YELLOW',
    'EUROPE-ORANGE',
    'EUROPE-ALMOND',
  ]
  
  // from https://github.com/Azure/azure-sdk-for-js/blob/master/sdk/core/core-amqp/src/util/constants.ts
  const partitionKey = "x-opt-partition-key";
  const sequenceNumber = "x-opt-sequence-number";


  async function main() {
    const connectionOptions = {
      transport: "tls",
      host: host,
      hostname: host,
      username: username,
      password: password,
      port: port,
      reconnect: false
    };
    const connection = new Connection(connectionOptions);
    const senderName = "sender-1";
    const senderOptions = {
      name: senderName,
      target: {
        address: senderAddress
      },
      sendTimeoutInSeconds: 10
    };
  
    await connection.open();
    const sender = await connection.createAwaitableSender(
      senderOptions
    );
  
    //for (let i = 0; i < 10; i++) {
    let i = 0
    while (true) {
      i++
      const body = JSON.stringify({device : i, ticker: 'IBM', price: Math.floor(Math.random() * 1000) /100 + i, message: `Hello World - ${i}`, device_type: devicetypes[i % devicetypes.length]})
      const message = {
        body,
        message_id: i,
        durable: true,
        message_annotations: {
          [partitionKey]: devicetypes[i % devicetypes.length]
        }
      };
      // Please, note that we are awaiting on sender.send() to complete.
      // You will notice that `delivery.settled` will be `true`, irrespective of whether the promise resolves or rejects.
      const delivery = await sender.send({body: JSON.stringify({name: "123"})});
      //await new Promise((resolve) => setTimeout(() => resolve(),1000))
      console.log(
        "[%s] await sendMessage -> Delivery id: %d, settled: %s",
        connection.id,
        delivery.id,
        delivery.settled
      );
    }
  
    await sender.close();
    await connection.close();
  }

  
const { EventHubProducerClient } = require("@azure/event-hubs")
const connectionString = `Endpoint=sb://${process.env.EVENTHUB_ACCOUNT}.servicebus.windows.net/;SharedAccessKeyName=${process.env.AMQP_USERNAME};SharedAccessKey=${process.env.AMQP_PASSWORD}`
const eventHubName = process.env.EVENTHUB_HUB;

async function main_sdk() {
  const ticker = [
    'CRM',
    'IBM',
    'TSLA',
    'RSA',
    'ORCL',
    'MSFT',
    'APPL',
    'F',
    'RBS'
  ]


  let price = [50, 200, 130, 500, 5, 10, 63, 27, 76] , seq = 0
  while (true) {
    const eventDataBatch = await producerClient.createBatch()
    for (i = 0; i <9; i++) {
      let idx = i % ticker.length
      price[idx] = Math.round((price[idx] + (Math.random() * (price[idx]/10) * (Math.random() >=0.48 || price[idx] < 4 ? 1 : -1))) * 100) /100
      let body = {date: (new Date()).toISOString(), device : seq++, ticker: ticker[idx], price: price[idx] , message: `Hello World - ${i}`, device_type: devicetypes[i % devicetypes.length]}
      eventDataBatch.tryAdd({body})
      console.log (`${ticker[idx]}:${price[idx]} ${body.date}`)
    }
    await producerClient.sendBatch(eventDataBatch)
    await new Promise((resolve) => setTimeout(() => resolve(),2000))
  }
  await producerClient.close()

}

const producerClient = new EventHubProducerClient(connectionString, eventHubName)
main_sdk(producerClient).then(async () => await producerClient.close()).catch((err) => console.log(err));