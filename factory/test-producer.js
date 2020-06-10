

var Kafka = require('node-rdkafka');

var producer = new Kafka.Producer({
    //'debug' : 'all',
    'metadata.broker.list': 'mynamespace.servicebus.windows.net:9093', //REPLACE​
    'dr_cb': true,  //delivery report callback
    'security.protocol': 'SASL_SSL',
    'sasl.mechanisms': 'PLAIN',
    'sasl.username': '$ConnectionString', //do not replace $ConnectionString
    'sasl.password': 'Endpoint=sb://mynamespace.servicebus.windows.net/;SharedAccessKeyName=XXXXXX;SharedAccessKey=XXXXXX' //REPLACE
  });